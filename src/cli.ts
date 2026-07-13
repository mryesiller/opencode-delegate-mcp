/**
 * Terminal config CLI (`node dist/index.js config …`).
 *
 * Lets users reconfigure the delegate server after installation without
 * reinstalling or going through an MCP client. Reuses the same config module
 * as the `set_delegate_config` tool, so both paths edit one file:
 *   $XDG_CONFIG_HOME/opencode-delegate/config.json
 *
 * Subcommands:
 *   config get              Print the current config as JSON.
 *   config path             Print the config file path.
 *   config set [flags]      Patch config (only the flags you pass are changed).
 *
 * `config set` flags (mirror install.sh where possible):
 *   --model <provider/model>   --agent <name>       --variant <name>
 *   --timeout <seconds>        --timeout-ms <ms>    --default-dir <path>
 *   --opencode-bin <path>      --auto-approve <true|false>
 */

import { loadConfig, updateConfig, getConfigPath, type DelegateConfig } from "./config.js";

/** Parse `--key value` and `--key=value` into a flat map. Bare flags → "true". */
function parseFlags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq >= 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[a.slice(2)] = next;
        i++;
      } else {
        out[a.slice(2)] = "true";
      }
    }
  }
  return out;
}

const CONFIG_HELP = `opencode-delegate-mcp config

  config get              Print the current configuration (JSON)
  config path             Print the configuration file path
  config set [flags]      Update configuration (only provided flags change)

set flags:
  --model <provider/model>     Default model, e.g. minimax-coding-plan/MiniMax-M2.5-highspeed
  --agent <name>               Default OpenCode agent
  --variant <name>             Default reasoning-effort variant
  --timeout <seconds>          Per-delegation timeout in seconds
  --timeout-ms <ms>            Per-delegation timeout in milliseconds
  --default-dir <path>         Default working directory
  --opencode-bin <path>        Path to the opencode binary
  --auto-approve <true|false>  Auto-approve tool permissions

Examples:
  config set --model openrouter/minimax/minimax-m2.5
  config set --timeout 900 --default-dir /Users/me/code/app
`;

/** Handle the `config` subcommand. Returns a process exit code. */
export function runConfigCli(argv: string[]): number {
  const sub = argv[0];

  if (sub === undefined || sub === "-h" || sub === "--help" || sub === "help") {
    process.stdout.write(CONFIG_HELP);
    return sub === undefined ? 1 : 0;
  }

  if (sub === "path") {
    process.stdout.write(getConfigPath() + "\n");
    return 0;
  }

  if (sub === "get") {
    process.stdout.write(JSON.stringify(loadConfig(), null, 2) + "\n");
    return 0;
  }

  if (sub === "set") {
    const flags = parseFlags(argv.slice(1));
    const patch: Partial<DelegateConfig> = {};

    if (flags.model) patch.defaultModel = flags.model;
    if (flags.agent) patch.defaultAgent = flags.agent;
    if (flags.variant) patch.defaultVariant = flags.variant;
    if (flags["opencode-bin"]) patch.opencodeBin = flags["opencode-bin"];
    if (flags["default-dir"]) patch.defaultDirectory = flags["default-dir"];
    if (flags["default-directory"]) patch.defaultDirectory = flags["default-directory"];

    if (flags["timeout-ms"]) {
      const ms = Number.parseInt(flags["timeout-ms"], 10);
      if (Number.isFinite(ms) && ms > 0) patch.timeoutMs = ms;
    } else if (flags.timeout) {
      const sec = Number.parseInt(flags.timeout, 10);
      if (Number.isFinite(sec) && sec > 0) patch.timeoutMs = sec * 1000;
    }

    if (flags["auto-approve"] !== undefined) {
      patch.autoApprove = flags["auto-approve"] !== "false";
    }

    if (Object.keys(patch).length === 0) {
      process.stderr.write(
        "Nothing to update. Pass at least one flag, e.g. `config set --model provider/model`.\n\n" +
          CONFIG_HELP,
      );
      return 1;
    }

    try {
      const updated = updateConfig(patch);
      process.stdout.write(`Updated ${getConfigPath()}\n`);
      process.stdout.write(JSON.stringify(updated, null, 2) + "\n");
      return 0;
    } catch (err) {
      process.stderr.write(`Failed to update config: ${err instanceof Error ? err.message : String(err)}\n`);
      return 1;
    }
  }

  process.stderr.write(`Unknown config subcommand '${sub}'.\n\n${CONFIG_HELP}`);
  return 1;
}
