#!/usr/bin/env bash
# Lays the trusted copy's memory file over the target checkout and commits it locally as the run's baseline, so the agent edits main's memory and every later step measures the agent's change against that. Design: .github/control-loops/pin-health.md.
#
# A bump branch cut before the loop landed has no memory file. Without this, a hold recorded there was a new-file patch that couldn't apply to main, and the overlay alone would read as a hold (PR #235 review). The baseline commit never leaves the runner: scripts/pin-health-publish.sh drops it from a repair and moves only a hold's diff onto main.
#
# Run from the target checkout, after "Check out the target branch". Needs PIN_HEALTH_TOOLING. Writes `baseline=<sha>` to GITHUB_OUTPUT when that's set.
set -euo pipefail

memory=.github/agent-memory/pin-health.md

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
mkdir -p "$(dirname "$memory")"
cp "$PIN_HEALTH_TOOLING/$memory" "$memory"
git add -- "$memory"
# --allow-empty: on a current bump branch the overlay matches, and the baseline still needs to be a commit of its own so the publish step can always drop exactly one.
git commit -q --allow-empty --no-verify -m "pin-health: memory baseline (never published)"
baseline=$(git rev-parse HEAD)
echo "Memory baseline at $baseline"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "baseline=$baseline" >> "$GITHUB_OUTPUT"; fi
