# When does Claude Code / Codex actually delegate?

Installing `opencode-delegate` gives your primary agent the tools (`delegate_task`, `delegate_tests`, …). But **installing a tool does not force an agent to use it** — the primary model decides when to call it. This page explains what drives that decision and how to control it.

## What makes an agent delegate

An agent (Claude Code, Codex) reaches for a tool based on three things:

1. **Availability** — the MCP server is installed and its tools are listed. ✅ (the installer handles this)
2. **Tool descriptions** — each tool ships with a description telling the model what it's for and when to use it. This nudges the model but is not a guarantee.
3. **Your agent instructions** — the strongest, fully-in-your-control lever. This is a file the agent reads on every run:
   - **Claude Code** → `CLAUDE.md` (project root, or global `~/.claude/CLAUDE.md`)
   - **Codex** → `AGENTS.md` (project root or repo root, or global `~/.codex/AGENTS.md`)

If you want delegation to happen **reliably and on your terms**, add a delegation policy to that file. That is exactly what [`delegation-policy.md`](delegation-policy.md) is for — a drop-in block you can paste and then **edit to change the conditions**.

## The default policy (editable)

The shipped policy delegates **high-volume, low-risk** work and keeps **high-risk / judgment** work on the primary model:

| Delegate to the cheap model | Keep on the primary model |
| --- | --- |
| Tests for well-specified behavior (`delegate_tests`) | Architecture, system design, abstractions |
| Boilerplate & scaffolding (CRUD, DTOs, fixtures) | Security-sensitive code (auth, crypto, secrets) |
| Mechanical edits across many files (renames, prop propagation) | Concurrency / performance / subtle correctness |
| Lint / format / type-error fixes | Ambiguous or underspecified requirements |
| Docstrings, comments, README sections | Public API / interface design |
| Straightforward transforms & migrations | Debugging unknown root causes |
| Obvious glue code / format conversion | Anything costly or hard to detect if wrong |

**Rule of thumb:** high volume + low risk → delegate; low volume + high risk → keep it; unsure → keep it.

Full text, including preconditions and how to brief the subagent, is in [`delegation-policy.md`](delegation-policy.md).

## Install it into your agent

**Automatically (during install):** add `--policy` to the installer, or tick the boxes in the [web configurator](https://mryesiller.github.io/opencode-delegate-mcp/):

```bash
bash /tmp/ocd-install.sh --model "…" --targets "claude,codex" --policy "claude,codex"
```

This appends the policy block to `~/.claude/CLAUDE.md` and/or `~/.codex/AGENTS.md` (idempotent — it won't duplicate). It prints the exact path so you can move or edit it.

**Manually:** copy [`delegation-policy.md`](delegation-policy.md) into the instruction file your agent reads:

```bash
# Claude Code (global)
cat ~/.local/share/opencode-delegate-mcp/docs/delegation-policy.md >> ~/.claude/CLAUDE.md
# Codex (global)
cat ~/.local/share/opencode-delegate-mcp/docs/delegation-policy.md >> ~/.codex/AGENTS.md
# …or paste it into a project-level CLAUDE.md / AGENTS.md to scope it to one repo.
```

## Changing the conditions

The policy is just markdown between two markers:

```
<!-- opencode-delegate-mcp:policy:start -->
…your rules…
<!-- opencode-delegate-mcp:policy:end -->
```

Open the file and edit freely:
- **Delegate more** → move items from the "keep" column to the "delegate" column, or add a line like *"Delegate any change touching only `**/*.test.ts`."*
- **Delegate less** → add exclusions, e.g. *"Never delegate anything under `src/auth/` or `src/payments/`."*
- **Force a directory default** → *"Always pass `directory` = the current repo root."*
- **Cost guardrail** → *"Only delegate tasks you expect to touch ≥ 3 files."*

Project-level files (a `CLAUDE.md` / `AGENTS.md` committed in a repo) override or extend your global policy, so different projects can have different rules.

## Triggering it in the moment

Even without a written policy you can always delegate explicitly:

> "Delegate this to the cheap model: add tests for `src/utils/date.ts` in this repo."
> "Use delegate_task to fix all the TypeScript errors in `packages/api`."

The policy just makes the agent do it **on its own** for the cases you defined.

## Verifying it works

1. After editing the instruction file, **restart the agent** (or reload MCP servers) so it re-reads instructions.
2. Give it a clearly delegable task (e.g. "write tests for module X").
3. Watch for a `delegate_task` / `delegate_tests` tool call. If it does the work itself instead, make the policy more explicit or ask it directly.
