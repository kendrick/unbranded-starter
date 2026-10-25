# Response Template

Your final message becomes the PR body when you changed files, or a comment on the bump PR when you didn't. Write it in GitHub-flavored markdown, in this shape, and fill every bracket. Start straight at the heading, with nothing before it.

```markdown
## Pin Health: [repair | hold | escalate] for `[unit]`

[One or two sentences: which bump PR (#N) or main-drift, which job failed, and what this change does about it.]

| | |
| --- | --- |
| Target | [#N `bump/<unit>`, or main-drift seen on #N] |
| Failing job | [job name, as ci.yml names it] |
| Cause | [bump-caused, drift, or upstream-incompatible] |
| Risk | [low, medium, or HIGH] |

### Evidence

[The log line the diagnosis rests on, in a code block, and the file and line it points at.]

### Change

- `[path]`: [what changed and why]

[For a hold, the memory bullet you added. For an escalation, "No files changed."]

### Validation

- [PASS/FAIL] `node scripts/pin-health-validate.mjs all`
- [PASS/FAIL] Reproduction: `[UB_…=… pnpm vitest run --config vitest.e2e.config.ts <spec>]`
- Not run locally: [the Windows legs, or anything else CI covers that you didn't]

### For the Reviewer

[What to check first. For a hold, the decision you're being asked to make (close #N, or open an issue to hold the line in the tooling). For an escalation, what you'd try next.]
```

Keep it short. A reviewer reads this before the diff, so lead with the outcome and the evidence, and leave out the narrative of how you got there.
