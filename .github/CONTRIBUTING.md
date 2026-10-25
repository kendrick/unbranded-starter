# Contributing

Bug reports are welcome. Open an issue with the command you ran, what it printed, and what you expected.

Issues labeled `maintainer-driven` are already planned, and the maintainer works them in a set order. Some are blocked on others so that related fixes share one design. Please don't open a pull request for one of these. If you have a reproduction or a fix idea, comment on the issue, and the maintainer will fold it in.

For any other change, open an issue first so you and the maintainer can agree on the approach before you write code. A pull request needs `pnpm lint && pnpm typecheck && pnpm test` to pass, plus a test that fails without the change.
