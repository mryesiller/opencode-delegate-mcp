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

## Why this exists

**The problem:** frontier models (Claude, GPT-class) are your best tool for architecture, hard bugs, and judgment calls — and expensive overkill for the mechanical majority of real coding work: boilerplate, tests, lint/type fixes, repetitive multi-file edits. Doing all of it with your primary agent burns premium tokens and fills its context with busywork instead of the decisions that actually need it.

**What this tool does:** it gives your primary agent a tool to hand that busywork to a cheaper model — or a free one — running through OpenCode, without leaving your workflow. The primary agent stays focused on what matters; the cheap model grinds through the repetitive stuff and reports back. Which model does the work is a config change, not a redeploy — switch it any time.

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

### Let your AI install it for you

You don't have to run this yourself — paste the block below into Claude Code, Codex, or any coding agent with shell access. It'll run the command, read the output, and fix common problems (missing prerequisite, unauthenticated provider) itself instead of just reporting them.

> Install and register the opencode-delegate-mcp MCP server for me. Use `opencode/deepseek-v4-flash-free` (free, no signup) as the default model unless I say otherwise, register it with whichever of Claude Code / Codex you find on my machine, and use "user" scope (available in all my projects) unless I ask for "project" or "local" scope instead.
>
> Run:
> ```bash
> curl -fsSL https://mryesiller.github.io/opencode-delegate-mcp/install.sh | bash -s -- --model "opencode/deepseek-v4-flash-free" --targets "claude,codex"
> ```
>
> Then show me the output, flag any warnings (missing OpenCode, unauthenticated provider, PATH issues), and confirm it's registered by running `claude mcp list` and/or `codex mcp list`. If something fails, diagnose and fix it rather than just reporting it.

The web configurator generates this same prompt for you, kept in sync with whatever model/targets/scope you pick in the form — see the "Prefer to have your AI do it?" card.

### Scope: global, project, or local

By default the installer registers the server **globally** (`user` scope) — available in every project on this machine. Pass `--scope` to change that, and `--project-dir` to pick which project (defaults to the directory you run the installer from):

```bash
curl -fsSL https://mryesiller.github.io/opencode-delegate-mcp/install.sh | bash -s -- --model "…" --scope project --project-dir "$(pwd)"
```

| `--scope` | Claude Code | Codex | OpenCode |
| --- | --- | --- | --- |
| `user` (default) | `~/.claude.json` — all your projects | `~/.codex/config.toml` — all your projects | `~/.config/opencode/opencode.json` — all your projects |
| `project` | `.mcp.json` in the project — commit it to share with your team, but **needs one-time approval** | `.codex/config.toml` in the project — **only loads for trusted projects** | `opencode.json` in the project |
| `local` | Private to you, this project only (Claude Code's native local scope) | falls back to `project` (Codex has no separate local tier) | falls back to `project` (OpenCode has no separate local tier) |

Both hosts gate project-scoped config behind a one-time human approval — this isn't optional and an unattended script can't do it for you: Claude Code shows it as "⏸ Pending approval" in `claude mcp list` until you run `claude` interactively in that directory and approve it; Codex only loads a project's `.codex/config.toml` once you've approved that project as trusted, the first time you run `codex` there. Re-running the installer with a different `--scope` cleanly moves the registration (Claude Code: removed from every scope before re-adding at the new one; Codex/OpenCode: the old file entry is left as-is, so remove it by hand if you're switching away from `project`).

### Requirements
- Node.js ≥ 18, npm, git, and curl.
- [OpenCode](https://opencode.ai) — the installer sets this up for you automatically if it's missing (see below), no separate step needed.
- A provider authenticated (`opencode auth login`) — **unless** you use one of OpenCode's free `opencode/*` models below, which need no signup or API key at all.

### If OpenCode isn't installed yet

The installer detects this and runs OpenCode's official installer for you — no separate step needed. One thing to know: OpenCode's installer adds `~/.opencode/bin` to your shell's PATH by editing your rc file, but **that only takes effect in new terminal sessions**. So right after a fresh install, the `opencode` command may still say "not found" in your *current* terminal — that's expected. The delegate MCP itself isn't affected (it's configured with the full path), but to use the `opencode` command yourself, either open a new terminal tab or run `source ~/.zshrc` (or your shell's rc file — the installer tells you exactly which one).

Prefer to control this yourself? Pass `--no-install-opencode` to skip auto-install, or install OpenCode manually first from [opencode.ai](https://opencode.ai).

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

Profiles are **merged**, not replaced — existing ones survive unless you name them (an empty `{ "profiles": {} }` patch is a no-op, it won't wipe your profiles). To remove a profile, set its value to `null`:

```jsonc
// set_delegate_config
{ "profiles": { "tests": null } }   // removes just "tests"; other profiles are untouched
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
