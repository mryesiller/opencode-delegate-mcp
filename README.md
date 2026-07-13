# opencode-delegate-mcp

> Let your primary coding agent (Claude Code, Codex) delegate the **grunt work** to a **cheaper model** via [OpenCode](https://opencode.ai).

Keep architecture, critical logic, and hard decisions on your expensive frontier model — and hand off the high-volume, low-risk work (boilerplate, repetitive edits, tests, lint/type fixes, mechanical refactors) to a cheap model like MiniMax running through OpenCode. It's an **agent talking to another agent**: your main agent uses a second agent as a subagent, with the model/provider configurable **at runtime**.

```
┌────────────────────┐   MCP (stdio)   ┌───────────────────────┐   opencode run   ┌──────────────────┐
│  Claude Code /      │ ──────────────► │  opencode-delegate-mcp │ ───────────────► │  OpenCode +      │
│  Codex (primary)    │   delegate_task │  (this server)         │  --model cheap   │  cheap model     │
└────────────────────┘ ◄────────────── └───────────────────────┘ ◄─────────────── └──────────────────┘
        result: text + session + token usage + actions taken
```

## Install

The easiest path is the web configurator, which builds a one-line install command for you:

👉 **https://mryesiller.github.io/opencode-delegate-mcp/**

Or install directly from the terminal:

```bash
curl -fsSL https://mryesiller.github.io/opencode-delegate-mcp/install.sh -o /tmp/ocd-install.sh
bash /tmp/ocd-install.sh --model "minimax-coding-plan/MiniMax-M2.5-highspeed" --targets "claude,codex"
```

The installer will:
1. Clone + build the server into `~/.local/share/opencode-delegate-mcp`.
2. Write config to `~/.config/opencode-delegate/config.json`.
3. Register the server with the hosts you chose (`claude` / `codex` / `opencode`).

Then restart your agent (or reload its MCP servers).

### Requirements
- [OpenCode](https://opencode.ai) installed and at least one provider authenticated (`opencode auth login`).
- Node.js ≥ 18, npm, and git.

## Tools

| Tool | Purpose |
| --- | --- |
| `delegate_task` | Hand a self-contained coding task to the cheap model. It can read/write/edit files and run commands in a target directory. Returns the result text, session id, token usage, and the actions it took. |
| `delegate_tests` | Test-focused wrapper: write (and optionally run) tests for a given scope without touching production code. |
| `list_models` | List available `provider/model` ids (optionally filtered by provider or substring). |
| `get_delegate_config` | Read the current configuration. |
| `set_delegate_config` | Change the active model/provider/settings **at runtime** — no reinstall. |

### Example (from your primary agent)

> "Delegate to the cheap model: in `~/code/app`, add JSDoc to every exported function in `src/utils/*.ts`. Don't change behavior."

The primary agent calls `delegate_task` with `directory: "~/code/app"` and your task text; the cheap model does the mechanical work and reports back.

## Dynamic model / provider switching

Everything is driven by a single config file that is read fresh on every call, so you can switch the cheap model or provider without reinstalling — either by editing `~/.config/opencode-delegate/config.json` or via the tool:

```jsonc
// set_delegate_config
{ "default_model": "openrouter/minimax/minimax-m2.5" }   // switch provider+model
{ "default_model": "minimax-coding-plan/MiniMax-M2.7-highspeed", "timeout_ms": 900000 }
```

You can also override per call (`delegate_task { model: "...", ... }`) or define reusable profiles:

```jsonc
// set_delegate_config
{ "profiles": { "tests": { "model": "minimax-coding-plan/MiniMax-M2.5-highspeed" } } }
// then: delegate_task { profile: "tests", ... }
```

## Configuration reference

`~/.config/opencode-delegate/config.json` (override path with `OPENCODE_DELEGATE_CONFIG`):

| Field | Type | Description |
| --- | --- | --- |
| `opencodeBin` | string | Path/name of the `opencode` binary (installer sets the absolute path). |
| `defaultModel` | string | `provider/model` used when a call omits one. |
| `defaultAgent` | string? | Default OpenCode agent. |
| `defaultVariant` | string? | Default reasoning-effort variant (e.g. `high`). |
| `autoApprove` | boolean | Auto-approve tool permissions so headless delegations don't block (default `true`). |
| `timeoutMs` | number | Per-delegation timeout in ms (default `600000`). |
| `defaultDirectory` | string? | Default working directory. |
| `profiles` | object | Named presets: `name -> { model?, agent?, variant?, autoApprove? }`. |

## How it works

The server shells out to `opencode run --dir <dir> --model <provider/model> --format json [--auto] "<task>"`, parses OpenCode's JSON event stream, and returns a compact result (final text, `session_id`, token/cost usage, and the list of tool actions taken). Provider credentials live in **OpenCode's own auth** (`opencode auth`) — this server never stores API keys.

The execution backend is abstracted (`Backend` interface), so other agent runtimes can be added later. OpenCode is the first.

## Security notes

- This server does **not** store or transmit API keys. Provider auth is delegated to OpenCode.
- `autoApprove` runs the cheap model non-interactively with tool permissions granted, so it **can modify files and run commands** in the target directory. Point delegations at repositories you trust and review the diffs. Set `autoApprove: false` to require manual approval (the delegation will then need an interactive OpenCode session).

## Development

```bash
npm install      # installs deps and builds (prepare -> tsc)
npm run build    # compile TypeScript to dist/
npm run dev      # watch mode
node dist/index.js --version
```

## License

MIT © mryesiller
