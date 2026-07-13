/**
 * MCP tool registration for the delegate server.
 *
 * Tools:
 *   - delegate_task        : hand an arbitrary task to a cheaper model via OpenCode
 *   - delegate_tests       : test-focused convenience wrapper around delegate_task
 *   - list_models          : enumerate available provider/model ids
 *   - get_delegate_config  : read the active configuration
 *   - set_delegate_config  : change the active model/provider/settings at runtime
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CHARACTER_LIMIT } from "./constants.js";
import {
  loadConfig,
  updateConfig,
  getConfigPath,
  ProfileSchema,
  type DelegateConfig,
} from "./config.js";
import type { Backend, DelegateRequest, DelegateResult } from "./backend.js";

/** Structured JSON returned to the caller alongside the text summary. */
interface DelegateStructured {
  ok: boolean;
  model?: string;
  session_id?: string;
  directory: string;
  result: string;
  error?: string;
  usage: {
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    reasoning_tokens: number;
    cache_read_tokens: number;
    cache_write_tokens: number;
    cost: number;
  };
  actions: { tool: string; status?: string }[];
  duration_ms: number;
}

function toStructured(result: DelegateResult, directory: string): DelegateStructured {
  return {
    ok: result.ok,
    model: result.model,
    session_id: result.sessionId,
    directory,
    result: result.text,
    ...(result.error ? { error: result.error } : {}),
    usage: {
      total_tokens: result.usage.totalTokens,
      input_tokens: result.usage.inputTokens,
      output_tokens: result.usage.outputTokens,
      reasoning_tokens: result.usage.reasoningTokens,
      cache_read_tokens: result.usage.cacheReadTokens,
      cache_write_tokens: result.usage.cacheWriteTokens,
      cost: result.usage.cost,
    },
    actions: result.actions,
    duration_ms: result.durationMs,
  };
}

function summarizeActions(actions: { tool: string; status?: string }[]): string {
  if (actions.length === 0) return "none";
  const counts = new Map<string, number>();
  for (const a of actions) counts.set(a.tool, (counts.get(a.tool) ?? 0) + 1);
  return [...counts.entries()].map(([tool, n]) => (n > 1 ? `${tool}×${n}` : tool)).join(", ");
}

function truncate(text: string): string {
  if (text.length <= CHARACTER_LIMIT) return text;
  return (
    text.slice(0, CHARACTER_LIMIT) +
    `\n\n…[truncated ${text.length - CHARACTER_LIMIT} characters]`
  );
}

function formatMarkdown(structured: DelegateStructured): string {
  const u = structured.usage;
  const head = structured.ok ? "✅ Delegation succeeded" : "❌ Delegation failed";
  const lines: string[] = [
    `## ${head}${structured.model ? ` — \`${structured.model}\`` : ""}`,
    "",
  ];
  if (structured.error) {
    lines.push(`**Error:** ${structured.error}`, "");
  }
  if (structured.result) {
    lines.push(truncate(structured.result), "");
  }
  lines.push(
    "---",
    `- **Directory:** ${structured.directory}`,
    structured.session_id ? `- **Session:** \`${structured.session_id}\` (pass as \`session\` to continue)` : "- **Session:** n/a",
    `- **Tokens:** ${u.total_tokens} total (in ${u.input_tokens} / out ${u.output_tokens}` +
      `${u.reasoning_tokens ? ` / reasoning ${u.reasoning_tokens}` : ""}, cache r/w ${u.cache_read_tokens}/${u.cache_write_tokens})`,
    `- **Cost:** $${u.cost.toFixed(4)}`,
    `- **Actions:** ${summarizeActions(structured.actions)}`,
    `- **Duration:** ${(structured.duration_ms / 1000).toFixed(1)}s`,
  );
  return lines.join("\n");
}

function renderResult(result: DelegateResult, directory: string, format: "markdown" | "json") {
  const structured = toStructured(result, directory);
  const text =
    format === "json"
      ? JSON.stringify({ ...structured, result: truncate(structured.result) }, null, 2)
      : formatMarkdown(structured);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: structured as unknown as Record<string, unknown>,
    isError: !result.ok,
  };
}

function errorResponse(message: string) {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Resolve model/agent/variant/directory from explicit args, an optional named
 * profile, and config defaults (in that precedence), then build a request.
 */
function resolveRequest(
  config: DelegateConfig,
  args: {
    directory?: string;
    model?: string;
    agent?: string;
    variant?: string;
    profile?: string;
    files?: string[];
    session?: string;
    continue_session?: boolean;
    auto_approve?: boolean;
  },
  task: string,
): { req: DelegateRequest; directory: string } | { error: string } {
  let profile;
  if (args.profile) {
    profile = config.profiles[args.profile];
    if (!profile) {
      const available = Object.keys(config.profiles);
      return {
        error:
          `Profile '${args.profile}' not found. ` +
          (available.length ? `Available: ${available.join(", ")}.` : "No profiles are defined.") +
          ` Define profiles via set_delegate_config.`,
      };
    }
  }

  const model = args.model ?? profile?.model ?? config.defaultModel;
  if (!model) {
    return {
      error:
        "No model configured. Pass `model` (as 'provider/model'), select a `profile`, " +
        "or set a default via set_delegate_config { default_model: '...' }. " +
        "Use list_models to see available ids.",
    };
  }

  const directory = args.directory ?? config.defaultDirectory ?? process.cwd();

  const req: DelegateRequest = {
    task,
    directory,
    model,
    agent: args.agent ?? profile?.agent ?? config.defaultAgent,
    variant: args.variant ?? profile?.variant ?? config.defaultVariant,
    files: args.files,
    session: args.session,
    continueSession: args.continue_session,
    autoApprove: args.auto_approve ?? profile?.autoApprove ?? config.autoApprove,
    timeoutMs: config.timeoutMs,
    bin: config.opencodeBin,
  };
  return { req, directory };
}

export function registerTools(server: McpServer, backend: Backend): void {
  // --- delegate_task -------------------------------------------------------
  server.registerTool(
    "delegate_task",
    {
      title: "Delegate a coding task to a cheaper model",
      description: `Hand off self-contained, high-volume "grunt work" to a cheaper model running through OpenCode, so the primary agent can stay focused on architecture and critical decisions.

The subagent runs non-interactively in a real working directory and CAN read, write, and edit files and run shell commands there (auto-approved by default). Give it a complete, self-contained brief — it does not see your conversation.

Good for: writing repetitive/boilerplate code, mechanical refactors, generating tests, fixing lint/type errors, updating call sites, docstrings, simple migrations.
Avoid for: architecture, security-sensitive logic, ambiguous specs, or anything where a wrong edit is costly.

Args:
  - task (string, required): Complete instructions for the subagent, including acceptance criteria.
  - directory (string): Absolute path of the repo/dir to work in. Defaults to the server's cwd or config.default_directory.
  - model (string): Override provider/model, e.g. "minimax-coding-plan/MiniMax-M2.5-highspeed". Defaults to config.default_model.
  - agent (string): OpenCode agent name to run as.
  - variant (string): Reasoning-effort variant, e.g. "high" | "minimal".
  - profile (string): Named preset from config (model/agent/variant/auto_approve).
  - files (string[]): Paths to attach as context.
  - session (string): Session id to continue a prior delegation (returned as session_id).
  - continue_session (boolean): Continue the last session instead of a specific id.
  - auto_approve (boolean): Auto-approve tool permissions (default from config, usually true).
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns structured content: { ok, model, session_id, directory, result, error?, usage{tokens,cost}, actions[], duration_ms }.`,
      inputSchema: {
        task: z.string().min(1).describe("Complete, self-contained instructions for the subagent"),
        directory: z.string().min(1).optional().describe("Absolute working directory for the subagent"),
        model: z.string().min(1).optional().describe("provider/model override (see list_models)"),
        agent: z.string().min(1).optional().describe("OpenCode agent name"),
        variant: z.string().min(1).optional().describe("Reasoning-effort variant"),
        profile: z.string().min(1).optional().describe("Named config profile to apply"),
        files: z.array(z.string()).optional().describe("File paths to attach as context"),
        session: z.string().min(1).optional().describe("Session id to continue"),
        continue_session: z.boolean().optional().describe("Continue the last session"),
        auto_approve: z.boolean().optional().describe("Auto-approve tool permissions"),
        response_format: z.enum(["markdown", "json"]).default("markdown").describe("Output format"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const config = loadConfig();
      const resolved = resolveRequest(config, args, args.task);
      if ("error" in resolved) return errorResponse(resolved.error);
      const result = await backend.run(resolved.req);
      return renderResult(result, resolved.directory, args.response_format);
    },
  );

  // --- delegate_tests ------------------------------------------------------
  server.registerTool(
    "delegate_tests",
    {
      title: "Delegate test writing/running to a cheaper model",
      description: `Test-focused wrapper around delegate_task. The subagent writes (and optionally runs) tests for the given scope while avoiding changes to production code unless strictly required to make tests pass.

Args:
  - scope (string, required): What to test — module, files, behaviors, edge cases.
  - directory (string): Absolute repo path. Defaults to config.default_directory or server cwd.
  - framework (string): Optional testing framework/runner hint (e.g. "vitest", "pytest").
  - run_tests (boolean): Ask the subagent to run the suite and report pass/fail (default true).
  - model / agent / variant / profile / files / session / continue_session / auto_approve: same as delegate_task.
  - response_format ('markdown' | 'json'): Output format (default 'markdown').

Returns the same structured content shape as delegate_task.`,
      inputSchema: {
        scope: z.string().min(1).describe("What to test: module/files/behaviors/edge cases"),
        directory: z.string().min(1).optional().describe("Absolute working directory"),
        framework: z.string().min(1).optional().describe("Testing framework/runner hint"),
        run_tests: z.boolean().default(true).describe("Run the suite and report results"),
        model: z.string().min(1).optional(),
        agent: z.string().min(1).optional(),
        variant: z.string().min(1).optional(),
        profile: z.string().min(1).optional(),
        files: z.array(z.string()).optional(),
        session: z.string().min(1).optional(),
        continue_session: z.boolean().optional(),
        auto_approve: z.boolean().optional(),
        response_format: z.enum(["markdown", "json"]).default("markdown"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      const config = loadConfig();
      const taskLines = [
        "You are a test-writing subagent. Focus strictly on tests.",
        "",
        `Scope: ${args.scope}`,
        "",
        "Rules:",
        "- Write clear, meaningful tests covering the described scope and its edge cases.",
        "- Follow the project's existing test framework and conventions; match neighboring test style.",
        "- Do NOT modify production/source code unless strictly necessary to make a test pass; if you must, keep it minimal and call it out.",
        args.framework ? `- Preferred framework/runner: ${args.framework}.` : "- Detect the test framework from the project.",
        args.run_tests
          ? "- After writing tests, run the test suite and report exactly which tests pass and fail, with the command used."
          : "- Do not run the tests; just write them.",
        "",
        "Report: list the files you created/changed and a short summary of coverage added.",
      ];
      const resolved = resolveRequest(config, args, taskLines.join("\n"));
      if ("error" in resolved) return errorResponse(resolved.error);
      const result = await backend.run(resolved.req);
      return renderResult(result, resolved.directory, args.response_format);
    },
  );

  // --- list_models ---------------------------------------------------------
  server.registerTool(
    "list_models",
    {
      title: "List available provider/model ids",
      description: `List provider/model ids that OpenCode can use, in "provider/model" form (e.g. "minimax-coding-plan/MiniMax-M2.5-highspeed"). Optionally filter to a single provider. Use these ids for the \`model\` argument of delegate_task or as default_model in set_delegate_config.

Args:
  - provider (string): Optional provider id to filter by (e.g. "minimax-coding-plan", "openrouter").
  - contains (string): Optional case-insensitive substring filter.
  - limit (number): Max ids to return (default 200).
  - response_format ('markdown' | 'json'): Output format (default 'markdown').`,
      inputSchema: {
        provider: z.string().min(1).optional().describe("Filter to a single provider id"),
        contains: z.string().min(1).optional().describe("Case-insensitive substring filter"),
        limit: z.number().int().min(1).max(1000).default(200).describe("Max ids to return"),
        response_format: z.enum(["markdown", "json"]).default("markdown"),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      const config = loadConfig();
      try {
        let models = await backend.listModels(config.opencodeBin, args.provider);
        if (args.contains) {
          const needle = args.contains.toLowerCase();
          models = models.filter((m) => m.toLowerCase().includes(needle));
        }
        const total = models.length;
        const shown = models.slice(0, args.limit);
        if (args.response_format === "json") {
          return {
            content: [
              { type: "text", text: JSON.stringify({ total, count: shown.length, models: shown }, null, 2) },
            ],
            structuredContent: { total, count: shown.length, models: shown },
          };
        }
        const body =
          shown.length === 0
            ? "_No matching models._"
            : shown.map((m) => `- \`${m}\``).join("\n");
        const note = total > shown.length ? `\n\n_Showing ${shown.length} of ${total}. Use \`provider\`/\`contains\`/\`limit\` to narrow._` : "";
        return {
          content: [{ type: "text", text: `# Available models (${total})\n\n${body}${note}` }],
          structuredContent: { total, count: shown.length, models: shown },
        };
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // --- get_delegate_config -------------------------------------------------
  server.registerTool(
    "get_delegate_config",
    {
      title: "Get the delegate configuration",
      description: `Return the current delegate configuration (default model/provider, agent, variant, auto-approve, timeout, default directory, and named profiles) plus the config file path. Read-only.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const config = loadConfig();
      const payload = { config_path: getConfigPath(), config };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );

  // --- set_delegate_config -------------------------------------------------
  server.registerTool(
    "set_delegate_config",
    {
      title: "Update the delegate configuration",
      description: `Change the active delegation settings at runtime — this is how you dynamically switch the cheap model or provider without reinstalling. Only the fields you pass are updated; profiles are merged. Returns the updated config.

Args (all optional):
  - default_model (string): provider/model used when a call omits one, e.g. "openrouter/minimax/minimax-m2.5".
  - default_agent (string): default OpenCode agent.
  - default_variant (string): default reasoning-effort variant.
  - auto_approve (boolean): auto-approve tool permissions for delegations.
  - timeout_ms (number): per-delegation timeout in milliseconds.
  - default_directory (string): default working directory.
  - opencode_bin (string): path/name of the opencode binary.
  - profiles (object): map of name -> { model?, agent?, variant?, autoApprove? } to merge in.`,
      inputSchema: {
        default_model: z.string().min(1).optional().describe("provider/model default"),
        default_agent: z.string().min(1).optional(),
        default_variant: z.string().min(1).optional(),
        auto_approve: z.boolean().optional(),
        timeout_ms: z.number().int().positive().optional(),
        default_directory: z.string().min(1).optional(),
        opencode_bin: z.string().min(1).optional(),
        profiles: z.record(z.string(), ProfileSchema).optional().describe("Named presets to merge"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const patch: Record<string, unknown> = {};
      if (args.default_model !== undefined) patch.defaultModel = args.default_model;
      if (args.default_agent !== undefined) patch.defaultAgent = args.default_agent;
      if (args.default_variant !== undefined) patch.defaultVariant = args.default_variant;
      if (args.auto_approve !== undefined) patch.autoApprove = args.auto_approve;
      if (args.timeout_ms !== undefined) patch.timeoutMs = args.timeout_ms;
      if (args.default_directory !== undefined) patch.defaultDirectory = args.default_directory;
      if (args.opencode_bin !== undefined) patch.opencodeBin = args.opencode_bin;
      if (args.profiles !== undefined) patch.profiles = args.profiles;

      try {
        const updated = updateConfig(patch as Partial<DelegateConfig>);
        const payload = { config_path: getConfigPath(), config: updated };
        return {
          content: [
            { type: "text", text: `Configuration updated.\n\n${JSON.stringify(payload, null, 2)}` },
          ],
          structuredContent: payload as unknown as Record<string, unknown>,
        };
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : String(err));
      }
    },
  );
}
