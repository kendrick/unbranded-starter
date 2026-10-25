#!/usr/bin/env bash
# Publishes one pin-health run's result: a PR for a repair or a hold, or a comment on the bump PR for an escalation. The workflow runs it after the scope guard, the classify step, and (for a repair) validation. Design: .github/control-loops/pin-health.md.
#
# Inputs, from the environment:
#   OUTCOME             repair, hold, or escalate, from scripts/pin-health-classify.mjs
#   PUSH_TOKEN          token for the push (PIN_BUMP_TOKEN, so CI runs on the PR)
#   GITHUB_REPOSITORY   owner/repo
#   LOOP_LABEL          label for loop PRs (default agent-pin-health)
#   PIN_HEALTH_TARGET   controller output (default /tmp/pin-health/target.json)
#   PIN_HEALTH_BODY     the agent's final message (default /tmp/pr-body.md)
# gh must be on PATH and authenticated through GH_TOKEN.
set -euo pipefail

target_json=${PIN_HEALTH_TARGET:-/tmp/pin-health/target.json}
body=${PIN_HEALTH_BODY:-/tmp/pr-body.md}
label=${LOOP_LABEL:-agent-pin-health}
memory=.github/agent-memory/pin-health.md
work=$(mktemp -d)

target=$(jq -r '.target' "$target_json")
branch=$(jq -r '.branch' "$target_json")
unit=$(jq -r '.unit' "$target_json")
pr=$(jq -r '.pr.number' "$target_json")
sha=$(jq -r '.pr.headRefOid' "$target_json")

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'

case "$OUTCOME" in
	escalate)
		# Both targets name a bump PR: main-drift is the one whose failure main shares. The marker goes on that PR with its head SHA, which is what the controller checks before picking it again, so neither kind of escalation gets paid for twice on the same commit.
		{ cat "$body"; printf '\n\n<!-- agent-pin-health:escalated sha=%s -->\n' "$sha"; } > "$work/comment.md"
		gh pr comment "$pr" --body-file "$work/comment.md"
		echo "No changes; reported on #$pr ($target)."
		exit 0
		;;
	hold)
		# The checkout sits on the bump branch, and a hold rejects that bump. Committing the hold there would carry the bump into main with no validation, so only the memory change moves, onto main.
		git diff HEAD -- "$memory" > "$work/hold.patch"
		git reset -q --hard HEAD
		git checkout -q -B "$branch" origin/main
		if ! git apply --index "$work/hold.patch"; then
			echo "::error::The hold's change to $memory doesn't apply to origin/main. Record the hold by hand."
			exit 1
		fi
		title="chore(pin-health): recommend holding a $unit pin"
		;;
	repair)
		git add -A
		if [ "$target" = "main-drift" ]; then
			title="fix(manifest): repair the main-branch drift behind #$pr"
		else
			title="fix(manifest): land the $unit pin bump"
		fi
		;;
	*)
		echo "::error::Unknown OUTCOME '$OUTCOME'; expected repair, hold, or escalate."
		exit 1
		;;
esac

git commit -q -m "$title" -m "Pin-health loop result for #$pr. See the PR body for the diagnosis."
git push -q --force "https://x-access-token:${PUSH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "HEAD:refs/heads/$branch"

{ cat "$body"; printf '\n\nFollows up #%s.\n\n<!-- agent-pin-health -->\n' "$pr"; } > "$work/pr-body.md"
gh label create "$label" --description "Opened by the pin-health control loop" --color 0E8A16 2> /dev/null || true
gh pr create --base main --head "$branch" --title "$title" --body-file "$work/pr-body.md" --label "$label"
