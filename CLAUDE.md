<!-- working-memory:start -->

## Working Memory

**AGENT INSTRUCTION:** before deciding what to read, scan the on-demand table under `## Working Memory` in [`AGENTS.md`](AGENTS.md). If your task matches a row, that file is required reading before you proceed.

Always read `_working-memory/activeContext.md` on session start. AGENTS.md is the canonical source for the on-demand table and update rules.
To sync working memory, run `/update-working-memory` or invoke the `working-memory-synchronizer` agent.

<!-- working-memory:end -->

## Git workflow

- Never add `Co-Authored-By` trailers or other "coauthored" attribution to commit messages or PR descriptions.
- Never push automatically. Commit only when asked, and never run `git push` or a force-push without an explicit request; leave pushing to the maintainer.
