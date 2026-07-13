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

Or install directly from the terminal — one command, one paste, done:

```bash
curl -fsSL https://mryesiller.github.io/opencode-delegate-mcp/install.sh | bash -s -- --model "minimax-coding-plan/MiniMax-M2.5-highspeed" --targets "claude,codex"
```

Prefer to inspect the script before running it? Download first, then run it locally:

```bash
curl -fsSL https://mryesiller.github.io/opencode-delegate-mcp/install.sh -o install.sh
less install.sh   # read it
bash install.sh --model "minimax-coding-plan/MiniMax-M2.5-highspeed" --targets "claude,codex"
```

The installer will:
1. Clone + build the server into `~/.local/share/opencode-delegate-mcp`.
2. Write config to `~/.config/opencode-delegate/config.json`.
3. Register the server with the hosts you chose (`claude` / `codex` / `opencode`).

Then restart your agent (or reload its MCP servers).

### Requirements
- [OpenCode](https://opencode.ai) installed.
- Node.js ≥ 18, npm, and git.
- A provider authenticated (`opencode auth login`) — **unless** you use one of OpenCode's free `opencode/*` models below, which need no signup or API key at all.

### Try it for free — zero signup

OpenCode ships a handful of free, no-auth-required models under the `opencode/` provider. Use one to try delegation immediately, with nothing to configure:

```bash
curl -fsSL https://mryesiller.github.io/opencode-delegate-mcp/install.sh | bash -s -- --model "opencode/deepseek-v4-flash-free" --targets "claude,codex"
```

Other free options: `opencode/north-mini-code-free`, `opencode/mimo-v2.5-free`. They're on a shared free tier, so expect lower rate limits than a paid provider — switch any time with `config set` (see **Dynamic model / provider switching** below) once you've got a key.

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

## When does it delegate?

Installing the tools doesn't force an agent to use them — **it decides**, guided by its **instruction file** (`CLAUDE.md` for Claude Code, `AGENTS.md` for Codex). Add the delegation policy there to control it, and edit the conditions to fit your project.

| ✅ Delegate — high volume, low risk | ⛔ Keep on the primary agent |
| --- | --- |
| Tests for well-specified behavior (`delegate_tests`) | Architecture, system design, choosing abstractions |
| Boilerplate & scaffolding (CRUD, DTOs, fixtures, mocks) | Security-sensitive code (auth, crypto, secrets, permissions) |
| Mechanical edits across many files (renames, prop propagation, import updates) | Concurrency, performance-critical paths, subtle correctness |
| Lint / formatting / type-error fixes | Ambiguous / underspecified requirements needing judgment |
| Docstrings, comments, README / changelog sections | Public API / interface design, breaking changes |
| Straightforward data transforms or migrations with a clear spec | Debugging unknown root causes |
| Obvious glue code / format conversions | Anything costly or hard to detect if the edit is wrong |

**Rule of thumb:** high volume + low risk → delegate. Low volume + high risk → keep it. Unsure → keep it.

- 📄 Full guide: [docs/DELEGATION.md](docs/DELEGATION.md) — how triggering works and how to customize the conditions.
- 📋 Drop-in policy: [docs/delegation-policy.md](docs/delegation-policy.md) — the exact block to paste into `CLAUDE.md` / `AGENTS.md` (this table plus preconditions and briefing tips).

Install it during setup with `--policy` (or tick the boxes in the web configurator) — idempotent, safe to run more than once:

```bash
bash /tmp/ocd-install.sh --model "…" --targets "claude,codex" --policy "claude,codex"
```

## Dynamic model / provider switching

You install once; you reconfigure as often as you like. A single config file is read **fresh on every call**, so switching the cheap model, provider, or any other setting never requires reinstalling. Four equivalent ways:

1. **Web configurator → "Update settings" tab** — generates a one-line `config set` command.
2. **Terminal CLI** (works wherever the server is installed):
   ```bash
   node ~/.local/share/opencode-delegate-mcp/dist/index.js config set --model openrouter/minimax/minimax-m2.5
   node ~/.local/share/opencode-delegate-mcp/dist/index.js config get
   ```
3. **From your agent**, via the tool:
   ```jsonc
   // set_delegate_config
   { "default_model": "openrouter/minimax/minimax-m2.5" }   // switch provider+model
   { "default_model": "minimax-coding-plan/MiniMax-M2.7-highspeed", "timeout_ms": 900000 }
   ```
4. **Edit the file** directly: `~/.config/opencode-delegate/config.json`.

### `config` CLI

```
node dist/index.js config get                     # print current config
node dist/index.js config path                    # print config file path
node dist/index.js config set [flags]             # patch config (only provided flags change)

  --model <provider/model>   --agent <name>        --variant <name>
  --timeout <seconds>        --default-dir <path>  --opencode-bin <path>
  --auto-approve <bool>
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
