/**
 * Execution backend abstraction.
 *
 * The MCP delegates "grunt work" to a cheaper agent runtime. The first (and
 * currently only) backend shells out to the OpenCode CLI (`opencode run`),
 * but the `Backend` interface is intentionally small so additional runtimes
 * (other agent CLIs) can be added later without touching the tool layer.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export interface DelegateRequest {
  /** Natural-language task for the subagent. */
  task: string;
  /** Absolute working directory the subagent runs in. */
  directory: string;
  /** provider/model id (e.g. "minimax-coding-plan/MiniMax-M2.5-highspeed"). */
  model?: string;
  /** Agent name to run as. */
  agent?: string;
  /** Reasoning-effort variant. */
  variant?: string;
  /** Files to attach to the message. */
  files?: string[];
  /** Existing session id to continue. */
  session?: string;
  /** Continue the last session instead of a specific id. */
  continueSession?: boolean;
  /** Auto-approve tool permissions (needed for non-interactive edits/commands). */
  autoApprove: boolean;
  /** Hard timeout in milliseconds. */
  timeoutMs: number;
  /** Binary to invoke (name on PATH or absolute path). */
  bin: string;
}

export interface DelegateUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
}

export interface DelegateAction {
  /** Tool name invoked by the subagent (e.g. "edit", "bash", "read"). */
  tool: string;
  /** Terminal status of the tool call if known (e.g. "completed", "error"). */
  status?: string;
}

export interface DelegateResult {
  ok: boolean;
  /** Final assistant text produced by the subagent. */
  text: string;
  sessionId?: string;
  model?: string;
  usage: DelegateUsage;
  /** Ordered list of tool actions the subagent took. */
  actions: DelegateAction[];
  durationMs: number;
  /** Populated when ok === false. */
  error?: string;
}

export interface Backend {
  readonly name: string;
  run(req: DelegateRequest): Promise<DelegateResult>;
  listModels(bin: string, provider?: string): Promise<string[]>;
  isAvailable(bin: string): Promise<boolean>;
}

interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runProcess(
  bin: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {},
): Promise<ProcResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, {
        cwd: opts.cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({
        code: null,
        stdout: "",
        stderr: `Failed to spawn '${bin}': ${err instanceof Error ? err.message : String(err)}`,
        timedOut: false,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer =
      opts.timeoutMs && opts.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            // Escalate if it doesn't exit promptly.
            setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
          }, opts.timeoutMs)
        : undefined;

    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    };

    child.on("error", (err) => {
      stderr += `\n${err instanceof Error ? err.message : String(err)}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

const emptyUsage = (): DelegateUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  cost: 0,
});

/**
 * Parse the newline-delimited JSON event stream emitted by
 * `opencode run --format json`.
 *
 * Each line is an event `{ type, timestamp, sessionID, part }`. Parts are
 * keyed by `part.id`; OpenCode re-emits the full part state on update, so we
 * keep a last-wins map per id to avoid double-counting streamed deltas.
 */
export function parseOpencodeJsonl(stdout: string): {
  text: string;
  sessionId?: string;
  usage: DelegateUsage;
  actions: DelegateAction[];
} {
  const parts = new Map<string, any>();
  const order: string[] = [];
  let sessionId: string | undefined;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt: any;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue; // tolerate non-JSON noise
    }
    if (typeof evt?.sessionID === "string" && !sessionId) sessionId = evt.sessionID;
    const part = evt?.part;
    if (part && typeof part.id === "string") {
      if (!parts.has(part.id)) order.push(part.id);
      parts.set(part.id, part);
    }
  }

  const textChunks: string[] = [];
  const actions: DelegateAction[] = [];
  const usage = emptyUsage();

  for (const id of order) {
    const part = parts.get(id);
    if (!part) continue;
    switch (part.type) {
      case "text": {
        if (typeof part.text === "string" && part.text.length > 0) {
          textChunks.push(part.text);
        }
        break;
      }
      case "tool": {
        actions.push({
          tool: typeof part.tool === "string" ? part.tool : "tool",
          status: part.state?.status,
        });
        break;
      }
      case "step-finish": {
        const t = part.tokens ?? {};
        usage.inputTokens += Number(t.input ?? 0);
        usage.outputTokens += Number(t.output ?? 0);
        usage.reasoningTokens += Number(t.reasoning ?? 0);
        usage.cacheReadTokens += Number(t.cache?.read ?? 0);
        usage.cacheWriteTokens += Number(t.cache?.write ?? 0);
        usage.totalTokens += Number(t.total ?? 0);
        usage.cost += Number(part.cost ?? 0);
        break;
      }
      default:
        break;
    }
  }

  return { text: textChunks.join("\n").trim(), sessionId, usage, actions };
}

export class OpenCodeBackend implements Backend {
  readonly name = "opencode";

  async isAvailable(bin: string): Promise<boolean> {
    const res = await runProcess(bin, ["--version"], { timeoutMs: 15_000 });
    return res.code === 0;
  }

  async listModels(bin: string, provider?: string): Promise<string[]> {
    const args = provider ? ["models", provider] : ["models"];
    const res = await runProcess(bin, args, { timeoutMs: 60_000 });
    if (res.code !== 0) {
      throw new Error(
        `'${bin} models' failed (exit ${res.code}): ${res.stderr.trim() || "unknown error"}`,
      );
    }
    return res.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l.includes("/"));
  }

  private buildArgs(req: DelegateRequest): string[] {
    const args = ["run", "--dir", req.directory, "--format", "json"];
    if (req.model) args.push("--model", req.model);
    if (req.agent) args.push("--agent", req.agent);
    if (req.variant) args.push("--variant", req.variant);
    if (req.autoApprove) args.push("--auto");
    if (req.session) {
      args.push("--session", req.session);
    } else if (req.continueSession) {
      args.push("--continue");
    }
    // Positional message BEFORE --file: OpenCode's --file is a yargs
    // array-type flag that greedily swallows trailing bare tokens, so a
    // positional placed after it gets absorbed as another --file value
    // instead of being treated as the message (surfaces as a confusing
    // "File not found: <task text>" error whenever files[] is non-empty).
    args.push(req.task);
    for (const f of req.files ?? []) args.push("--file", f);
    return args;
  }

  async run(req: DelegateRequest): Promise<DelegateResult> {
    const started = Date.now();

    if (!existsSync(req.directory)) {
      return {
        ok: false,
        text: "",
        usage: emptyUsage(),
        actions: [],
        durationMs: Date.now() - started,
        model: req.model,
        error: `Working directory does not exist: ${req.directory}`,
      };
    }

    const args = this.buildArgs(req);
    const res = await runProcess(req.bin, args, {
      cwd: req.directory,
      timeoutMs: req.timeoutMs,
    });
    const durationMs = Date.now() - started;

    const parsed = parseOpencodeJsonl(res.stdout);

    if (res.timedOut) {
      return {
        ok: false,
        text: parsed.text,
        sessionId: parsed.sessionId,
        model: req.model,
        usage: parsed.usage,
        actions: parsed.actions,
        durationMs,
        error: `Delegation timed out after ${req.timeoutMs}ms. Increase timeoutMs via set_delegate_config or split the task.`,
      };
    }

    if (res.code !== 0) {
      const detail = res.stderr.trim() || parsed.text || "unknown error";
      return {
        ok: false,
        text: parsed.text,
        sessionId: parsed.sessionId,
        model: req.model,
        usage: parsed.usage,
        actions: parsed.actions,
        durationMs,
        error: `opencode run failed (exit ${res.code}): ${detail}`,
      };
    }

    return {
      ok: true,
      text: parsed.text,
      sessionId: parsed.sessionId,
      model: req.model,
      usage: parsed.usage,
      actions: parsed.actions,
      durationMs,
    };
  }
}
