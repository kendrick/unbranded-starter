#!/usr/bin/env python3
"""Regression suite for check-job-spec.py (#132). Two kinds of case:

1. The real #117 corpus (`.agent-guild/state/archive/2026-08-10-issue-117/`)
   must still pass, run against a pinned fixture repo-root rather than this
   live repo. The corpus cites `conventions.md:65`, and that line still
   resolves in the live repo today, but it no longer names the bullet it
   did when #117 shipped: #117's own commit grew the file out from under
   its own citation. A test pinned to live files rots the moment someone
   edits them, so the fixture repo-root fixes the cited files' line
   numbers by construction instead.
2. Each of #117's own audit findings, reproduced as a one-line mutation of
   that same corpus, must fire the rule that would have caught it.

Every script runs as a subprocess, so these tests exercise the real CLI
contract (exit codes, stderr) rather than internals.

Run: python3 .agent-guild/scripts/test_check_job_spec.py
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(SCRIPTS_DIR, "check-job-spec.py")

sys.path.insert(0, SCRIPTS_DIR)
from _corpus import (  # noqa: E402
    ARCHIVE_117 as ARCHIVE_DIR, add_owns, repair_c1_delegation,
)

passed = failed = 0


def check(label, cond, detail=""):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {label}")
    else:
        failed += 1
        print(f"  FAIL {label}  {detail}")


def run_linter(*argv):
    proc = subprocess.run(
        [sys.executable, SCRIPT, *argv], capture_output=True, text=True
    )
    return proc.returncode, proc.stdout, proc.stderr


def rule_hit(err, rule):
    """A rule id appears as its own token, e.g. don't let a search for R1
    match inside R10 or R12."""
    return re.search(rf"(?<!\d){re.escape(rule)}(?!\d)", err) is not None


def write_lines(path, lines):
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def write_exec(path, content):
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    os.chmod(path, 0o755)


def mutate(path, old, new, label):
    """Apply a one-line string replacement and prove it actually landed—a
    mutation that silently no-ops (because the corpus text moved under it)
    would make the case that follows pass for no reason."""
    with open(path, encoding="utf-8") as f:
        content = f.read()
    count = content.count(old)
    check(f"{label}: mutation string found exactly once", count == 1, f"count={count} old={old!r}")
    if count != 1:
        return False
    with open(path, "w", encoding="utf-8") as f:
        f.write(content.replace(old, new, 1))
    return True


def copy_corpus_state(state_dir):
    """The linter's own inputs are just constitution.md + tasks/; the rest
    of the archive (verdicts, notes, log, briefs) is run history it never
    reads."""
    os.makedirs(state_dir)
    shutil.copy(
        os.path.join(ARCHIVE_DIR, "constitution.md"),
        os.path.join(state_dir, "constitution.md"),
    )
    shutil.copytree(
        os.path.join(ARCHIVE_DIR, "tasks"), os.path.join(state_dir, "tasks")
    )
    add_weight_line(state_dir)
    repair_c1_delegation(state_dir)


WEIGHT_LINE_TEXT = (
    "**Job weight**: deep, back-filled by this suite: the #117 corpus "
    "predates the weight line (#123)"
)


def add_weight_line(state_dir):
    """Insert a `**Job weight**:` line right after the constitution's title,
    mirroring how add_owns()/add_dep_rationale() back-fill fields the #117
    corpus predates (#133, #125)—the corpus shipped before #123 added the
    line R17/R18 read. Deep, so back-filling it never trips R18 by
    accident: the ceiling is a separate concern from whether the corpus
    carries a weight at all. Mutates constitution.md on disk."""
    const_path = os.path.join(state_dir, "constitution.md")
    with open(const_path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    assert lines and lines[0].startswith("# "), f"{const_path}: no title line to insert the weight line after"
    lines.insert(1, WEIGHT_LINE_TEXT)
    with open(const_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


# add_owns lives in _corpus.py because test_ready_set.py replays this same
# corpus and needs the identical derivation. Two copies would drift, and a
# fixture that derives `owns` differently from the one the linter was proved
# against is a fixture agreeing with itself about the wrong thing.


DEPS_LINE_RE = re.compile(r"^deps:\s*(\[.*\])\s*$")


def add_dep_rationale(state_dir):
    """Give every task in `state_dir/tasks/` a `dep_rationale:` entry for
    each id in its own `deps:`—the #117 corpus predates #125, so
    `dep_rationale` doesn't exist in it yet. Every corpus `deps:` is the
    flat `[T-001, ...]` shape (unlike `artifacts:`, which mixes flat and
    block), so this only needs to parse that one form. A task whose `deps`
    is empty still gets an explicit `dep_rationale: []`, mirroring how
    add_owns() always inserts a field rather than leaving it absent.
    Mutates the task files on disk."""
    tasks_dir = os.path.join(state_dir, "tasks")
    for name in sorted(os.listdir(tasks_dir)):
        path = os.path.join(tasks_dir, name)
        with open(path, encoding="utf-8") as f:
            lines = f.read().splitlines()
        out = []
        inserted = False
        for line in lines:
            out.append(line)
            if not inserted:
                m = DEPS_LINE_RE.match(line)
                if m:
                    dep_ids = [d.strip() for d in m.group(1)[1:-1].split(",") if d.strip()]
                    if dep_ids:
                        out.append("dep_rationale:")
                        out.extend(f"  - {dep_id}: fixture rationale for R14 tests" for dep_id in dep_ids)
                    else:
                        out.append("dep_rationale: []")
                    inserted = True
        assert inserted, f"{name}: no deps: field found to derive dep_rationale from"
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(out) + "\n")


# The matching-pair quote-strip line the corpus cites twice (T-001.md:57,
# against compose-brief.py:64 and check-provenance.py:74). Built by
# concatenation rather than an escaped literal so the quoting is legible;
# verified byte-for-byte against the real compose-brief.py:64 while writing
# this suite.
MATCH_LINE = (
    "        if len(val) >= 2 and val[0] == val[-1] and val[0] in "
    + '"' + "\\" + '"' + "'" + '"' + ":"
)


def build_fixture_repo_root(root):
    """A pinned stand-in for the repo root, holding only what the corpus
    actually needs. compose-brief.py and check-provenance.py carry the
    cited snippet on the exact line the corpus cites (:64 and :74)
    regardless of what the live copies say today; conventions.md is pinned
    the same way for its :65 citations. check-build.sh and
    check-diff-scope.py are executable stubs, since R5 never runs them—it
    only checks X_OK and, for check-build.sh, that the quoted inner command
    parses—so their bodies don't need to do anything.

    Returns the line number of the fixture's "## Prose Voice" heading, which
    M2 redirects a citation onto.
    """
    scripts_dir = os.path.join(root, ".agent-guild", "scripts")
    os.makedirs(scripts_dir)
    wm_dir = os.path.join(root, "_working-memory")
    os.makedirs(wm_dir)

    write_exec(os.path.join(scripts_dir, "check-build.sh"), "#!/usr/bin/env bash\nexit 0\n")
    write_exec(
        os.path.join(scripts_dir, "check-diff-scope.py"),
        "#!/usr/bin/env python3\nimport sys\nsys.exit(0)\n",
    )

    # compose-brief.py: line 64 pinned to the cited snippet. Filler lines
    # avoid a leading '#'—R3's heading check is scoped to .md targets, but
    # there's no reason to hand a stray edge case a chance to misfire here.
    cb_lines = [f"x_{i} = None  # filler" for i in range(1, 64)]
    cb_lines.append(MATCH_LINE)  # line 64
    cb_lines += [f"x_{i} = None  # filler" for i in range(65, 70)]
    write_lines(os.path.join(scripts_dir, "compose-brief.py"), cb_lines)

    # check-provenance.py: same snippet, pinned at line 74.
    cp_lines = [f"x_{i} = None  # filler" for i in range(1, 74)]
    cp_lines.append(MATCH_LINE)  # line 74
    cp_lines += [f"x_{i} = None  # filler" for i in range(75, 80)]
    write_lines(os.path.join(scripts_dir, "check-provenance.py"), cp_lines)

    # conventions.md: the Prose Voice bullet pinned at line 65 (what every
    # unmutated "conventions.md:65" citation in the corpus resolves to), with
    # a real heading earlier in the file for M2 to redirect onto.
    conv_lines = [f"<!-- filler {i} -->" for i in range(1, 60)]
    prose_heading_line = 60
    conv_lines.append("## Prose Voice (docs and comments)")  # line 60
    conv_lines += [f"<!-- filler {i} -->" for i in range(61, 65)]
    conv_lines.append(
        "- Em dashes chain directly to the text on both sides—like this—never "
        "wrapped in spaces. Don't hard-wrap prose lines; let the display wrap. "
        "Headings are Title Case. Comments explain the why, not the what."
    )  # line 65
    conv_lines += [f"<!-- filler {i} -->" for i in range(66, 70)]
    write_lines(os.path.join(wm_dir, "conventions.md"), conv_lines)

    return prose_heading_line


MINIMAL_CONSTITUTION = """# Constitution: CLI fixture

**Job weight**: deep, synthetic fixture; deep so no case couples to a clause count

## Clauses

### C-1: trivial clause
- **text**: The output file exists and is non-empty.
- **check**: checker-judgment: confirm the output file exists and has content.
- **severity**: minor
- **failing example**: the output file is empty or missing.

## Protected content

- none.

## Non-goals

- none.
"""


def write_synthetic_state(d, tasks, constitution_text=MINIMAL_CONSTITUTION):
    """A minimal state dir: `constitution_text` (MINIMAL_CONSTITUTION by
    default) plus one task file per entry in `tasks`, each `{"id",
    "artifacts", "deps"}`. For the build rules (R8, R16), where what
    matters is which paths a task claims and who depends on whom, and the
    corpus is the wrong instrument because its own build graph is the
    thing under test elsewhere. No `owns`, so R13/R14/R15 have nothing to
    say about these fixtures. `constitution_text` is overridable so R17/R18
    can reuse this same task-writing shape against a constitution with a
    different weight line or clause count, rather than a second copy of
    the same frontmatter template."""
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(os.path.join(state, "constitution.md"), constitution_text.splitlines())
    for t in tasks:
        artifacts_block = "\n".join(f"  - {a}" for a in t["artifacts"])
        write_lines(
            os.path.join(state, "tasks", f"{t['id']}.md"),
            f"""---
id: {t['id']}
title: Synthetic {t['id']}
spec: .agent-guild/state/spec.md#one
clauses: [C-1]
executor: worker-standard
executor_model: sonnet
checker: checker-judgment
check_method: >-
  C-1: checker-judgment: confirm the output file exists and has content.
status: pending
retries: 0
max_retries: 2
deps: [{', '.join(t.get('deps', []))}]
escalations: []
artifacts:
{artifacts_block}
---

## Spec excerpt

Writes {', '.join(t['artifacts'])}.
""".splitlines(),
        )
    return state


def raw_shell_constitution(check_line):
    return f"""# Constitution: R4 fixture

**Job weight**: deep, synthetic fixture; deep so no case couples to a clause count

## Clauses

### C-1: build succeeds
- **text**: The build passes.
- **check**: {check_line}
- **severity**: minor
- **failing example**: the build never runs.

## Protected content

- none.

## Non-goals

- none.
"""


# ------------------------------------------- R17/R18/boundary fixture helpers

def clause_citation_constitution(citation):
    """A single-clause, deep-weight constitution whose last clause's own
    block—before any trailing section—carries `citation`. Deep weight keeps
    R18 out of every citation-boundary case, since what's under test there
    is where a defect gets attributed, not the ceiling."""
    return f"""# Constitution: citation-boundary fixture

**Job weight**: deep, synthetic fixture; deep so no case couples to a clause count

## Clauses

### C-1: trivial clause
- **text**: The output file exists and is non-empty.
- **check**: checker-judgment: confirm the output file exists and has content.
- **severity**: minor
- **failing example**: the output file is empty or missing; see `{citation}` for the real check.

## Protected content

- none.

## Non-goals

- none.
"""


def trailing_section_citation_constitution(citation):
    """Same shape, but `citation` sits in `## Protected content` instead of
    the clause block—the section #160 stopped silently folding into the
    last clause's own tail."""
    return f"""# Constitution: citation-boundary fixture

**Job weight**: deep, synthetic fixture; deep so no case couples to a clause count

## Clauses

### C-1: trivial clause
- **text**: The output file exists and is non-empty.
- **check**: checker-judgment: confirm the output file exists and has content.
- **severity**: minor
- **failing example**: the output file is empty or missing.

## Protected content

- see `{citation}` for the reference implementation.

## Non-goals

- none.
"""


def clause_block(n):
    """One mechanically generated `### C-N:` block. Used only by
    weighted_constitution below, where what's under test is the clause
    COUNT and the weight WORD, never a clause's own content."""
    return (
        f"### C-{n}: clause {n}\n"
        f"- **text**: Clause {n} states a falsifiable standard.\n"
        f"- **check**: checker-judgment: confirm clause {n}'s standard holds.\n"
        f"- **severity**: minor\n"
        f"- **failing example**: clause {n}'s standard is violated.\n"
    )


def weighted_constitution(weight_line, n_clauses, overrun_line=None):
    """A constitution carrying `weight_line` verbatim after `**Job
    weight**:` and exactly `n_clauses` generated clauses—R17/R18's whole
    input surface. `overrun_line` is omitted when None, present (even if
    empty, to exercise the empty-reason case) otherwise."""
    overrun_block = f"**Ceiling overrun**: {overrun_line}\n" if overrun_line is not None else ""
    clauses_block = "\n".join(clause_block(i) for i in range(1, n_clauses + 1))
    return f"""# Constitution: weight/ceiling fixture

**Job weight**: {weight_line}
{overrun_block}
## Clauses

{clauses_block}

## Protected content

- none.

## Non-goals

- none.
"""


def constitution_without_weight_line(n_clauses=1):
    """weighted_constitution's twin with no `**Job weight**:` line at
    all—R17's missing-line case, which weighted_constitution can't express
    since it always writes the line."""
    clauses_block = "\n".join(clause_block(i) for i in range(1, n_clauses + 1))
    return f"""# Constitution: weight/ceiling fixture

## Clauses

{clauses_block}

## Protected content

- none.

## Non-goals

- none.
"""


def weighted_task(task_id, clause_id, artifact):
    """One task citing exactly one clause—used to build a decomposition
    where every clause weighted_constitution generated is wired to a task,
    so R6 (clause wiring) and R7 (DAG) clear before R17/R18 get a turn
    under --audit-id DEC-audit."""
    return f"""---
id: {task_id}
title: Weighted fixture {task_id}
spec: .agent-guild/state/spec.md#one
clauses: [{clause_id}]
executor: worker-standard
executor_model: sonnet
checker: checker-judgment
check_method: >-
  {clause_id}: checker-judgment: confirm the output file exists and has content.
status: pending
retries: 0
max_retries: 2
deps: []
escalations: []
artifacts:
  - {artifact}
---

## Spec excerpt

Writes {artifact}.
"""


# --------------------------------------------------------------- CLI basics
print("CLI basics")

rc, out, err = run_linter("--self-test")
check("--self-test: exit 0", rc == 0, f"rc={rc} err={err}")

with tempfile.TemporaryDirectory() as d:
    missing_state = os.path.join(d, "does-not-exist")
    rc, out, err = run_linter(missing_state, "--repo-root", d, "--audit-id", "CON-audit")
    check("missing state dir: exit 3, not 1", rc == 3, f"rc={rc} err={err}")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(os.path.join(state, "constitution.md"), MINIMAL_CONSTITUTION.splitlines())
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
    check("empty tasks/, DEC-audit: exit 1", rc == 1, f"rc={rc} err={err}")

    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("same empty tasks/, CON-audit: exit 0, not 1", rc == 0, f"rc={rc} err={err}")

# ------------------------------------------------------- R4: #121's criterion
print("R4: inline shell in a check field (#121)")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(
        os.path.join(state, "constitution.md"),
        raw_shell_constitution("bash -c 'pytest && echo ok'").splitlines(),
    )
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("bash -c wrapping a shell block: exit 1", rc == 1, f"rc={rc} err={err}")
    check("bash -c wrapping a shell block: R4 named", rule_hit(err, "R4"), f"err={err!r}")
    check("bash -c wrapping a shell block: no traceback", "Traceback" not in err, f"err={err!r}")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(
        os.path.join(state, "constitution.md"),
        raw_shell_constitution("pytest && echo ok").splitlines(),
    )
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("raw pipeline, no .agent-guild/scripts/ prefix: exit 1", rc == 1, f"rc={rc} err={err}")
    check("raw pipeline: R4 named", rule_hit(err, "R4"), f"err={err!r}")

# The other side of #121's line: a shell one-liner handed to the sanctioned
# runner is NOT the defect. Every check-build.sh invocation in the corpus
# (constitution C-1/C-3, T-002, T-003's two check-build.sh segments) is
# exactly that shape, so the base corpus pass below—run unmutated—is the
# proof this side stays green. T-003.md:13 in particular wraps a bespoke
# one-liner this way and DEC-r4 passed it.


def preamble_task(preamble_line):
    return f"""---
id: T-001
title: Preamble fixture
spec: .agent-guild/state/spec.md#one
clauses: [C-1]
executor: worker-standard
executor_model: sonnet
checker: checker-judgment
check_method: >-
  {preamble_line}
  C-1: checker-judgment: confirm the output file exists and has content.
status: pending
retries: 0
max_retries: 2
deps: []
escalations: []
artifacts:
  - out.txt
---

## Spec excerpt

Fixture body.
"""


# A #132 adversarial finding: R4's preamble scan used to fire on ANY
# mention of a script path ahead of a C-N: segment, not just one shaped
# like an invocation—blocking a check_method that merely names a suite for
# context (T-003's real preamble does exactly this: "The suite lives in
# .agent-guild/scripts/test_ledger_append.py. Run these three commands...").
print("R4: bare script mention in the preamble is not the #121 evasion")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(os.path.join(state, "constitution.md"), MINIMAL_CONSTITUTION.splitlines())
    write_lines(
        os.path.join(state, "tasks", "T-001.md"),
        preamble_task(
            "The suite lives in .agent-guild/scripts/test_thing.py. Run these commands in order."
        ).splitlines(),
    )
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
    check("bare mention, not invocation-shaped: exit 0", rc == 0, f"rc={rc} err={err}")

# The evasion itself has to stay caught: a preamble that OPENS with the
# script path reads as a command line, not prose naming it for context.
with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(os.path.join(state, "constitution.md"), MINIMAL_CONSTITUTION.splitlines())
    write_lines(
        os.path.join(state, "tasks", "T-001.md"),
        preamble_task(
            ".agent-guild/scripts/sneaky.sh --all handles everything, so nothing below matters."
        ).splitlines(),
    )
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
    check("invocation-shaped preamble: exit 1", rc == 1, f"rc={rc} err={err}")
    check("invocation-shaped preamble: R4 named", rule_hit(err, "R4"), f"err={err!r}")

# --------------------------------------------- corpus: baseline + mutations
if not os.path.isdir(ARCHIVE_DIR):
    print(f"note: corpus archive not found at {ARCHIVE_DIR} — skipping corpus-based "
          f"cases. This suite ships into user projects; the archive under state/ does "
          f"not, so the skip is expected there.")
else:
    with tempfile.TemporaryDirectory() as fixture_root:
        prose_heading_line = build_fixture_repo_root(fixture_root)

        # ------------------------------------------------------- corpus: baseline
        print("corpus: the shipped #117 state (DEC-audit-r4 PASS)")

        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
            # This single exit-0 also carries two things called out in the plan
            # that don't get their own case: R9 doesn't fire on any of T-007's
            # four load-bearing sentences (including "an absent fact is a FAIL,
            # never a pass carrying a finding"—the very fix M4 below reverts),
            # and every check-build.sh-wrapped shell block in the corpus passes
            # R4 (the other side of the #121 test above).
            check("unmutated corpus: exit 0", rc == 0, f"rc={rc} err={err}")

        # ---------------------------------------------------------- M1 (R2)
        # DEC-r0's D5: a citation stale by six lines (compose-brief.py:64 was
        # :58 by the time the auditor checked it).
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-001.md"),
                ".agent-guild/scripts/compose-brief.py:64",
                ".agent-guild/scripts/compose-brief.py:58",
                "M1",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("M1 stale code citation: exit 4 (heuristic)", rc == 4, f"rc={rc} err={err}")
                check("M1: R2 named", rule_hit(err, "R2"), f"err={err!r}")
                check("M1: no traceback", "Traceback" not in err, f"err={err!r}")

        # ---------------------------------------------------------- M2 (R3)
        # DEC-r2's D12: a citation landing on a heading rather than the prose
        # it meant to anchor.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-007.md"),
                "`_working-memory/conventions.md:65`",
                f"`_working-memory/conventions.md:{prose_heading_line}`",
                "M2",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("M2 citation lands on a heading: exit 1", rc == 1, f"rc={rc} err={err}")
                check("M2: R3 named", rule_hit(err, "R3"), f"err={err!r}")
                check("M2: no traceback", "Traceback" not in err, f"err={err!r}")

        # --------------------------------------------------------- M3 (R10)
        # W3, by class rather than by instance: this fixture is invented,
        # but it exercises the same defect shape W3 was—a count word
        # disagreeing with what follows it. W3 itself (C-9 naming a file by
        # role rather than by path) isn't something R10 can parse directly;
        # the template's "list what you name" note is the other half of
        # that fix.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-006.md"),
                "record three findings",
                "record four findings",
                "M3",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("M3 count disagrees with its list: exit 4 (heuristic)", rc == 4, f"rc={rc} err={err}")
                check("M3: R10 named", rule_hit(err, "R10"), f"err={err!r}")
                check("M3: no traceback", "Traceback" not in err, f"err={err!r}")

        # ---------------------------------------------------------- M4 (R9)
        # DEC-r3's D13: T-007's check_method restoring the pass-and-report
        # instruction is the actual defect this job exists to fix. This is
        # the pair test for R9's veto set—the unmutated corpus already
        # proved the four load-bearing sentences don't fire (see baseline
        # above); this proves the real defect still does.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-007.md"),
                "On C-6 or C-9, an absent fact is a FAIL, never a pass carrying a finding. For C-9",
                "On C-6 or C-9, an absent fact is the upstream task's defect: pass this task on "
                "that clause and file the gap as a major finding. For C-9",
                "M4",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("M4 pass-while-major instruction: exit 4 (heuristic)", rc == 4, f"rc={rc} err={err}")
                check("M4: R9 named", rule_hit(err, "R9"), f"err={err!r}")
                check("M4: no traceback", "Traceback" not in err, f"err={err!r}")

        # ---------------------------------------------------------- M5 (R8)
        # DEC-r0's D1: a terminal task that isn't actually terminal. Drops
        # T-007, not T-005—T-005 stays in T-003's transitive closure via
        # T-007, so dropping it wouldn't fire this rule at all.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-003.md"),
                "deps: [T-001, T-002, T-004, T-005, T-006, T-007]",
                "deps: [T-001, T-002, T-004, T-005, T-006]",
                "M5",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("M5 terminal task not terminal: exit 1", rc == 1, f"rc={rc} err={err}")
                check("M5: R8 named", rule_hit(err, "R8"), f"err={err!r}")
                check("M5: no traceback", "Traceback" not in err, f"err={err!r}")

        # -------------------------------------------------------- M6 (R12')
        # DEC-r1's D9: the "eleven" that survived the sweep—a count that
        # disagrees with the same fact stated in a different task's prose.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-004.md"),
                "Ten rows record",
                "Eleven rows record",
                "M6",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("M6 count disagrees across artifacts: exit 4 (heuristic)", rc == 4, f"rc={rc} err={err}")
                check("M6: R12 named", rule_hit(err, "R12"), f"err={err!r}")
                check("M6: no traceback", "Traceback" not in err, f"err={err!r}")

        # ------------------------------------------- P1 (R2, #132 adversarial)
        # An unrelated code aside sitting earlier in the SAME region used to
        # become the anchor for every citation in it, regardless of which
        # sentence either one was in—so a totally unrelated snippet could
        # veto a citation it has nothing to do with. T-001's real citation
        # (compose-brief.py:64, quoting the quote-stripping line) must stay
        # correct after the aside is inserted ahead of it.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-001.md"),
                "You need only `ref`.",
                "A totally unrelated aside: `for line in sorted(paths, key=len): pass` is how "
                "we iterate. You need only `ref`.",
                "P1",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("P1 unrelated code span leaves the real citation alone: exit 0", rc == 0, f"rc={rc} err={err}")

        # ------------------------------------------- P2 (R9, #132 adversarial)
        # The veto list used to fire on "not"/"no"/etc. ANYWHERE in the
        # sentence, so a genuine violation phrased with the negation next to
        # something OTHER than "pass" read as vetoed. This is arguably the
        # most natural way to write the defect R9 exists to catch.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-007.md"),
                "On C-6 or C-9, an absent fact is a FAIL, never a pass carrying a finding.",
                "If a named fact is not present, pass this task and file the gap as a major finding.",
                "P2",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("P2 negation not governing pass no longer vetoes: exit 4 (heuristic)", rc == 4, f"rc={rc} err={err}")
                check("P2: R9 named", rule_hit(err, "R9"), f"err={err!r}")
                check("P2: no traceback", "Traceback" not in err, f"err={err!r}")

        # ------------------------------------------ P3 (R10, #132 adversarial)
        # A number before a colon that isn't a count of the following list—
        # an issue id, here—used to be compared against the list length
        # anyway, deadlocking a job on a coincidence. T-006's real, correct
        # "three findings" must stay silent with an issue number added.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-006.md"),
                "record three findings",
                "record three findings, filed against issue 27,",
                "P3",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("P3 issue number beside a correct count: exit 0", rc == 0, f"rc={rc} err={err}")

        # ------------------------------------------ P4 (R10, #132 adversarial)
        # Only the LAST number on the line used to be checked, so a wrong
        # count word earlier on the line hid behind an unrelated number that
        # happened to agree with the list by coincidence.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-006.md"),
                "record three findings",
                "record four findings, cross-checked against 3 sources",
                "P4",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("P4 wrong early count no longer hidden by a coincidental match: exit 4 (heuristic)", rc == 4, f"rc={rc} err={err}")
                check("P4: R10 named", rule_hit(err, "R10"), f"err={err!r}")
                check("P4: no traceback", "Traceback" not in err, f"err={err!r}")

        # ---------------------------------------------------------- M7 (R10 adjacency, #193)
        # The relaxation this job adds: an adjective sitting between the
        # count and the plural noun it governs must still be caught. Same
        # real sentence M3 mutates (T-006's openQuestions bullet, a line
        # ending in ':' immediately above a three-item list)—M3 itself
        # doesn't exercise the relaxation, since its mutated noun still
        # sits right after the number. Here an adjective goes between them,
        # so the token immediately after "four" is "separate", which does
        # not end in "s". Reverting the relaxation to matching only that
        # one token goes silent on this exact input—the failure the
        # relaxation exists to close.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-006.md"),
                "record three findings",
                "record four separate findings",
                "M7",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("M7 count separated from its noun by an adjective: exit 4 (heuristic)", rc == 4, f"rc={rc} err={err}")
                check("M7: R10 named", rule_hit(err, "R10"), f"err={err!r}")
                check("M7: no traceback", "Traceback" not in err, f"err={err!r}")

        # -------------------------------------------- R21: checker routing (#193)
        # T-001 cites C-2 and C-7, both checker-judgment rubric clauses in
        # this corpus's own constitution, and ships with the correct
        # routing, checker: checker-judgment. Flipping that one line to
        # checker-deterministic is the exact defect R21 exists to catch:
        # that agent runs scripts and exercises no judgment, so a
        # rubric-citing task can never be checked. No archived task carries
        # this shape on its own—until this job nothing refused it—so the
        # mutation is what makes it reachable. Nothing else in the linter
        # reads the checker: field, so removing R21 leaves this fixture
        # silent (exit 0) with the mutation still in place.
        print("R21: checker routing (#193)")

        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-001.md"),
                "checker: checker-judgment",
                "checker: checker-deterministic",
                "R21",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("R21 deterministic task citing a rubric clause: exit 1 (proof)", rc == 1, f"rc={rc} err={err}")
                check("R21: R21 named", rule_hit(err, "R21"), f"err={err!r}")
                check("R21: task named", "T-001" in err, f"err={err!r}")
                check("R21: offending clause named", "C-2" in err, f"err={err!r}")
                check("R21: no traceback", "Traceback" not in err, f"err={err!r}")

        # -------------------------------- R2: anchor text in the diagnostic (#193)
        # The same stale citation M1 mutates above, proving R2 still
        # fires—this proves the NEW half of the diagnostic survives: the
        # anchor text itself, not just the rule id. Stripping the anchor
        # back out of r2_anchor_message while leaving every line number it
        # reports intact would leave M1 green (it only checks R2 fired) and
        # turn this case red on its own.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-001.md"),
                ".agent-guild/scripts/compose-brief.py:64",
                ".agent-guild/scripts/compose-brief.py:58",
                "R2-anchor",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("R2-anchor stale code citation: exit 4 (heuristic)", rc == 4, f"rc={rc} err={err}")
                check("R2-anchor: R2 named", rule_hit(err, "R2"), f"err={err!r}")
                check(
                    "R2-anchor: anchor text itself quoted in the diagnostic, not just its line numbers",
                    "val[0] == val[-1]" in err,
                    f"err={err!r}",
                )
                check("R2-anchor: no traceback", "Traceback" not in err, f"err={err!r}")

        # -------------------------------------------------- R15: owns shape (#162)
        # A one-task fixture rather than the corpus, because what's under
        # test is a single entry's spelling and the corpus has no bad ones.
        # Each case names the whole entry back to the reader, since "your
        # owns is malformed" without the offending string is a scavenger
        # hunt through a decomposition.
        print("R15: owns shape (#162)")

        def write_owns_fixture(state, owns_entries):
            os.makedirs(os.path.join(state, "tasks"))
            write_lines(
                os.path.join(state, "constitution.md"), MINIMAL_CONSTITUTION.splitlines()
            )
            owns_block = "\n".join(f"  - {e}" for e in owns_entries)
            write_lines(
                os.path.join(state, "tasks", "T-001.md"),
                f"""---
id: T-001
title: Sole task
spec: .agent-guild/state/spec.md#one
clauses: [C-1]
executor: worker-standard
executor_model: sonnet
checker: checker-judgment
check_method: >-
  C-1: checker-judgment: confirm the output file exists and has content.
status: pending
retries: 0
max_retries: 2
deps: []
dep_rationale: []
escalations: []
artifacts:
  - out.txt
owns:
{owns_block}
---

## Spec excerpt

Produces out.txt.
""".splitlines(),
            )

        for entry, label in [
            ("./out.txt", "'./' prefix"),
            ("/abs/out.txt", "absolute path"),
            ("../sibling/out.txt", "'..' segment"),
            ("src//out.txt", "empty segment"),
            ("src\\\\out.txt", "backslash separator"),
            ('""', "empty entry"),
        ]:
            with tempfile.TemporaryDirectory() as d:
                state = os.path.join(d, "state")
                write_owns_fixture(state, [entry])
                rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
                check(f"R15 {label}: exit 1", rc == 1, f"rc={rc} err={err}")
                check(f"R15 {label}: R15 named", rule_hit(err, "R15"), f"err={err!r}")
                check(f"R15 {label}: task named", "T-001" in err, f"err={err!r}")
                check(f"R15 {label}: no traceback", "Traceback" not in err, f"err={err!r}")

        # The two spellings #162 demonstrated. Both need the entry to exist
        # on disk for the shape to be provably wrong, which is why R15 takes
        # repo_root and ready-set.py (which has none) can't catch this pair.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            os.makedirs(os.path.join(d, "src", "lib"))
            write_owns_fixture(state, ["src/lib"])
            rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
            check("R15 directory without trailing slash: exit 1", rc == 1, f"rc={rc} err={err}")
            check("R15 directory without trailing slash: entry quoted back", "src/lib" in err, err)
            check("R15 directory without trailing slash: R15 named", rule_hit(err, "R15"), f"err={err!r}")

        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            os.makedirs(os.path.join(d, "src"))
            write_lines(os.path.join(d, "src", "a.py"), ["x = 1"])
            write_owns_fixture(state, ["src/a.py/"])
            rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
            check("R15 file with trailing slash: exit 1", rc == 1, f"rc={rc} err={err}")
            check("R15 file with trailing slash: R15 named", rule_hit(err, "R15"), f"err={err!r}")

        # Owning a file the task hasn't created yet is the normal case, so
        # existence is never what R15 asks about.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            write_owns_fixture(state, ["src/not-yet-written.py", "docs/generated/"])
            rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
            check("R15 entries naming paths that don't exist yet: exit 0", rc == 0, f"rc={rc} err={err}")

        # R13 has to catch the same pair the wave does, on the strings alone
        # and with neither path on disk. Two well-formed entries, one
        # directory, and R15 has nothing to say about either of them.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            os.makedirs(os.path.join(state, "tasks"))
            write_lines(os.path.join(state, "constitution.md"), MINIMAL_CONSTITUTION.splitlines())
            for tid, entry in (("T-001", "src/lib"), ("T-002", "src/lib/")):
                write_lines(
                    os.path.join(state, "tasks", f"{tid}.md"),
                    f"""---
id: {tid}
title: Task {tid}
spec: .agent-guild/state/spec.md#one
clauses: [C-1]
executor: worker-standard
executor_model: sonnet
checker: checker-judgment
check_method: >-
  C-1: checker-judgment: confirm the output file exists and has content.
status: pending
retries: 0
max_retries: 2
deps: []
dep_rationale: []
escalations: []
artifacts:
  - out.txt
owns:
  - {entry}
---

## Spec excerpt

Writes under src/lib.
""".splitlines(),
                )
            rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
            check("'src/lib' vs 'src/lib/' with neither on disk: exit 1", rc == 1, f"rc={rc} err={err}")
            check("'src/lib' vs 'src/lib/': R13 named, not R15", rule_hit(err, "R13"), f"err={err!r}")

        # The migration decision (#162): `owns` stays optional, so a corpus
        # that predates the field is not retroactively in violation. The
        # unmutated corpus below carries no `owns:` at all.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
            check("R15 corpus with no owns field anywhere: exit 0", rc == 0, f"rc={rc} err={err}")

        # -------------------------------------------------- R13: ownership overlap (#133)
        # `owns` postdates this corpus, so add_owns() has to inject it before
        # R13 has anything to check. Every real overlap in the corpus—T-001
        # and T-006/T-007 sharing the schema, T-006 and T-007 sharing both
        # the schema and docs/vendor-ledger.md, T-005 and T-007 sharing the
        # retrospective skill, T-003 and T-007 sharing the generated-tree
        # prefixes—already has a direct dep edge, so the corpus with owns
        # added should pass cleanly on its own. add_dep_rationale() also
        # runs here (#125): every task add_owns() gives an `owns` list now
        # owes R14 a rationale for each of its own `deps`, so an exit-0
        # baseline needs both fields injected, not just `owns`.
        print("R13: ownership overlap (#133)")

        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            add_owns(state)
            add_dep_rationale(state)
            rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
            check("corpus + owns: exit 0", rc == 0, f"rc={rc} err={err}")

        # T-006 and T-007 both own the schema and docs/vendor-ledger.md.
        # T-007's dep on T-006 is the only path connecting them—drop it and
        # nothing else does, so R13 has to catch the gap. R13 runs before
        # R14 in rule order, so this fires regardless of dep_rationale;
        # added anyway to keep this fixture's shape matching the baseline.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            add_owns(state)
            add_dep_rationale(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-007.md"),
                "deps: [T-001, T-004, T-005, T-006]",
                "deps: [T-001, T-004, T-005]",
                "R13",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("T-007's dep on T-006 dropped: exit 1", rc == 1, f"rc={rc} err={err}")
                check("T-007 dep dropped: R13 named", rule_hit(err, "R13"), f"err={err!r}")
                check(
                    "T-007 dep dropped: both task ids named",
                    "T-006" in err and "T-007" in err,
                    err,
                )
                check("T-007 dep dropped: no traceback", "Traceback" not in err, f"err={err!r}")

        # -------------------------------------------------- R14: dep rationale (#125)
        # `dep_rationale` postdates this corpus too, so add_dep_rationale()
        # injects it the same way add_owns() injects `owns`. Every task that
        # add_owns() gives an `owns` list also picks up a rationale for each
        # of its own `deps` here, so the corpus with both added should pass
        # cleanly on its own—the mechanical half R14 checks (the two lists
        # line up one to one) is true by construction.
        print("R14: dep rationale (#125)")

        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            add_owns(state)
            add_dep_rationale(state)
            rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
            check("corpus + owns + dep_rationale: exit 0", rc == 0, f"rc={rc} err={err}")

        # T-002 depends on T-001 but its rationale is retargeted at T-999—a
        # dep with no matching rationale at all now.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            add_owns(state)
            add_dep_rationale(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-002.md"),
                "  - T-001: fixture rationale for R14 tests",
                "  - T-999: fixture rationale for R14 tests",
                "R14-missing",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("T-002's rationale for T-001 removed: exit 1", rc == 1, f"rc={rc} err={err}")
                check("T-002 rationale removed: R14 named", rule_hit(err, "R14"), f"err={err!r}")
                check(
                    "T-002 rationale removed: both task and dep named",
                    "T-002" in err and "T-001" in err,
                    err,
                )
                check("T-002 rationale removed: no traceback", "Traceback" not in err, f"err={err!r}")

        # T-002's real dep (T-001) keeps its rationale; a second entry is
        # added naming T-006, which T-002 never declares as a dep at all.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            add_owns(state)
            add_dep_rationale(state)
            ok = mutate(
                os.path.join(state, "tasks", "T-002.md"),
                "  - T-001: fixture rationale for R14 tests",
                "  - T-001: fixture rationale for R14 tests\n"
                "  - T-006: rationale for a dep this task never declares",
                "R14-extra",
            )
            if ok:
                rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "DEC-audit")
                check("T-002's rationale names an undeclared dep: exit 1", rc == 1, f"rc={rc} err={err}")
                check("T-002 undeclared dep: R14 named", rule_hit(err, "R14"), f"err={err!r}")
                check(
                    "T-002 undeclared dep: both task and dep named",
                    "T-002" in err and "T-006" in err,
                    err,
                )
                check("T-002 undeclared dep: no traceback", "Traceback" not in err, f"err={err!r}")

        # A task with no `owns` at all owes R14 nothing, even with a `deps`
        # id and no `dep_rationale` field in sight—the opt-in scoping (#125,
        # same shape as R13's #133). A minimal two-task fixture, not the
        # corpus, since every corpus task already carries `owns` once
        # add_owns() runs and this case needs one that deliberately doesn't.
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            os.makedirs(os.path.join(state, "tasks"))
            write_lines(os.path.join(state, "constitution.md"), MINIMAL_CONSTITUTION.splitlines())
            write_lines(
                os.path.join(state, "tasks", "T-001.md"),
                """---
id: T-001
title: Upstream task
spec: .agent-guild/state/spec.md#one
clauses: [C-1]
executor: worker-standard
executor_model: sonnet
checker: checker-judgment
check_method: >-
  C-1: checker-judgment: confirm the output file exists and has content.
status: pending
retries: 0
max_retries: 2
deps: []
escalations: []
artifacts:
  - out.txt
owns:
  - out.txt
---

## Spec excerpt

Produces out.txt.
""".splitlines(),
            )
            write_lines(
                os.path.join(state, "tasks", "T-002.md"),
                """---
id: T-002
title: Downstream task with no owns
spec: .agent-guild/state/spec.md#two
clauses: [C-1]
executor: worker-standard
executor_model: sonnet
checker: checker-judgment
check_method: >-
  C-1: checker-judgment: confirm the output file exists and has content.
status: pending
retries: 0
max_retries: 2
deps: [T-001]
escalations: []
artifacts: []
---

## Spec excerpt

Reads out.txt but writes nothing, so it declares no owns and no
dep_rationale.
""".splitlines(),
            )
            rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
            check("owns-less task with a dep and no rationale: exit 0", rc == 0, f"rc={rc} err={err}")

# ------------------------------------ generated trees: the marketplace files
# Both marketplace files are build-plugin.py outputs, and neither sits under
# `plugin/`, `plugins/`, or `.claude/`. While they were missing from
# GENERATED_TREE_PREFIXES, a task whose only generated artifact was one of
# them read as a task that regenerates nothing, and R8 went quiet on the
# whole job: an illegal decomposition lints clean. Each marketplace file gets
# a fire-then-pass pair, since the passing half on its own goes green against
# the old prefix list too and would prove nothing.
print("generated trees: a marketplace file counts as a regeneration")

for marketplace in (".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"):
    with tempfile.TemporaryDirectory() as d:
        state = write_synthetic_state(d, [
            {"id": "T-001", "artifacts": ["guild-core/roles/worker-bulk.md"]},
            {"id": "T-002", "artifacts": [marketplace]},  # no dep on T-001
        ])
        rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
        check(f"{marketplace} regenerated before the edit it captures: exit 1", rc == 1, f"rc={rc} err={err}")
        check(f"{marketplace}: R8 named", rule_hit(err, "R8"), f"err={err!r}")

    with tempfile.TemporaryDirectory() as d:
        state = write_synthetic_state(d, [
            {"id": "T-001", "artifacts": ["guild-core/roles/worker-bulk.md"]},
            {"id": "T-002", "artifacts": [marketplace], "deps": ["T-001"]},
        ])
        rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
        check(f"{marketplace} regenerated downstream of the edit: exit 0", rc == 0, f"rc={rc} err={err}")

# ------------------------------------------- R16: build serialization (#164)
# The case that reproduces today: two tasks editing disjoint paths under
# guild-core/. Nothing about their file ownership overlaps, so the wave
# dispatches both, and both then have to run build-plugin.py over the same
# output trees. R16 refuses the decomposition until one task owns the
# regeneration.
print("R16: build serialization (#164)")

GUILD_CORE_A = "guild-core/roles/auditor.md"
GUILD_CORE_B = "guild-core/workflows/decompose/SKILL.md"

with tempfile.TemporaryDirectory() as d:
    state = write_synthetic_state(d, [
        {"id": "T-001", "artifacts": [GUILD_CORE_A]},
        {"id": "T-002", "artifacts": [GUILD_CORE_B]},
    ])
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
    check("R16 two build-input editors and no regenerator: exit 1", rc == 1, f"rc={rc} err={err}")
    check("R16 no regenerator: R16 named", rule_hit(err, "R16"), f"err={err!r}")
    check("R16 no regenerator: both editors named", "T-001" in err and "T-002" in err, err)
    check("R16 no regenerator: no traceback", "Traceback" not in err, f"err={err!r}")

# The fix the rule is asking for: one terminal task, downstream of both
# edits, declaring the generated trees. Both editors still share a wave;
# the regenerator waits on its deps, which is where the serialization the
# issue asked for becomes visible in the wave's own output.
with tempfile.TemporaryDirectory() as d:
    state = write_synthetic_state(d, [
        {"id": "T-001", "artifacts": [GUILD_CORE_A]},
        {"id": "T-002", "artifacts": [GUILD_CORE_B]},
        {"id": "T-003", "artifacts": ["plugin/", "plugins/", ".claude/"],
         "deps": ["T-001", "T-002"]},
    ])
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
    check("R16 one terminal regenerator downstream of both: exit 0", rc == 0, f"rc={rc} err={err}")

# Two regenerators with no dep path between them. R8 passes this, because
# some generated task (T-004) is downstream of everything—which is why R8
# alone was never enough.
with tempfile.TemporaryDirectory() as d:
    state = write_synthetic_state(d, [
        {"id": "T-001", "artifacts": [GUILD_CORE_A]},
        {"id": "T-002", "artifacts": ["plugin/"], "deps": ["T-001"]},
        {"id": "T-003", "artifacts": ["plugins/"], "deps": ["T-001"]},
        {"id": "T-004", "artifacts": [".claude/"], "deps": ["T-002", "T-003"]},
    ])
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
    check("R16 two unordered regenerators: exit 1", rc == 1, f"rc={rc} err={err}")
    check("R16 two unordered regenerators: R16 named, not R8", rule_hit(err, "R16"), f"err={err!r}")
    check("R16 two unordered regenerators: both named", "T-002" in err and "T-003" in err, err)

with tempfile.TemporaryDirectory() as d:
    state = write_synthetic_state(d, [
        {"id": "T-001", "artifacts": [GUILD_CORE_A]},
        {"id": "T-002", "artifacts": ["plugin/"], "deps": ["T-001"]},
        {"id": "T-003", "artifacts": ["plugins/", ".claude/"], "deps": ["T-002"]},
    ])
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
    check("R16 two regenerators on a dep path: exit 0", rc == 0, f"rc={rc} err={err}")

# A job that touches no build input owes nothing to the build step.
with tempfile.TemporaryDirectory() as d:
    state = write_synthetic_state(d, [
        {"id": "T-001", "artifacts": ["docs/some-guide.md"]},
        {"id": "T-002", "artifacts": ["README.md"]},
    ])
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
    check("R16 no build inputs anywhere in the job: exit 0", rc == 0, f"rc={rc} err={err}")

# CON-audit has no tasks to serialize.
with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(os.path.join(state, "constitution.md"), MINIMAL_CONSTITUTION.splitlines())
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("R16 CON-audit with an empty tasks/: exit 0", rc == 0, f"rc={rc} err={err}")

# ------------------------------------------- clause boundary + trailing sections (#160 piece 4)
# The fix under test: a clause block now ends at the next `##`/`###`
# heading instead of running to EOF, and `## Protected content` /
# `## Non-goals` are scanned as their own regions—labeled
# `constitution.md (## <title>)`—rather than silently absorbed into the
# last clause's tail. build_fixture_repo_root pins compose-brief.py:64 to
# a real snippet, same as the R1/R2 corpus cases above, so a citation to
# that file resolves or doesn't by construction rather than by luck
# against the live repo.
print("clause boundary + trailing sections (#160 piece 4)")

with tempfile.TemporaryDirectory() as fixture_root:
    build_fixture_repo_root(fixture_root)

    with tempfile.TemporaryDirectory() as d:
        state = os.path.join(d, "state")
        os.makedirs(os.path.join(state, "tasks"))
        write_lines(
            os.path.join(state, "constitution.md"),
            trailing_section_citation_constitution(
                ".agent-guild/scripts/compose-brief.py:9999"
            ).splitlines(),
        )
        rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "CON-audit")
        # Exit 1 here is itself half the proof: if the boundary fix had
        # dropped trailing sections instead of re-scoping them, this
        # citation would never be read at all and the case would exit 0.
        check("bogus citation in a trailing section: exit 1", rc == 1, f"rc={rc} err={err}")
        check("bogus citation in a trailing section: R1 named", rule_hit(err, "R1"), f"err={err!r}")
        check(
            "bogus citation in a trailing section: attributed to its own section, not the last clause",
            "constitution.md (## Protected content)" in err,
            f"err={err!r}",
        )
        check("bogus citation in a trailing section: no traceback", "Traceback" not in err, f"err={err!r}")

    with tempfile.TemporaryDirectory() as d:
        state = os.path.join(d, "state")
        os.makedirs(os.path.join(state, "tasks"))
        write_lines(
            os.path.join(state, "constitution.md"),
            trailing_section_citation_constitution(
                ".agent-guild/scripts/compose-brief.py:64"
            ).splitlines(),
        )
        rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "CON-audit")
        check("corrected citation in a trailing section: exit 0", rc == 0, f"rc={rc} err={err}")

    with tempfile.TemporaryDirectory() as d:
        state = os.path.join(d, "state")
        os.makedirs(os.path.join(state, "tasks"))
        write_lines(
            os.path.join(state, "constitution.md"),
            clause_citation_constitution(
                ".agent-guild/scripts/compose-brief.py:9999"
            ).splitlines(),
        )
        rc, out, err = run_linter(state, "--repo-root", fixture_root, "--audit-id", "CON-audit")
        check("bogus citation inside the clause's own block: exit 1", rc == 1, f"rc={rc} err={err}")
        check("bogus citation inside the clause's own block: R1 named", rule_hit(err, "R1"), f"err={err!r}")
        # The other half of the proof: narrowing the boundary didn't
        # un-scan the clause itself, so this one stays attributed to plain
        # constitution.md—no `(## ...)` parenthetical, because it never
        # left the clause's own block.
        check(
            "bogus citation inside the clause's own block: no section parenthetical",
            "(##" not in err,
            f"err={err!r}",
        )
        check("bogus citation inside the clause's own block: no traceback", "Traceback" not in err, f"err={err!r}")

# ------------------------------------------------------------- R17: weight line (#160)
# Constitution-only (--audit-id CON-audit) except the one DEC-audit repeat
# at the end, which needs a minimal valid task set for R6/R7 to clear
# before R17 gets a turn.
print("R17: weight line (#160)")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(os.path.join(state, "constitution.md"), constitution_without_weight_line(1).splitlines())
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("R17 missing weight line: exit 1", rc == 1, f"rc={rc} err={err}")
    check("R17 missing weight line: R17 named", rule_hit(err, "R17"), f"err={err!r}")
    check("R17 missing weight line: mentions phase 0's derivation", "phase 0" in err.lower(), f"err={err!r}")
    check("R17 missing weight line: no traceback", "Traceback" not in err, f"err={err!r}")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(
        os.path.join(state, "constitution.md"),
        weighted_constitution(
            "<light | standard | deep>[, corrected from <derived weight> by the user], <one-line reason>", 1
        ).splitlines(),
    )
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("R17 verbatim template placeholder: exit 1", rc == 1, f"rc={rc} err={err}")
    check("R17 verbatim template placeholder: R17 named", rule_hit(err, "R17"), f"err={err!r}")
    check("R17 verbatim template placeholder: names 'placeholder'", "placeholder" in err, f"err={err!r}")
    check("R17 verbatim template placeholder: no traceback", "Traceback" not in err, f"err={err!r}")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(os.path.join(state, "constitution.md"), weighted_constitution("heavy, because reasons", 1).splitlines())
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("R17 unknown weight word: exit 1", rc == 1, f"rc={rc} err={err}")
    check("R17 unknown weight word: R17 named", rule_hit(err, "R17"), f"err={err!r}")
    check("R17 unknown weight word: names 'heavy'", "heavy" in err, f"err={err!r}")
    check("R17 unknown weight word: no traceback", "Traceback" not in err, f"err={err!r}")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(os.path.join(state, "constitution.md"), weighted_constitution("light, one artifact", 3).splitlines())
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("R17 valid light weight, under its ceiling: exit 0", rc == 0, f"rc={rc} err={err}")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(
        os.path.join(state, "constitution.md"),
        weighted_constitution(
            "standard, corrected from light by the user, the harness needs extending", 8
        ).splitlines(),
    )
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("R17 corrected form, at standard's ceiling: exit 0", rc == 0, f"rc={rc} err={err}")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(
        os.path.join(state, "constitution.md"),
        weighted_constitution(
            "standard, corrected from light by the user, the harness needs extending", 9
        ).splitlines(),
    )
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    # Over standard's ceiling (8), not light's (5)—only reachable if the
    # corrected form actually parsed as "standard" rather than choking on
    # the "corrected from light by the user" clause.
    check("R17 corrected form, over standard's ceiling: exit 1", rc == 1, f"rc={rc} err={err}")
    check(
        "R17 corrected form, over ceiling: R18 named, proving 'standard' parsed",
        rule_hit(err, "R18"),
        f"err={err!r}",
    )

with tempfile.TemporaryDirectory() as d:
    state = write_synthetic_state(
        d,
        [{"id": "T-001", "artifacts": ["out.txt"]}],
        constitution_text=constitution_without_weight_line(1),
    )
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
    check("R17 missing weight line under DEC-audit: exit 1", rc == 1, f"rc={rc} err={err}")
    check("R17 missing weight line under DEC-audit: R17 named", rule_hit(err, "R17"), f"err={err!r}")
    check("R17 missing weight line under DEC-audit: no traceback", "Traceback" not in err, f"err={err!r}")

# --------------------------------------------------------- R18: clause ceiling (#160)
print("R18: clause ceiling (#160)")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(os.path.join(state, "constitution.md"), weighted_constitution("light, one artifact", 6).splitlines())
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("R18 light over ceiling, no overrun recorded: exit 1", rc == 1, f"rc={rc} err={err}")
    check("R18 light over ceiling: R18 named", rule_hit(err, "R18"), f"err={err!r}")
    check("R18 light over ceiling: count 6 named", "6" in err, f"err={err!r}")
    check("R18 light over ceiling: ceiling 5 named", "5" in err, f"err={err!r}")
    check("R18 light over ceiling: weight 'light' named", "light" in err, f"err={err!r}")
    check("R18 light over ceiling: '**Ceiling overrun**' named", "**Ceiling overrun**" in err, f"err={err!r}")
    check("R18 light over ceiling: no traceback", "Traceback" not in err, f"err={err!r}")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(
        os.path.join(state, "constitution.md"),
        weighted_constitution(
            "light, one artifact", 6, overrun_line="the sixth clause covers the unattended cron path"
        ).splitlines(),
    )
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("R18 light over ceiling, overrun recorded: exit 0", rc == 0, f"rc={rc} err={err}")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(os.path.join(state, "constitution.md"), weighted_constitution("light, one artifact", 5).splitlines())
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("R18 light exactly at its ceiling: exit 0", rc == 0, f"rc={rc} err={err}")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(os.path.join(state, "constitution.md"), weighted_constitution("standard, one artifact", 9).splitlines())
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("R18 standard over ceiling, no overrun recorded: exit 1", rc == 1, f"rc={rc} err={err}")
    check("R18 standard over ceiling: R18 named", rule_hit(err, "R18"), f"err={err!r}")
    check("R18 standard over ceiling: ceiling 8 named", "8" in err, f"err={err!r}")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(os.path.join(state, "constitution.md"), weighted_constitution("deep, one artifact", 12).splitlines())
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("R18 deep is unbounded: exit 0", rc == 0, f"rc={rc} err={err}")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(
        os.path.join(state, "constitution.md"),
        weighted_constitution("light, one artifact", 6, overrun_line="").splitlines(),
    )
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    # An overrun line with nothing after the colon records nothing—R18
    # treats it the same as no overrun line at all rather than as a blank
    # waiver.
    check("R18 overrun line with an empty reason: exit 1", rc == 1, f"rc={rc} err={err}")
    check("R18 empty overrun reason: R18 named", rule_hit(err, "R18"), f"err={err!r}")
    check("R18 empty overrun reason: no traceback", "Traceback" not in err, f"err={err!r}")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(os.path.join(state, "constitution.md"), weighted_constitution("light, one artifact", 6).splitlines())
    for i in range(1, 7):
        write_lines(
            os.path.join(state, "tasks", f"T-{i:03d}.md"),
            weighted_task(f"T-{i:03d}", f"C-{i}", f"out{i}.txt").splitlines(),
        )
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
    check("R18 under DEC-audit: light+6, every clause cited, no overrun: exit 1", rc == 1, f"rc={rc} err={err}")
    check("R18 under DEC-audit: R18 named", rule_hit(err, "R18"), f"err={err!r}")
    check("R18 under DEC-audit: no traceback", "Traceback" not in err, f"err={err!r}")

# ------------------------------------------------- ceiling weld: table <-> CLAUSE_CEILINGS (#160)
# CLAUSE_CEILINGS is the numbers' one mechanical home; CLAUDE.md's
# "## Job weight" table restates them for the humans deriving a weight.
# Reading the boundaries from the TABLE at test time—rather than
# hardcoding 5/8/None a second time here—is what makes this section fail
# if the two are ever edited to disagree (#160's welded-ceiling AC).
print("ceiling weld: CLAUDE.md table welded to CLAUSE_CEILINGS (#160)")

CLAUDE_MD_PATH = os.path.normpath(os.path.join(SCRIPTS_DIR, "..", "CLAUDE.md"))
WEIGHT_ROW_RE = re.compile(r"^\|\s*(light|standard|deep)\s*\|.*\|\s*(\d+|none)\s*\|\s*$", re.M)

if not os.path.isfile(CLAUDE_MD_PATH):
    print(f"note: {CLAUDE_MD_PATH} not found — skipping the ceiling-weld section. This "
          f"suite ships into user projects; a copied-in kit may not carry this repo's "
          f"own CLAUDE.md, so the skip is expected there.")
else:
    with open(CLAUDE_MD_PATH, encoding="utf-8") as f:
        claude_md_text = f.read()
    weight_rows = WEIGHT_ROW_RE.findall(claude_md_text)
    check(
        "ceiling weld: exactly three '## Job weight' table rows found",
        len(weight_rows) == 3,
        f"weight_rows={weight_rows}",
    )

    for weight, ceiling_str in weight_rows:
        if ceiling_str == "none":
            with tempfile.TemporaryDirectory() as d:
                state = os.path.join(d, "state")
                os.makedirs(os.path.join(state, "tasks"))
                write_lines(
                    os.path.join(state, "constitution.md"),
                    weighted_constitution(f"{weight}, ceiling-weld fixture", 12).splitlines(),
                )
                rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
                check(f"ceiling weld {weight}=none: 12 clauses exit 0", rc == 0, f"rc={rc} err={err}")
            continue

        n = int(ceiling_str)

        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            os.makedirs(os.path.join(state, "tasks"))
            write_lines(
                os.path.join(state, "constitution.md"),
                weighted_constitution(f"{weight}, ceiling-weld fixture", n).splitlines(),
            )
            rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
            check(f"ceiling weld {weight}: {n} clauses (at the table's ceiling) exit 0", rc == 0, f"rc={rc} err={err}")

        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            os.makedirs(os.path.join(state, "tasks"))
            write_lines(
                os.path.join(state, "constitution.md"),
                weighted_constitution(f"{weight}, ceiling-weld fixture", n + 1).splitlines(),
            )
            rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
            check(f"ceiling weld {weight}: {n + 1} clauses (one over) exit 1", rc == 1, f"rc={rc} err={err}")
            check(f"ceiling weld {weight}: R18 named", rule_hit(err, "R18"), f"err={err!r}")
            check(f"ceiling weld {weight}: table's ceiling {n} named", str(n) in err, f"err={err!r}")

        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            os.makedirs(os.path.join(state, "tasks"))
            write_lines(
                os.path.join(state, "constitution.md"),
                weighted_constitution(
                    f"{weight}, ceiling-weld fixture", n + 1,
                    overrun_line="the extra clause covers a signal not on the table's row",
                ).splitlines(),
            )
            rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
            check(f"ceiling weld {weight}: {n + 1} clauses with a recorded overrun exit 0", rc == 0, f"rc={rc} err={err}")

# ------------------------------------------- worked examples: constitution SKILL.md (#160)
# The constitution skill's own weight-derivation worked examples, pinned
# so a later edit to guild-core/workflows/constitution/SKILL.md can't
# quietly drift the table's weights away from what the skill's prose
# claims about them. Guarded on guild-core/ rather than the corpus
# archive—this table has nothing to do with the #117 corpus—since a
# copied-in kit carries guild-core/ but never this repo's own source tree
# for it.
print("worked examples: constitution SKILL.md weight-derivation table (#160)")

GUILD_CORE_DIR = os.path.normpath(os.path.join(SCRIPTS_DIR, "..", "..", "guild-core"))
WORKED_EXAMPLE_ROW_RE = re.compile(
    r"^\| (kendrick/dotfiles#\d+|conflicting signals) \| (.+) \| (light|standard|deep) \|$", re.M
)

if not os.path.isdir(GUILD_CORE_DIR):
    print(f"note: {GUILD_CORE_DIR} not found — skipping the worked-examples section. This "
          f"suite ships into user projects; guild-core/ is this repo's own kit source and "
          f"does not ship, so the skip is expected there.")
else:
    skill_path = os.path.join(GUILD_CORE_DIR, "workflows", "constitution", "SKILL.md")
    if not os.path.isfile(skill_path):
        print(f"note: {skill_path} not found — skipping the worked-examples section.")
    else:
        with open(skill_path, encoding="utf-8") as f:
            skill_text = f.read()
        worked_rows = {
            m.group(1): (m.group(2), m.group(3))
            for m in WORKED_EXAMPLE_ROW_RE.finditer(skill_text)
        }
        # If a concurrent edit to SKILL.md hasn't landed the table yet,
        # these fail honestly rather than being loosened to tolerate the
        # race—see this task's own report for whether that happened here.
        check("worked examples: three rows present", len(worked_rows) == 3, f"worked_rows={worked_rows}")
        check(
            "worked examples: kendrick/dotfiles#19 derives standard",
            worked_rows.get("kendrick/dotfiles#19", (None, None))[1] == "standard",
            f"worked_rows={worked_rows}",
        )
        check(
            "worked examples: kendrick/dotfiles#21 derives deep",
            worked_rows.get("kendrick/dotfiles#21", (None, None))[1] == "deep",
            f"worked_rows={worked_rows}",
        )
        check(
            "worked examples: conflicting signals derives standard",
            worked_rows.get("conflicting signals", (None, None))[1] == "standard",
            f"worked_rows={worked_rows}",
        )
        check(
            "worked examples: conflicting signals' middle cell explains the heavier weight wins",
            "heavier" in worked_rows.get("conflicting signals", ("", None))[0],
            f"worked_rows={worked_rows}",
        )

# --------------------------------------------------------- R19: baseline value (#182)
print("R19: baseline value (#182)")


def baseline_constitution(value):
    """weighted_constitution with a `- **baseline**:` field on C-1 only—the
    field is optional, so C-2 staying bare is itself part of every case."""
    return weighted_constitution("light, one artifact", 2).replace(
        "- **failing example**: clause 1's standard is violated.",
        f"- **baseline**: {value}\n- **failing example**: clause 1's standard is violated.",
    )


with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    doc = baseline_constitution("amber")
    # The mutate() discipline: prove the builder actually planted the field
    # before asserting anything about how the linter reads it.
    check("R19 fixture: baseline field present", "- **baseline**: amber" in doc, doc[:200])
    write_lines(os.path.join(state, "constitution.md"), doc.splitlines())
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("R19 baseline 'amber': exit 1", rc == 1, f"rc={rc} err={err}")
    check("R19 baseline 'amber': R19 named", rule_hit(err, "R19"), f"err={err!r}")
    check("R19 baseline 'amber': clause C-1 named", "C-1" in err, f"err={err!r}")
    check("R19 baseline 'amber': the bad value named", "amber" in err, f"err={err!r}")
    check("R19 baseline 'amber': no traceback", "Traceback" not in err, f"err={err!r}")

for good in ("red", "green"):
    with tempfile.TemporaryDirectory() as d:
        state = os.path.join(d, "state")
        os.makedirs(os.path.join(state, "tasks"))
        write_lines(os.path.join(state, "constitution.md"), baseline_constitution(good).splitlines())
        rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
        check(f"R19 baseline '{good}': exit 0", rc == 0, f"rc={rc} err={err}")

with tempfile.TemporaryDirectory() as d:
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(os.path.join(state, "constitution.md"), weighted_constitution("light, one artifact", 2).splitlines())
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
    check("R19 no baseline declared anywhere: exit 0", rc == 0, f"rc={rc} err={err}")

# ---------------------------------------------------------------------------
# #139: proof vs heuristic, and the waiver that gives a heuristic misfire a
# recourse short of standing down every gate.
# ---------------------------------------------------------------------------

def waivable_constitution(exception_line=None):
    """A two-clause constitution that passes on its own, optionally carrying
    one `**Lint exception**:` line. R20's entire input surface."""
    block = f"**Lint exception**: {exception_line}\n" if exception_line is not None else ""
    return weighted_constitution("light, one artifact", 2).replace(
        "\n## Clauses", f"{block}\n## Clauses", 1
    )


def run_waiver(exception_line):
    with tempfile.TemporaryDirectory() as d:
        state = os.path.join(d, "state")
        os.makedirs(os.path.join(state, "tasks"))
        write_lines(
            os.path.join(state, "constitution.md"),
            waivable_constitution(exception_line).splitlines(),
        )
        return run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")


# A proof rule is never waivable: it fires on a citation that doesn't resolve
# or a graph with a cycle, and there is no reading of those where the rule is
# what's wrong. Waiving one would suppress a real defect, the one thing this
# mechanism must not be able to buy.
rc, out, err = run_waiver("R6 — I would rather not wire the clauses up")
check("R20 waiver against a proof rule: exit 1", rc == 1, f"rc={rc} err={err}")
check("R20 proof waiver: R20 named", rule_hit(err, "R20"), f"err={err!r}")
check("R20 proof waiver: says which rules are waivable", "waivable:" in err, f"err={err!r}")
check("R20 proof waiver: classed as a proof", "[proof]" in err, f"err={err!r}")

# An id no rule owns silences nothing today and becomes a live waiver the
# moment someone adds a rule under that number.
rc, out, err = run_waiver("R99 — a rule that does not exist")
check("R20 waiver against an unknown rule: exit 1", rc == 1, f"rc={rc} err={err}")
check("R20 unknown waiver: R20 named", rule_hit(err, "R20"), f"err={err!r}")

# The reason is the point: it is what a later pass at the rule reads. Refused
# the way R18 refuses an empty **Ceiling overrun** line.
rc, out, err = run_waiver("R10")
check("R20 waiver with no reason: exit 1", rc == 1, f"rc={rc} err={err}")
check("R20 empty-reason waiver: R20 named", rule_hit(err, "R20"), f"err={err!r}")

rc, out, err = run_waiver("R10 — <why this rule misread the paperwork>")
check("R20 waiver still holding the template placeholder: exit 1", rc == 1, f"rc={rc} err={err}")

# A well-formed waiver against a heuristic is accepted and does not itself
# fire anything.
rc, out, err = run_waiver("R10 — the count above that list is a ticket number")
check("R20 well-formed heuristic waiver: exit 0", rc == 0, f"rc={rc} err={err}")

# A commented-out or fenced waiver is not live. Commenting a line out is the
# universal way to turn it OFF, and the shipped constitution template opens
# its own preamble with a multi-line `<!--`, so this is the region where this
# repo habitually parks text that must not execute. Found by adversarial
# review; the parser scanned raw preamble text before the fix.
rc, out, err = run_waiver(None)
base_rc = rc
for label, block in (
    ("multi-line HTML comment", "<!--\n**Lint exception**: R10 — commented out\n-->"),
    ("fenced code block", "```\n**Lint exception**: R10 — example syntax\n```"),
):
    with tempfile.TemporaryDirectory() as d:
        state = os.path.join(d, "state")
        os.makedirs(os.path.join(state, "tasks"))
        text = weighted_constitution("light, one artifact", 2).replace(
            "\n## Clauses", f"\n{block}\n\n## Clauses", 1)
        write_lines(os.path.join(state, "constitution.md"), text.splitlines())
        rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "CON-audit")
        check(f"waiver inside a {label} is not parsed", "waived" not in out, f"out={out!r}")

# A stale placeholder appended under a real reason must not blank it: last
# write wins would turn a recorded waiver into an unexplained one.
rc, out, err = run_waiver(
    "R10 — the count is a ticket reference\n**Lint exception**: R10 — <tbd>")
check("duplicate waiver keeps the first non-empty reason: exit 0", rc == 0, f"rc={rc} err={err}")

# The repo's own prose style chains em dashes with no surrounding spaces, so
# this is the spelling its author is most likely to write.
for label, line in (
    ("unspaced em dash", "R10—the count is a ticket reference"),
    ("lowercase id", "r10 — the count is a ticket reference"),
    ("colon separator", "R10: the count is a ticket reference"),
):
    rc, out, err = run_waiver(line)
    check(f"waiver with an {label} is accepted: exit 0", rc == 0, f"rc={rc} err={err}")

# A line that names the field but no parseable rule says so, rather than
# reporting a rule named after the whole rest of the line.
rc, out, err = run_waiver("the count thing is wrong")
check("waiver with no parseable rule id: exit 1", rc == 1, f"rc={rc} err={err}")
check("malformed waiver: says malformed, not unknown-rule",
      "doesn't parse" in err, f"err={err!r}")

# A waiver for a rule that never fires announces nothing: there was no
# finding to silence, so there is nothing for a reader to know about.
rc, out, err = run_waiver("R10 — the count is a ticket reference")
check("unused waiver stays quiet on stderr", "waived" not in err, f"err={err!r}")

# R12 prints its id with a prime (#132 replaced the original R12 with a
# narrower one). A human typing either spelling into a waiver must find the
# same rule, or the recourse the block message names doesn't work.
for spelling in ("R12", "R12'"):
    rc, out, err = run_waiver(f"{spelling} — the two counts describe different things")
    check(f"R20 waiver spelled {spelling}: exit 0", rc == 0, f"rc={rc} err={err}")

# The waiver actually silences its rule, against a corpus mutation known to
# fire it, and the pass says so rather than looking clean.
if os.path.isdir(ARCHIVE_DIR):
    with tempfile.TemporaryDirectory() as waiver_root:
        build_fixture_repo_root(waiver_root)
        with tempfile.TemporaryDirectory() as d:
            state = os.path.join(d, "state")
            copy_corpus_state(state)
            # M3's own mutation, the one proved above to fire R10.
            ok = mutate(
                os.path.join(state, "tasks", "T-006.md"),
                "record three findings",
                "record four findings",
                "M3-waived",
            )
            if ok:
                const = os.path.join(state, "constitution.md")
                with open(const, encoding="utf-8") as f:
                    text = f.read()
                with open(const, "w", encoding="utf-8") as f:
                    f.write(text.replace(
                        "\n## Clauses",
                        "\n**Lint exception**: R10 — that count is a ticket "
                        "reference, not an enumeration\n\n## Clauses", 1))
                rc, out, err = run_linter(state, "--repo-root", waiver_root, "--audit-id", "DEC-audit")
                check("waived R10 on a mutation that fires it: exit 0", rc == 0, f"rc={rc} err={err}")
                check("waived R10: the pass names the waiver", "R10 waived" in out, f"out={out!r}")
                # And on stderr, the only channel dispatch-guard forwards.
                check("waived R10: the waiver is announced on stderr too",
                      "waived" in err, f"err={err!r}")

# --------------------------------------------------- R22: delegation vs schedule (#190)
print("R22: delegation vs schedule (#190)")

# R22 (slug delegation-schedule) does not exist in this tree yet—these
# fixtures are written against its spec (issue #190) ahead of the rule
# itself, so the "fires" case below is EXPECTED to fail against today's
# linter (it will observe exit 0, since nothing checks for this defect
# yet) while the three "stays silent" cases are expected to pass, because
# what they actually prove is that the fixtures clear every rule that DOES
# exist today. That is the whole point of writing them now: once R22
# lands, the "fires" case's assertions start passing with no fixture
# changes, and a regression in R22 itself would show up as one of the
# silent cases turning noisy.
#
# The rule, per #190: for each constitution clause, collect the OTHER
# clause ids named anywhere in that clause's own body (bare `C-N`
# mentions, self-reference excluded, ids the constitution doesn't define
# ignored). A clause naming none is silent. Otherwise, resolve carriers
# from task frontmatter `clauses:` lists and fail only when EVERY named
# clause's carriers are ALL strictly upstream (transitive `deps`) of EVERY
# task carrying the delegating clause.


def delegation_clause_block(n, mentions=()):
    """One `### C-N:` block. `mentions` names other clause ids in the
    **text** field, the way a real delegating clause would read ("this is
    established by C-2 and C-3")—R22 scans a clause's whole body, but
    **text** is where a human actually writes a delegation note, so
    planting the mention there is the realistic case rather than an
    artificial one. Silent (no mentions) when `mentions` is empty, the
    same opt-in shape clause_block above uses for the count/list rules."""
    note = f" Established by {', '.join(mentions)}." if mentions else ""
    return (
        f"### C-{n}: clause {n}\n"
        f"- **text**: Clause {n} states a falsifiable standard.{note}\n"
        f"- **check**: checker-judgment: confirm clause {n}'s standard holds.\n"
        f"- **severity**: minor\n"
        f"- **failing example**: clause {n}'s standard is violated.\n"
    )


def delegation_constitution(mentions_by_clause):
    """A deep-weight constitution (unbounded ceiling, so no R22 case
    couples to a clause count the way R17/R18's cases must) with one block
    per key in `mentions_by_clause` (1..max key, contiguous), each block's
    mentions taken from that key's value."""
    n_clauses = max(mentions_by_clause)
    blocks = "\n".join(
        delegation_clause_block(n, mentions_by_clause.get(n, ()))
        for n in range(1, n_clauses + 1)
    )
    return f"""# Constitution: R22 fixture

**Job weight**: deep, synthetic fixture; deep so no case couples to a clause count

## Clauses

{blocks}

## Protected content

- none.

## Non-goals

- none.
"""


def delegation_task(task_id, clause_ids, deps=()):
    """One task file citing every id in `clause_ids` (order preserved,
    >=1) with `deps` on other task ids. weighted_task above can't express
    this: it hardcodes `deps: []` and a single `clauses: [C-1]`, and R22's
    fixtures need multi-clause tasks wired into an explicit dep chain."""
    clauses_str = ", ".join(clause_ids)
    deps_str = ", ".join(deps)
    check_lines = "\n".join(
        f"  {cid}: checker-judgment: confirm clause {cid[2:]}'s standard holds."
        for cid in clause_ids
    )
    artifact = f"artifact-{task_id}.txt"
    return f"""---
id: {task_id}
title: Delegation fixture {task_id}
spec: .agent-guild/state/spec.md#one
clauses: [{clauses_str}]
executor: worker-standard
executor_model: sonnet
checker: checker-judgment
check_method: >-
{check_lines}
status: pending
retries: 0
max_retries: 2
deps: [{deps_str}]
escalations: []
artifacts:
  - {artifact}
---

## Spec excerpt

Writes {artifact}.
"""


def write_delegation_state(d, constitution_text, tasks):
    """`tasks`: list of {{"id", "clauses": [...], "deps": [...]}}. Mirrors
    write_synthetic_state's shape, but delegates to delegation_task so
    each entry can carry more than one clause and an explicit dep list—
    write_synthetic_state hardcodes both away."""
    state = os.path.join(d, "state")
    os.makedirs(os.path.join(state, "tasks"))
    write_lines(os.path.join(state, "constitution.md"), constitution_text.splitlines())
    for t in tasks:
        write_lines(
            os.path.join(state, "tasks", f"{t['id']}.md"),
            delegation_task(t["id"], t["clauses"], t.get("deps", [])).splitlines(),
        )
    return state


# ---- Case 1: fires. C-1 (carried by T-003) names C-2 and C-3; C-2 is
# carried by T-001, C-3 by T-002; T-003 deps on T-002 deps on T-001, so
# both named clauses' carriers are strictly upstream of C-1's carrier.
with tempfile.TemporaryDirectory() as d:
    doc = delegation_constitution({1: ("C-2", "C-3"), 2: (), 3: ()})
    check("R22 fires fixture: C-1 mentions C-2 and C-3", "Established by C-2, C-3." in doc, doc)
    state = write_delegation_state(d, doc, [
        {"id": "T-001", "clauses": ["C-2"], "deps": []},
        {"id": "T-002", "clauses": ["C-3"], "deps": ["T-001"]},
        {"id": "T-003", "clauses": ["C-1"], "deps": ["T-002"]},
    ])
    with open(os.path.join(state, "tasks", "T-003.md"), encoding="utf-8") as f:
        t003 = f.read()
    check("R22 fires fixture: T-003 carries C-1 and deps on T-002",
          "clauses: [C-1]" in t003 and "deps: [T-002]" in t003, t003)
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
    # EXPECTED RED against today's ruleless baseline: rc comes back 0 with
    # empty stderr, so every one of these assertions is expected to fail
    # until R22 exists. Left as ordinary check() calls (not skipped or
    # inverted) because that failure IS the deliverable: this is the
    # observed-RED half of the red/green pair #190 asks for.
    check("R22 fires: exit 1", rc == 1, f"rc={rc} err={err}")
    check("R22 fires: [proof] tag literal in stderr", "[proof]" in err, f"err={err!r}")
    check("R22 fires: R22 named", rule_hit(err, "R22"), f"err={err!r}")
    check("R22 fires: delegating clause C-1 named", "C-1" in err, f"err={err!r}")
    check("R22 fires: leaned-on clause C-2 named", "C-2" in err, f"err={err!r}")
    check("R22 fires: leaned-on clause C-3 named", "C-3" in err, f"err={err!r}")
    check("R22 fires: carrier T-001 named", "T-001" in err, f"err={err!r}")
    check("R22 fires: carrier T-002 named", "T-002" in err, f"err={err!r}")
    check("R22 fires: carrier T-003 named", "T-003" in err, f"err={err!r}")
    check("R22 fires: no traceback", "Traceback" not in err, f"err={err!r}")

# ---- Case 2: silent, same task. Same shape, except C-2 moves onto T-003
# itself—the same task that carries the delegating clause C-1—so C-2's
# carrier is not strictly upstream of (nor distinct from) T-003.
with tempfile.TemporaryDirectory() as d:
    doc = delegation_constitution({1: ("C-2", "C-3"), 2: (), 3: ()})
    check("R22 same-task fixture: C-1 mentions C-2 and C-3", "Established by C-2, C-3." in doc, doc)
    state = write_delegation_state(d, doc, [
        {"id": "T-002", "clauses": ["C-3"], "deps": []},
        {"id": "T-003", "clauses": ["C-1", "C-2"], "deps": ["T-002"]},
    ])
    with open(os.path.join(state, "tasks", "T-003.md"), encoding="utf-8") as f:
        t003 = f.read()
    check("R22 same-task fixture: T-003 carries both C-1 and C-2",
          "clauses: [C-1, C-2]" in t003, t003)
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
    check("R22 same-task: exit 0", rc == 0, f"rc={rc} err={err}")
    check("R22 same-task: stderr empty", err == "", f"err={err!r}")

# ---- Case 3: silent, unordered. C-2 stays upstream of T-003 (via T-001),
# but C-3 moves to T-004, an independent branch with no dep edge to or
# from T-003 in either direction—neither a transitive dep nor a
# transitive dependent.
with tempfile.TemporaryDirectory() as d:
    doc = delegation_constitution({1: ("C-2", "C-3"), 2: (), 3: ()})
    check("R22 unordered fixture: C-1 mentions C-2 and C-3", "Established by C-2, C-3." in doc, doc)
    state = write_delegation_state(d, doc, [
        {"id": "T-001", "clauses": ["C-2"], "deps": []},
        {"id": "T-003", "clauses": ["C-1"], "deps": ["T-001"]},
        {"id": "T-004", "clauses": ["C-3"], "deps": []},
    ])
    with open(os.path.join(state, "tasks", "T-003.md"), encoding="utf-8") as f:
        t003 = f.read()
    with open(os.path.join(state, "tasks", "T-004.md"), encoding="utf-8") as f:
        t004 = f.read()
    check("R22 unordered fixture: T-003 deps only on T-001, not T-004",
          "deps: [T-001]" in t003 and "T-004" not in t003, t003)
    check("R22 unordered fixture: T-004 carries C-3 with no deps",
          "clauses: [C-3]" in t004 and "deps: []" in t004, t004)
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
    check("R22 unordered: exit 0", rc == 0, f"rc={rc} err={err}")
    check("R22 unordered: stderr empty", err == "", f"err={err!r}")

# ---- Case 4: silent, no mentions. C-1's body names no other clause id at
# all, so R22 has nothing to collect and nothing to check.
with tempfile.TemporaryDirectory() as d:
    doc = delegation_constitution({1: ()})
    check("R22 no-mentions fixture: body carries no 'Established by' note",
          "Established by" not in doc, doc)
    state = write_delegation_state(d, doc, [
        {"id": "T-001", "clauses": ["C-1"], "deps": []},
    ])
    rc, out, err = run_linter(state, "--repo-root", d, "--audit-id", "DEC-audit")
    check("R22 no-mentions: exit 0", rc == 0, f"rc={rc} err={err}")
    check("R22 no-mentions: stderr empty", err == "", f"err={err!r}")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
