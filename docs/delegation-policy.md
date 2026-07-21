<!-- opencode-delegate-mcp:policy:start -->
## Delegation policy — opencode-delegate

You have an MCP server named **`opencode-delegate`** that runs a **cheaper model** through OpenCode. Use it to offload high-volume, low-risk work so your own (expensive) reasoning stays on the hard parts. Treat a delegated result like a junior engineer's PR: brief it well, then review what comes back.

Tools: `delegate_task` (general), `delegate_tests` (tests). The subagent does **not** see this conversation — put full context, file paths, constraints, and acceptance criteria in the task. Pass the repo path as `directory`. Note the field name: `delegate_task` takes `task`, `delegate_tests` takes `scope` (each also accepts the other's name as an alias, but prefer the correct one).

### ✅ Delegate when the task is high-volume / low-risk
- Writing tests for existing, well-specified behavior → prefer `delegate_tests`.
- Boilerplate & scaffolding: CRUD, DTOs, config files, fixtures, mocks.
- Mechanical, repetitive edits across many files: renames, signature/prop propagation, import updates, call-site changes.
- Lint, formatting, and type-error fixes with a clear target.
- Docstrings, comments, and README/changelog sections for existing code.
- Straightforward data transforms or migrations with a clear spec.
- Obvious glue code / format conversions.
- Anything you could fully specify in one paragraph with clear acceptance criteria and a small blast radius.

### ⛔ Do it yourself — do NOT delegate
- Architecture, system design, choosing abstractions or dependencies.
- Security-sensitive code: auth, crypto, input validation, secrets, permissions.
- Concurrency, performance-critical paths, or subtle correctness.
- Ambiguous / underspecified requirements that need judgment or clarification.
- Public API / interface design and breaking changes.
- Debugging non-obvious failures where the root cause is unknown.
- Anything where a wrong edit is costly or hard to detect.

### Before delegating, check
1. The task is **self-contained** — briefable without the chat history.
2. There are **clear acceptance criteria**, ideally verifiable (tests / typecheck / build).
3. The `directory` is a **repo you trust** — delegations run with tools auto-approved (they can edit files and run commands).

### After delegating
- Read the returned summary + the actions/diff. Verify against your acceptance criteria (run tests / typecheck) before accepting.
- If it went wrong, either fix it yourself or re-delegate with a sharper brief and the `session` id to continue.

### Heuristic
High volume + low risk → **delegate**. Low volume + high risk → **keep it**. When unsure, keep it.

> Edit the lists above to match your project — tighten or loosen what gets delegated.
<!-- opencode-delegate-mcp:policy:end -->
