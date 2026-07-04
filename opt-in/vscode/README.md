# opt-in: vscode

Shared VS Code workspace config.

## What lands

- `.vscode/settings.json`: merged into whatever you already have (your keys win), never overwritten wholesale.
- `.vscode/extensions.json`: generated from the units you selected, so the recommendation list matches your tooling. Unions into an existing file instead of replacing it.

## Notes

- The settings baseline assumes ESLint drives formatting (format-on-save through the ESLint extension) and Stylelint owns CSS. Tweak it per project.
- extensions.json is computed at scaffold time, so re-running with a different selection folds the new recommendations in without dropping the ones you already had.
