#!/usr/bin/env python3
"""Lint `.agent-guild/state/constitution.md` and `state/tasks/*.md` for the
defects an opus auditor would otherwise have to find by reading—the
mechanical sweep #132 exists to take off an auditor's plate before it ever
gets dispatched.

    .agent-guild/scripts/check-job-spec.py [STATE] [--repo-root PATH]
                                            [--audit-id CON-audit|DEC-audit]
    .agent-guild/scripts/check-job-spec.py --self-test

STATE defaults to `.agent-guild/state`. `--repo-root` (default: cwd) is the
root every citation and script invocation resolves against—not
necessarily where STATE lives, since a fixture in tests points STATE at a
corpus copy while citations still need to resolve against a real tree.

Rules run in this order—proofs before heuristics, so a heuristic never
masks something provable—and only the FIRST violation found is reported:

    R6 clause wiring         R4 check form            R2 citation anchor
    R7 dependency DAG        R5 check runnable        R9 verdict contradiction
    R21 checker routing      R1 citation resolves     R10 count vs list
    R22 delegation schedule  R3 citation shape        R12' cross-artifact count
    R17 weight line          R8 build ordering
    R18 clause ceiling       R16 build serialization
    R19 baseline value
    R15 owns shape
    R13 ownership overlap
    R14 dep rationale

`--audit-id CON-audit`: `state/tasks/` is expected empty (nothing to wire,
depend on, order, or own yet), so R6, R7, R21, R22, R15, R13, R14, R8, and R16
are skipped; every other rule runs over constitution.md alone. `--audit-id
DEC-audit`: everything runs, and an empty `tasks/` is itself an R6
failure—a decomposition that produced no tasks decomposed nothing.

R21 routes a task to the right checker family: a `checker-deterministic`
task citing a clause whose constitution check is `checker-judgment:` is
refused, because that agent runs scripts and exercises no judgment and
the rubric cannot be applied at all. It reads the clause's kind off
constitution.md, never off the task's own `check_method` paraphrase—a
task's prose can disagree with the clause it names—and it runs ahead of
every heuristic (R2, R9, R10, R12' per RULE_CLASS) so paperwork carrying
both a routing defect and an inferred one reports the unwaivable proof
first.

R17 and R18 (#160) run under both audit ids—the constitution is input to
both—and R17 before R18, so a constitution with no usable weight reports
as "derive the weight" rather than as a ceiling complaint. R17 wants the
`**Job weight**:` line present, past its template placeholder, and naming
a real weight; R18 counts clauses against that weight's ceiling
(CLAUSE_CEILINGS, the numbers' one mechanical home) and refuses only an
overrun no `**Ceiling overrun**:` line records—the ceiling is a budget,
not a gate, so a recorded overrun passes. R19 (#182) holds the optional
`- **baseline**:` clause field to its two legal values, red and green;
absence is legal (check-baselines.py skips and counts it), so the only
provable defect is a value that script could never hold a check to.

R16 runs immediately after R8 and reads the same two path sets. R8 puts the
regeneration last; R16 asks how many regenerations there are, and whether a
job that edits build inputs modeled the build step at all. Both gaps only
became reachable under waves (#125)—one task at a time made two concurrent
regenerations impossible by construction.

R15 runs immediately before R13 because R13's question—do these two owns
entries overlap—only has a meaningful answer once both entries are one of
the two documented shapes. A directory spelled without its trailing slash
reads as a file claim and collides with nothing, so an unvalidated pair
like `src/lib` and `src/lib/` passes R13 while naming the same tree
(#162). R15 is opt-in on the same terms as R13 and R14: it checks the
entries a task declares and has nothing to say about a task that declares
none.

R13 sits after R7 (with R15 in between) because it needs R7's acyclic-DAG
guarantee before it can walk a `deps` chain looking for a path between two
owners—the same reason R8 (which walks the same chain) runs after R7 too.
R13 is opt-in at
the linter (#133): a task with no `owns:` field, or an empty one, is never
an R13 violation—only a task this rule has nothing to check. The field
postdates every archived corpus, so treating its absence as a violation
would fail every one of them retroactively for a contract they predate.

R14 sits right after R13 for the same reason it's opt-in the same way
(#125): it only has something to check on a task that also declares
`owns:`, since that's the field that makes a dep edge a serialization
point worth justifying in the first place. A task with no `owns:` can
still declare `deps:` with no `dep_rationale:` at all and R14 has nothing
to say about it—every archived corpus predates `dep_rationale:`, same as
it predates `owns:`. R14 checks only that a rationale exists for each dep
and that the two lists correspond one to one; whether a given rationale is
actually *true* is judgment, and stays the auditor's job under DEC-audit,
not this linter's.

Every prose rule (R1 through R4, R9, R10, R12') reads only three kinds of
text: a task's frontmatter (in practice, only `check_method` carries prose)
plus its `## Spec excerpt`; a constitution clause's own block, which ends at
the next `##`/`###` heading—the boundary is imported from
compose-brief.py's `extract_clause` so the two parsers of one file can't
disagree (#160); and each post-`## Clauses` section (`## Protected
content`, `## Non-goals`, ...) as its own region, labeled
`constitution.md (## <title>)` so a defect there is reported against the
section rather than against the last clause's id. Everything else—`##
Rework diagnosis`, `## Courier comparison`, `## Routing`, fenced code
blocks, HTML comments—is a historical record or literal script text, not
paperwork under review, and scanning it produced six of the false
positives this linter was measured against before that scope was drawn.

Exit codes: 0 pass; 1 a PROOF rule is violated; 4 a HEURISTIC rule is
violated; 3 infra (state dir missing, a file unreadable, a task file with no
frontmatter, or validate-verdict.py/compose-brief.py not importable)—an
infra failure is not evidence the paperwork is sound, so dispatch-guard
treats it as a distinct, non-passing outcome.

A violation is one line on stderr prefixed `job-spec: `, carrying the class
in brackets and then the rule—e.g. `job-spec: [heuristic] R2
citation-anchor: tasks/T-001.md:57 cites compose-brief.py:58 but the quoted
code is at compose-brief.py:64`. The split between 1 and 4 is #139: a proof
means the paperwork is wrong, a heuristic means the paperwork is wrong or
the rule misread it, and a caller that cannot tell them apart treats a
misfire as a defect. Both still block. A heuristic that fires also prints
the waiver syntax, since a misread otherwise has no recourse short of
state/PAUSED, which stands down every gate in the system rather than the one
rule. See RULE_CLASS for the classification and rule_R20 for what a waiver
must look like.

--self-test runs an embedded fixture battery in temp directories and exits
0 only if every fixture behaves as documented.

Stdlib only, so the kit stays copy-in portable—see compose-brief.py and
check-provenance.py for the same constraint and the same reasons. Imports
`parse_frontmatter`, `extract_clause`, and `extract_section` from
compose-brief.py, and `DEFECT_SEVERITIES` from validate-verdict.py, via
importlib (the `render-verdict.py:33-39` idiom for a hyphenated filename),
rather than reimplementing them: a linter whose job is to prove the
paperwork is readable by the tools that consume it has to call the same
parser those tools call, not a lookalike that could bless a file
`compose-brief.py` itself chokes on. The block-sequence `artifacts:` form
and the folded `check_method: >-` scalar are parsed here instead, because
no other script in the kit reads either field programmatically—there is
nothing downstream for compose-brief.py's parser to stay honest against.
"""
import argparse
import difflib
import glob
import graphlib
import importlib.util
import os
import re
import shlex
import stat
import subprocess
import sys
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def _load_module(name, filename):
    path = os.path.join(SCRIPT_DIR, filename)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Loaded at module scope, not just inside main(), so `import check_job_spec;
# rule_R9(ctx)` works without going through the CLI entrypoint first—main()
# still does its own load (below) wrapped in a try/except that turns a real
# import failure into the documented exit 3, so the CLI's error message
# doesn't regress; this top-level load just means R9 has a real value to
# read even when nothing has called main() yet. validate-verdict.py has no
# `if __name__ == "__main__":`-gated side effects, so importing it here
# costs nothing beyond the one-time module exec.
try:
    DEFECT_SEVERITIES = _load_module("validate_verdict_module_scope", "validate-verdict.py").DEFECT_SEVERITIES
except Exception:
    DEFECT_SEVERITIES = ()

# Same reasoning, same fallback shape, for R13's overlap predicate: loaded
# from check-diff-scope.py rather than reimplemented, so the two scripts
# can't drift on what "overlapping" means for an exact-path vs. a
# directory-prefix owns entry. A load failure degrades R13 to a no-op here
# (module-scope callers get a rule that finds nothing rather than a
# crash); main()'s own load below still turns a real failure into exit 3
# for the CLI path.
try:
    _diff_scope_module_scope = _load_module("check_diff_scope_module_scope", "check-diff-scope.py")
    paths_overlap = _diff_scope_module_scope.paths_overlap
    owns_entry_problem = _diff_scope_module_scope.owns_entry_problem
except Exception:
    paths_overlap = None
    owns_entry_problem = None

# The clause-block terminator, taken from compose-brief.py rather than
# restated, so the two parsers of constitution.md can't disagree on where a
# clause ends—they did once (#160): this file ran a block to the next
# `### C-N:` heading or EOF while extract_clause stopped at any `##`/`###`,
# and the last clause quietly swallowed `## Protected content` and
# `## Non-goals`, blaming their defects on an innocent clause id. The
# fallback duplicates two regex tokens; the parity test in
# test_check_job_spec.py is what actually pins the boundary.
try:
    NEXT_H2_OR_H3_RE = _load_module("compose_brief_boundary_scope", "compose-brief.py").NEXT_H2_OR_H3_RE
except Exception:
    NEXT_H2_OR_H3_RE = re.compile(r"(?m)^#{2,3} ")


# ---------------------------------------------------------------------------
# Frontmatter parsing: the base parser plus the two extensions the plan
# calls for.
# ---------------------------------------------------------------------------

FM_KEY_RE = re.compile(r"^([A-Za-z0-9_]+):\s*(.*)$")
LIST_ITEM_LINE_RE = re.compile(r"^\s*-\s+(.*)$")


def raw_frontmatter_lines(lines):
    """(fm_lines, body_start)—the lines strictly between the two `---`
    fences, 0-indexed against the original file, and the index of the first
    body line. None, None if there's no closed frontmatter block."""
    if not lines or lines[0].strip() != "---":
        return None, None
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return lines[1:i], i + 1
    return None, None


def parse_clause_list(raw):
    """`clauses: [C-1, C-4]` (or `deps: [T-001]`, or `[]`) -> a list of the
    bracketed, comma-separated ids. Same bracket format for both fields, so
    one parser covers `clauses:` and `deps:`."""
    raw = (raw or "").strip()
    if not (raw.startswith("[") and raw.endswith("]")):
        return []
    inner = raw[1:-1].strip()
    if not inner:
        return []
    return [c.strip() for c in inner.split(",") if c.strip()]


def parse_artifacts(fm_lines, key_idx, flat_value):
    """`artifacts:` comes two ways in the corpus: flat `[a, b]` on the key's
    own line, or a block sequence—`artifacts:` with nothing after the
    colon, then `  - path` on each following line. Three of the seven
    corpus tasks (T-001, T-006, T-007) use the block form, which
    compose-brief.py's flat-only parser silently drops to an empty list—
    fine for compose-brief.py, which never reads `artifacts`, but fatal for
    R8 here, which needs every artifact path to classify a task as a build
    input or a generated-tree write. `owns:` (#133) is the same two shapes
    on the same kind of value—a path list—so load_task_file calls this
    same function for it rather than writing a second copy of the same
    flat-or-block logic."""
    flat_value = flat_value.strip()
    if flat_value.startswith("["):
        return parse_clause_list(flat_value)
    items = []
    for line in fm_lines[key_idx + 1:]:
        m = LIST_ITEM_LINE_RE.match(line)
        if m is None:
            break
        val = m.group(1).strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        items.append(val)
    return items


DEP_RATIONALE_ITEM_RE = re.compile(r"^(T-\d+):\s*(.+)$")


def parse_dep_rationale(fm_lines, key_idx, flat_value):
    """`dep_rationale:` is the same flat-or-block shape as `artifacts:` and
    `owns:` (see parse_artifacts' docstring), except each item reads
    `T-NNN: rationale text` rather than a bare path. The raw strings come
    from parse_artifacts unchanged; this just splits each on its first
    colon. An item that doesn't match `T-NNN: text` comes back as
    `(None, item)` rather than being dropped, so R14 can report the exact
    malformed entry instead of silently ignoring it."""
    parsed = []
    for item in parse_artifacts(fm_lines, key_idx, flat_value):
        m = DEP_RATIONALE_ITEM_RE.match(item.strip())
        parsed.append((m.group(1), m.group(2).strip()) if m else (None, item))
    return parsed


def fold_check_method(fm_lines, key_idx, file_start_line):
    """Fold the `check_method: >-` scalar's continuation lines into one
    prose string, the way YAML folding joins them for a real parser, and
    build a same-length `offset -> physical source line` map alongside it.

    Every rule that scans check_method text needs to report *where* in the
    task file a problem sits, not just "somewhere in check_method"—a
    diagnostic pointing at the `check_method:` key line on a task whose
    value runs forty lines is barely better than no line number at all.
    `file_start_line` is the 1-indexed physical line of `fm_lines[0]` in the
    original file, so the map comes out in file coordinates, not
    block-relative ones.
    """
    parts = []
    line_map = []
    first = True
    i = key_idx + 1
    while i < len(fm_lines):
        raw = fm_lines[i]
        # A folded scalar's continuation lines are indented; the first line
        # back at column 0 is the next frontmatter key, which ends the value.
        if raw.strip() != "" and not raw[0].isspace():
            break
        content = raw.strip()
        physical = file_start_line + i
        if content:
            if not first:
                parts.append(" ")
                line_map.append(physical)
            parts.append(content)
            line_map.extend([physical] * len(content))
            first = False
        i += 1
    return "".join(parts), line_map, i


class TaskFile:
    """Everything a rule needs about one `tasks/T-NNN.md`, extracted once.

    `check_method_text` / `check_method_map` are the folded scalar and its
    offset->line map (see `fold_check_method`). `spec_excerpt_text` /
    `spec_excerpt_start_line` describe the verbatim `## Spec excerpt`
    section and the physical line its first character sits on, so a rule
    that finds an offset within it can add a newline count to get a real
    line number. `owns` is what R13 and R15 both read (#133, #162)—parsed the same
    way as `artifacts` (see load_task_file) but empty by default, since the
    field is opt-in and predates every archived corpus. `dep_rationale` is R14's
    input the same way (#125): a list of `(task_id_or_None, text)` pairs,
    empty by default for the same reason `owns` is. `checker` is R21's input
    (#193): the raw `checker:` frontmatter value, read here rather than
    inferred from `check_method`, because a task's own prose can disagree
    with the clause it cites.
    """

    def __init__(self, path, label, task_id, title, clauses, deps, artifacts,
                 owns, dep_rationale, check_method_text, check_method_map,
                 spec_excerpt_text, spec_excerpt_start_line, checker=""):
        self.path = path
        self.label = label
        self.id = task_id
        self.title = title
        self.clauses = clauses
        self.deps = deps
        self.artifacts = artifacts
        self.owns = owns
        self.dep_rationale = dep_rationale
        self.checker = checker
        self.check_method_text = check_method_text
        self.check_method_map = check_method_map
        self.spec_excerpt_text = spec_excerpt_text
        self.spec_excerpt_start_line = spec_excerpt_start_line

    def line_for_excerpt_offset(self, offset):
        return self.spec_excerpt_start_line + self.spec_excerpt_text.count("\n", 0, offset)

    def line_for_check_method_offset(self, offset):
        if 0 <= offset < len(self.check_method_map):
            return self.check_method_map[offset]
        return self.check_method_map[-1] if self.check_method_map else 0


def load_task_file(path, compose_brief):
    """(TaskFile, None) on success, (None, error) on an infra-level parse
    failure (no frontmatter at all—compose-brief.py itself couldn't read
    this task, so nothing downstream of it could either)."""
    try:
        with open(path, encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        return None, f"cannot read {path}: {e}"

    fm, body = compose_brief.parse_frontmatter(text)
    if fm is None:
        return None, f"{path}: no YAML frontmatter header found"

    lines = text.splitlines()
    fm_lines, body_start = raw_frontmatter_lines(lines)
    if fm_lines is None:
        return None, f"{path}: frontmatter block never closes"

    clauses = parse_clause_list(fm.get("clauses"))
    deps = parse_clause_list(fm.get("deps"))

    artifacts = []
    owns = []
    dep_rationale = []
    check_method_text, check_method_map = "", []
    for i, line in enumerate(fm_lines):
        m = FM_KEY_RE.match(line)
        if not m:
            continue
        key, val = m.group(1), m.group(2)
        if key == "artifacts":
            artifacts = parse_artifacts(fm_lines, i, val)
        elif key == "owns":
            # Same flat-or-block shape as artifacts (see parse_artifacts'
            # own docstring)—owns just documents a different thing about
            # the same paths, so the same parser covers both fields.
            owns = parse_artifacts(fm_lines, i, val)
        elif key == "dep_rationale":
            dep_rationale = parse_dep_rationale(fm_lines, i, val)
        elif key == "check_method":
            check_method_text, check_method_map, _ = fold_check_method(fm_lines, i, 2)

    spec_excerpt = compose_brief.extract_section(body, "## Spec excerpt")
    spec_excerpt_start_line = 0
    if spec_excerpt is not None:
        idx = text.find(spec_excerpt)
        if idx >= 0:
            spec_excerpt_start_line = text.count("\n", 0, idx) + 1

    label = os.path.join("tasks", os.path.basename(path))
    task = TaskFile(
        path=path, label=label,
        task_id=fm.get("id", "").strip(), title=fm.get("title", "").strip(),
        clauses=clauses, deps=deps, artifacts=artifacts, owns=owns,
        dep_rationale=dep_rationale, checker=fm.get("checker", "").strip(),
        check_method_text=check_method_text, check_method_map=check_method_map,
        spec_excerpt_text=spec_excerpt or "", spec_excerpt_start_line=spec_excerpt_start_line,
    )
    return task, None


# ---------------------------------------------------------------------------
# Constitution parsing.
# ---------------------------------------------------------------------------

CLAUSE_HEADING_RE = re.compile(r"(?m)^### (C-\d+):.*$")
CLAUSE_FIELD_RE = re.compile(r"^- \*\*([a-zA-Z ]+)\*\*:\s?(.*)$")


class Clause:
    def __init__(self, clause_id, block_text, block_start_line,
                 check_text, check_line, severity,
                 baseline=None, baseline_line=0):
        self.id = clause_id
        self.block_text = block_text
        self.block_start_line = block_start_line
        self.check_text = check_text
        self.check_line = check_line
        self.severity = severity
        self.baseline = baseline
        self.baseline_line = baseline_line


def parse_constitution(text):
    """{clause_id: Clause}, keyed off every `### C-N:` heading. A clause's
    field values (`- **check**:`, `- **severity**:`, ...) are one physical
    line each in every corpus example, so no folding logic is needed here—
    only tasks' `check_method` gets that treatment."""
    clauses = {}
    headings = list(CLAUSE_HEADING_RE.finditer(text))
    for idx, m in enumerate(headings):
        clause_id = m.group(1)
        start = m.start()
        # A block ends at the next `##` or `###` heading of any kind—the
        # same boundary extract_clause draws—not at the next `### C-N:`,
        # which would run the last clause to EOF and absorb every trailing
        # section into it (#160). What those sections lose here they get
        # back as regions of their own; see parse_trailing_sections.
        end_m = NEXT_H2_OR_H3_RE.search(text, m.end())
        end = end_m.start() if end_m else len(text)
        block = text[start:end].rstrip("\n")
        block_start_line = text.count("\n", 0, start) + 1

        check_text, check_line, severity = "", 0, None
        baseline, baseline_line = None, 0
        offset = start
        for line in block.split("\n"):
            fm = CLAUSE_FIELD_RE.match(line.strip())
            if fm:
                field, val = fm.group(1).strip().lower(), fm.group(2).strip()
                if field == "check":
                    check_text = val
                    check_line = text.count("\n", 0, offset) + 1
                elif field == "severity":
                    severity = val
                elif field == "baseline":
                    baseline = val.lower()
                    baseline_line = text.count("\n", 0, offset) + 1
            offset += len(line) + 1
        clauses[clause_id] = Clause(clause_id, block, block_start_line, check_text, check_line, severity,
                                    baseline, baseline_line)
    return clauses


def parse_trailing_sections(text):
    """[(title, block_text, block_start_line)] for every `## ` section at or
    after the first clause heading—`## Protected content` and `## Non-goals`
    in the template, plus anything a job adds. Narrowing the clause boundary
    above without re-registering these would silently drop them from every
    prose rule, trading #160's misattribution for a blind spot; this is the
    other half of that fix. A `###` inside a section is the section's own
    content, so blocks run to the next `## ` heading or EOF. Sections before
    the first clause (the preamble, `## Clauses` itself) stay unscanned:
    the weight line is R17/R18's territory, not citation prose."""
    headings = list(CLAUSE_HEADING_RE.finditer(text))
    if not headings:
        return []
    first_clause = headings[0].start()
    sections = []
    for m in re.finditer(r"(?m)^## .*$", text):
        if m.start() < first_clause:
            continue
        nxt = re.search(r"(?m)^## ", text[m.end():])
        end = m.end() + (nxt.start() if nxt else len(text) - m.end())
        sections.append((
            m.group(0).strip(),
            text[m.start():end].rstrip("\n"),
            text.count("\n", 0, m.start()) + 1,
        ))
    return sections


# ---------------------------------------------------------------------------
# Weight line parsing, for R17/R18. The line sits in the preamble, above the
# first heading, so parse_constitution never sees it.
# ---------------------------------------------------------------------------

# The one mechanical home for the ceilings (#160). CLAUDE.md's `## Job
# weight` table restates them for the humans who derive a weight, and a
# test welds that table to this dict so the two can't drift; nothing else
# may state the numbers.
CLAUSE_CEILINGS = {"light": 5, "standard": 8, "deep": None}

WEIGHT_LINE_RE = re.compile(r"(?m)^\*\*Job weight\*\*:\s*(.*)$")
OVERRUN_LINE_RE = re.compile(r"(?m)^\*\*Ceiling overrun\*\*:\s*(.*)$")
# The id is matched narrowly rather than as `(\S+)`, so `R10—misread` reads
# as R10 with a reason instead of as a rule named "R10—misread". This repo's
# own prose style chains em dashes with no surrounding spaces, which is
# exactly the input a greedy capture swallows.
LINT_EXCEPTION_RE = re.compile(
    r"(?m)^\*\*Lint exception\*\*:[ \t]*([Rr]\d+['′’]?)[ \t]*[—–:-]*[ \t]*(.*)$"
)
# A line that names the field but nothing that parses as a rule id at all.
# Kept separate so R20 can say "malformed" rather than "unknown rule".
LINT_EXCEPTION_ANY_RE = re.compile(r"(?m)^\*\*Lint exception\*\*:[ \t]*(.*)$")

PROOF = "proof"
HEURISTIC = "heuristic"

# Which rules prove a defect and which infer one (#139). The distinction was
# already load-bearing in run_rules' ordering ("proofs before heuristics")
# and nowhere else, so a misfire and a real defect blocked a dispatch
# identically. A proof means the paperwork is wrong. A heuristic means the
# paperwork is wrong OR the rule misread it, and only that second kind is
# waivable—see rule_R20, which refuses a waiver against anything else.
#
# The line is what a rule does, not whether it has misfired yet. R2 guesses
# which backtick span anchors a citation, R9 pattern-matches an instruction
# to pass while filing a defect, R10 reads a count above a list, R12'
# compares near-duplicate sentences across artifacts. Each infers a defect
# from prose, and all four carry constants tuned against a single seven-task
# corpus.
#
# Classify a new rule by that question alone. #132's review is suggestive
# rather than decisive here: it produced false positives in R2, R9 and R10,
# and also in R4's preamble scan—and R4 stays a proof, because what went
# wrong there was the scope it searched rather than an inference it drew,
# and it was fixed in #138. A rule that has never misfired can still infer,
# which is R12's position.
RULE_CLASS = {
    "R1": PROOF, "R2": HEURISTIC, "R3": PROOF, "R4": PROOF, "R5": PROOF,
    "R6": PROOF, "R7": PROOF, "R8": PROOF, "R9": HEURISTIC,
    "R10": HEURISTIC, "R12": HEURISTIC, "R13": PROOF, "R14": PROOF,
    "R15": PROOF, "R16": PROOF, "R17": PROOF, "R18": PROOF, "R19": PROOF,
    "R20": PROOF, "R21": PROOF, "R22": PROOF,
}


def normalize_rule_id(rid):
    """`R12'` and `R12` are the same rule. R12 prints itself with a prime
    because #132 replaced the original R12 with a narrower one and the prime
    is how the plan distinguished them, so the id in a message and the id a
    human types into a waiver can differ by that character. Normalizing here
    means RULE_CLASS is keyed once and both spellings find it."""
    return rid.strip().rstrip(":").rstrip("'′’")


def rule_id_of(msg):
    """The rule id a violation message opens with. Every rule body formats
    its message as `R<N> <slug>: ...`, which the module docstring documents
    as the contract, so the id is the first token."""
    return normalize_rule_id(msg.split(None, 1)[0]) if msg else ""


def rule_class_of(msg):
    """PROOF for anything unrecognized, so a rule added without a RULE_CLASS
    entry blocks as a proof rather than becoming silently waivable. R20
    catches the missing entry itself; this is the fallback if it somehow
    doesn't."""
    return RULE_CLASS.get(rule_id_of(msg), PROOF)


def parse_lint_exceptions(text):
    """{rule_id: reason} from the constitution's preamble. Repeatable, one
    rule per line—a waiver is a decision about one rule, and one line per
    decision keeps a reason free to contain whatever punctuation it needs.

    Run through scoped() like every other prose scanner in this file, so a
    waiver inside a fenced block or an HTML comment is not live. That is not
    a hypothetical: the shipped constitution template opens its preamble
    with a multi-line `<!--`, so preamble comments are the norm here, and
    commenting a line out is the universal way to turn it OFF. A waiver that
    switched ON when commented out would be the worst possible direction for
    this particular mechanism to fail in.

    A reason that is empty or still carries the template's `<` placeholder
    recorded nothing, and the id is kept with an empty reason so R20 can
    refuse it by name rather than the line vanishing silently. First
    non-empty reason wins, so a stale placeholder appended below a real
    reason can't blank it.
    """
    boundary = NEXT_H2_OR_H3_RE.search(text)
    preamble = scoped(text[:boundary.start()] if boundary else text)
    out = {}
    for m in LINT_EXCEPTION_RE.finditer(preamble):
        rid = normalize_rule_id(m.group(1)).upper()
        reason = m.group(2).strip()
        if reason.startswith("<"):
            reason = ""
        if out.get(rid):
            continue
        out[rid] = reason
    malformed = [
        m.group(1).strip()
        for m in LINT_EXCEPTION_ANY_RE.finditer(preamble)
        if not LINT_EXCEPTION_RE.match(m.group(0))
    ]
    return out, malformed


class WeightInfo:
    def __init__(self, raw, line, weight, token, placeholder, overrun_reason):
        self.raw = raw
        self.line = line
        self.weight = weight            # a CLAUSE_CEILINGS key, or None
        self.token = token              # the raw first word, for diagnostics
        self.placeholder = placeholder
        self.overrun_reason = overrun_reason


def parse_weight_line(text):
    """WeightInfo from the constitution's preamble, or None when no
    `**Job weight**:` line exists at all. Only the preamble—text before the
    first `##`/`###` heading—is searched, so a clause quoting the line's
    shape can't shadow the real one. The effective weight is the first
    word of the first comma-segment, which reads `standard, corrected from
    light by the user, <reason>` as standard with no extra grammar. A
    value still starting with `<` is the template placeholder, untouched
    since Phase 0 skipped its derivation step."""
    boundary = NEXT_H2_OR_H3_RE.search(text)
    preamble = text[:boundary.start()] if boundary else text
    m = WEIGHT_LINE_RE.search(preamble)
    if not m:
        return None
    value = m.group(1).strip()
    line = text.count("\n", 0, m.start()) + 1
    placeholder = value.startswith("<")
    token = value.split(",")[0].split()[0].lower() if value.split(",")[0].split() else ""
    weight = token if token in CLAUSE_CEILINGS else None
    om = OVERRUN_LINE_RE.search(preamble)
    # An overrun line whose reason is empty recorded nothing—R18 treats it
    # as absent rather than as a waiver you can leave blank. A `<`-leading
    # value is the template's shape copied without a decision behind it,
    # which is the same nothing (mirrors the weight placeholder above).
    overrun_reason = om.group(1).strip() if om else ""
    if overrun_reason.startswith("<"):
        overrun_reason = ""
    return WeightInfo(value, line, weight, token, placeholder, overrun_reason)


# ---------------------------------------------------------------------------
# R17/R18: weight line and clause ceiling (#160). Both run under CON-audit
# and DEC-audit alike—the constitution is input to both—and R17 runs first
# so a constitution with no usable weight always reports as "derive the
# weight" rather than as a ceiling complaint about a ceiling it never set.
# R18 is deliberately not a hard cap: CLAUDE.md calls the ceiling a budget,
# not a gate, so what it refuses is an overrun nothing recorded. The
# recorded form is a `**Ceiling overrun**:` line with a non-empty reason.
# ---------------------------------------------------------------------------

def rule_R17(ctx):
    w = ctx.weight
    if w is None:
        return (
            "R17 weight-line: constitution.md:1 has no **Job weight** line above "
            "## Clauses—phase 0's derivation step (the constitution skill's "
            "interview) sets it before drafting"
        )
    if w.placeholder:
        return (
            f"R17 weight-line: constitution.md:{w.line} still carries the template "
            "placeholder—phase 0's derivation step (the constitution skill's "
            "interview) was skipped"
        )
    if w.weight is None:
        return (
            f"R17 weight-line: constitution.md:{w.line} weight '{w.token}' is none "
            "of light, standard, or deep"
        )
    return None


def rule_R18(ctx):
    w = ctx.weight
    if w is None or w.weight is None:
        return None  # no usable weight is R17's finding, not a ceiling question
    ceiling = CLAUSE_CEILINGS[w.weight]
    if ceiling is None:
        return None  # deep is unbounded by design
    count = len(ctx.clauses)
    if count > ceiling and not w.overrun_reason:
        return (
            f"R18 clause-ceiling: constitution.md:{w.line} {count} clauses against "
            f"{w.weight}'s ceiling of {ceiling} and no **Ceiling overrun** line "
            "records why"
        )
    return None


# ---------------------------------------------------------------------------
# R19: baseline value (#182). The `- **baseline**:` field is optional—a
# clause that declares nothing is skipped by check-baselines.py and counted,
# not failed—so the only defect this rule can prove is a value that is
# neither red nor green: a declaration check-baselines.py could not hold
# the check to, caught here before an auditor round instead of surfacing
# as that script's could-not-run bucket mid-audit.
# ---------------------------------------------------------------------------

def rule_R20(ctx):
    """A `**Lint exception**:` line has to name a heuristic and say why
    (#139). Three ways it doesn't, all proved rather than inferred:

    A waiver against a proof rule is the dangerous one. A proof fires on a
    citation that doesn't resolve or a graph with a cycle, and there is no
    reading of those where the rule is the thing that's wrong—so a waiver
    would suppress a real defect rather than a misread, which is the one
    outcome this whole mechanism must not buy. An unknown id is refused for
    the same reason at one remove: it silences nothing today, and it becomes
    a live waiver the moment someone adds a rule under that number.

    An empty reason is refused because the reason is the point. The waiver
    costs a line either way; what makes it worth having is the record of why
    a rule was silenced, which is what a later tuning pass reads. Note this
    is stricter than R18 is about an empty `**Ceiling overrun**:` line, which
    is simply ignored: an overrun line under budget waives nothing, so an
    empty one is harmless, while an empty waiver line is a request to
    silence a rule with no case made for it.
    """
    for raw in ctx.malformed_exceptions:
        return (
            f"R20 lint-exception: constitution.md has a **Lint exception** line "
            f"whose rule id doesn't parse ({raw!r}); write it as `**Lint "
            "exception**: R10 — <why>`, with the rule id first"
        )
    for rid, reason in sorted(ctx.lint_exceptions.items()):
        cls = RULE_CLASS.get(rid)
        if cls is None:
            return (
                f"R20 lint-exception: constitution.md waives {rid}, which is not "
                "a rule this linter has; a waiver against an unknown id silences "
                "nothing now and silences whatever takes that number later"
            )
        if cls != HEURISTIC:
            return (
                f"R20 lint-exception: constitution.md waives {rid}, which proves "
                "its defect rather than inferring it; only a heuristic can misread "
                f"paperwork, so only a heuristic can be waived ({_heuristic_list()})"
            )
        if not reason:
            return (
                f"R20 lint-exception: constitution.md waives {rid} with no reason "
                "recorded; the reason is what a later pass at the rule reads, and "
                "silencing a rule is not something this linter will do on an "
                "unexplained request"
            )
    return None


def _heuristic_list():
    # Sort through normalize_rule_id so a primed key like R12' can be added
    # to RULE_CLASS without int() choking on the prime.
    names = sorted(
        (r for r, c in RULE_CLASS.items() if c == HEURISTIC),
        key=lambda r: int(normalize_rule_id(r)[1:] or 0),
    )
    return "waivable: " + ", ".join(names)


def rule_R19(ctx):
    for cid in sorted(ctx.clauses, key=lambda c: int(c[2:])):
        clause = ctx.clauses[cid]
        if clause.baseline is None:
            continue
        if clause.baseline not in ("red", "green"):
            return (
                f"R19 baseline-value: constitution.md:{clause.baseline_line} {cid} "
                f"baseline '{clause.baseline}' is neither red nor green"
            )
    return None


# ---------------------------------------------------------------------------
# Section-scope exclusion: fenced code blocks and HTML comments are blanked
# (not deleted) so every offset computed before this step still lines up
# with a physical line afterward.
# ---------------------------------------------------------------------------

FENCE_RE = re.compile(r"```.*?```", re.S)
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)


def _blank(pattern, text):
    def repl(m):
        return "".join(ch if ch == "\n" else " " for ch in m.group(0))
    return pattern.sub(repl, text)


def scoped(text):
    return _blank(HTML_COMMENT_RE, _blank(FENCE_RE, text))


# Sentence splitting, shared by R2 (anchor-span proximity), R9 (verdict
# contradiction), and R12' (cross-artifact count)—defined once up here
# since R2 needs it below.
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def sentences(text):
    return [s.strip() for s in SENTENCE_SPLIT_RE.split(text) if s.strip()]


def sentence_bounds(text, offset):
    """(start, end) of the sentence in `text` that contains `offset`, using
    the same split points as `sentences()`—so "the same sentence" means
    what a reader would call the same sentence, not an arbitrary character
    window."""
    start = 0
    end = len(text)
    for m in SENTENCE_SPLIT_RE.finditer(text):
        if m.start() >= offset:
            end = m.start()
            break
        start = m.end()
    return start, end


# ---------------------------------------------------------------------------
# R1 / R2 / R3: citations.
# ---------------------------------------------------------------------------

# No whitespace around the colon (so a folded scalar's word-wrap can't turn
# unrelated neighbours into a fake citation), and the path half must contain
# a `/`—that's what keeps `retries: 0`, a bare `ref.py:74` mentioned by
# name alone, and an ISO timestamp like `2026-08-08T14:47:08Z` from ever
# reaching the regex's file-existence check in the first place.
CITATION_RE = re.compile(r"([~\w./#@-]*[\w-]\.[A-Za-z0-9]+):(\d+)\b")
ATX_HEADING_RE = re.compile(r"^#{1,6}\s")
SETEXT_UNDERLINE_RE = re.compile(r"^(=+|-+)\s*$")

# An anchor span has to be long enough, and word-shaped enough, to be an
# excerpt of real code rather than a path fragment: T-001.md:57 alone carries
# five backtick spans, and the 3-character `` `ref` `` one matches 18 lines
# of check-provenance.py that have nothing to do with the cited line. Length
# 24 plus "contains a space" cuts the corpus-wide count from 80 backtick
# spans to 14 survivors (measured against the real #117 archive)—not down
# to one, the way an earlier version of this comment claimed; what the
# filter buys is ruling out path fragments and short identifiers, not
# uniqueness. Proximity (below) is what narrows a citation down to the
# right one of the 14. Without the length/space filter at all, R2 fails
# the corpus it has to pass.
def anchor_spans(text):
    spans = []
    for m in re.finditer(r"`([^`]*)`", text):
        content = m.group(1)
        if len(content) >= 24 and " " in content:
            spans.append((m.start(), m.end(), content))
    return spans


def nearest_anchor(text, citation_offset, exclude):
    """(start, content) of the anchor-span closest to `citation_offset`,
    scoped to the citation's own sentence—(None, None) if nothing
    qualifies. Distance is absolute: an anchor can sit either before its
    citation ("exactly as `...` already do, see `compose-brief.py:64`") or
    after it ("see `helper.py:6` for the reference implementation
    (`...`)"), and both shapes appear in the corpus this rule has to pass.

    #132's adversarial review found the BLOCKER this guards against:
    `candidates[0]` used to mean "the first anchor span anywhere in the
    region," so one unrelated code excerpt early in a check_method could
    veto every later, correct citation in that same region. Scoping to the
    citation's sentence and picking the nearest span by distance is what
    keeps both real shapes working while refusing to let a span from a
    different sentence stand in for either.

    `start` is returned alongside the content (#193) so a caller can report
    where the anchor itself sits in the citing document—a markdown list
    introduced by a colon keeps a sentence open across every bullet, so the
    anchor can land several lines from the citation it's scoped to.
    """
    sent_start, sent_end = sentence_bounds(text, citation_offset)
    best_dist, best_start, best_content = None, None, None
    for start, end, content in anchor_spans(text):
        if content == exclude or start < sent_start or end > sent_end:
            continue
        dist = start - citation_offset if start >= citation_offset else citation_offset - end
        if best_dist is None or dist < best_dist:
            best_dist, best_start, best_content = dist, start, content
    return best_start, best_content


def is_excluded_citation_path(path):
    return path.startswith("/") or path.startswith("~") or "/" not in path


def find_citations(text):
    """[(offset, path, lineno_str)] for every CITATION_RE match whose path
    is a resolvable repo-relative path—filters out absolute paths,
    `~`-paths, and bare basenames up front, same as the plan requires."""
    out = []
    for m in CITATION_RE.finditer(text):
        path = m.group(1)
        if is_excluded_citation_path(path):
            continue
        out.append((m.start(), path, m.group(2)))
    return out


def r2_anchor_message(anchor, label, src_line, path, lineno, actual_line, anchor_line):
    """The R2 diagnostic, built as its own named seam (#193/C-9) rather than
    inlined in `check_citation_rules`, so a later check can strip the
    quoted anchor back out while every older R2 case—that it fires at all,
    at exit 4—keeps passing. `anchor` is the exact span `nearest_anchor`
    matched, quoted `!r` the way this file already quotes spans elsewhere
    (R3, R12').

    Names where the anchor sits in the CITING document, not just the two
    target-file line numbers R2 already reports—a citation can open a
    markdown list with a colon and keep the sentence (and the anchor
    lookup) open across every bullet, so the anchor can land several lines
    from the citation itself, or share its line exactly. Both read
    correctly: `dotfiles#22` cost two rounds to an author permuting prose
    with no way to tell a wrong citation from a wrongly matched anchor.
    """
    if anchor_line == src_line:
        where = f"on this same line ({label}:{src_line})"
    else:
        where = f"at {label}:{anchor_line}"
    return (
        f"R2 citation-anchor: {label}:{src_line} cites {path}:{lineno} quoting "
        f"{anchor!r}, which sits {where} in the citing document—but that code "
        f"is actually at {path}:{actual_line}"
    )


def check_citation_rules(regions, repo_root, want_rule):
    """Runs R1 (resolves), R3 (shape), or R2 (anchor)—`want_rule` in
    {"R1", "R3", "R2"}—over every citation in `regions`, in file order,
    and returns the first violation's diagnostic or None.

    `regions` is a list of (source_label, text, line_of_offset) triples,
    already scope-filtered (fenced/HTML-comment blanked). Bundling the three
    citation rules into one scan keeps them sharing one citation-finding
    pass rather than three, and R2 needs R1's resolved target line anyway.
    """
    for label, text, line_of in regions:
        for offset, path, lineno_str in find_citations(text):
            src_line = line_of(offset)
            lineno = int(lineno_str)
            target_path = os.path.join(repo_root, path)

            if not os.path.isfile(target_path):
                if want_rule == "R1":
                    return f"R1 citation-resolves: {label}:{src_line} cites {path}:{lineno} but that file does not exist under --repo-root"
                continue
            try:
                with open(target_path, encoding="utf-8") as f:
                    target_lines = f.read().splitlines()
            except OSError as e:
                if want_rule == "R1":
                    return f"R1 citation-resolves: {label}:{src_line} cites {path}:{lineno} but the file can't be read: {e}"
                continue

            if lineno < 1 or lineno > len(target_lines):
                if want_rule == "R1":
                    return f"R1 citation-resolves: {label}:{src_line} cites {path}:{lineno} but {path} only has {len(target_lines)} line(s)"
                continue

            target_line = target_lines[lineno - 1]

            if want_rule == "R3":
                if target_line.strip() == "":
                    return f"R3 citation-shape: {label}:{src_line} cites {path}:{lineno} but that line is blank"
                if path.endswith(".md"):
                    if ATX_HEADING_RE.match(target_line.strip()):
                        return f"R3 citation-shape: {label}:{src_line} cites {path}:{lineno} but that line is a heading ({target_line.strip()!r})"
                    if SETEXT_UNDERLINE_RE.match(target_line.strip()):
                        return f"R3 citation-shape: {label}:{src_line} cites {path}:{lineno} but that line is a setext heading underline"
                continue

            if want_rule == "R2":
                # The citation's own backtick-wrapped form never counts as
                # its own anchor—excluded so a long relative path can't
                # accidentally "confirm" itself. The anchor itself is
                # scoped to this citation's own sentence and picked by
                # proximity (see nearest_anchor)—a region can carry more
                # than one citation, or an unrelated code aside, and
                # neither may stand in for a citation it isn't next to.
                anchor_start, anchor = nearest_anchor(text, offset, f"{path}:{lineno}")
                if anchor is None:
                    continue  # nothing nearby to check this citation against
                target_stripped = " ".join(target_line.split())
                anchor_norm = " ".join(anchor.split())
                if anchor_norm in target_stripped:
                    continue
                # It's wrong, but say where it's actually right: scan the
                # whole target file for the quoted code so the diagnostic
                # names the true line, not just the false one.
                actual_line = None
                for i, cand_line in enumerate(target_lines, start=1):
                    if anchor_norm in " ".join(cand_line.split()):
                        actual_line = i
                        break
                if actual_line is not None:
                    return r2_anchor_message(
                        anchor, label=label, src_line=src_line, path=path,
                        lineno=lineno, actual_line=actual_line,
                        anchor_line=line_of(anchor_start),
                    )
                # The anchor text is absent from the WHOLE target file, not
                # just the cited line. That's evidence this span isn't this
                # citation's anchor at all—an unrelated excerpt sitting in
                # the same sentence—not evidence the citation is wrong; a
                # real drift case always leaves the quoted code findable
                # somewhere in the file it was quoted from.
                continue
    return None


# ---------------------------------------------------------------------------
# check_method segmentation, shared by R4, R5, R6, and R9.
# ---------------------------------------------------------------------------

# The colon is required. A bare `\bC-\d+\b` mis-segments T-007, whose C-9
# text says "On C-6 or C-9, an absent fact is a FAIL"—the second mention
# has no colon and isn't a new segment, but a colon-less pattern would split
# there anyway and hand R4 half a sentence to judge on its own. The `(?:^|\s)`
# guard keeps a mid-word "abc-9:" from counting, and the optional `(N)`
# prefix matches T-003's numbered "(1) C-3: ...".
SEGMENT_RE = re.compile(r"(?:^|\s)(?:\(\d+\)\s*)?(C-\d+):\s")


def find_segments(text):
    """(preamble, [(clause_id, value_start_offset, value_text)])—one entry
    per `C-N:` key found, in order. `value_text` runs up to the next key or
    end of string, so it may carry trailing debris from a following `(N) `
    numbering prefix; that's harmless for every rule that reads it."""
    matches = list(SEGMENT_RE.finditer(text))
    if not matches:
        return text, []
    preamble = text[:matches[0].start(1)]
    segments = []
    for i, m in enumerate(matches):
        seg_start = m.end()
        seg_end = matches[i + 1].start(1) if i + 1 < len(matches) else len(text)
        segments.append((m.group(1), seg_start, text[seg_start:seg_end]))
    return preamble, segments


def classify_check_text(text):
    """("script", invocation) | ("judgment", rubric) | (None, None)."""
    t = text.strip()
    if t.startswith("checker-judgment:"):
        return "judgment", t[len("checker-judgment:"):].strip()
    if re.match(r"^\.agent-guild/scripts/\S+", t):
        return "script", t
    return None, None


# ---------------------------------------------------------------------------
# R21: checker routing (#193). CLAUDE.md's routing table assigns a checker
# by clause KIND: a clause checked by a script routes to
# checker-deterministic, a clause checked by a rubric routes to
# checker-judgment. Only the harmful direction gets a rule—a
# checker-deterministic task can't apply a rubric at all, since that agent
# runs scripts and exercises no judgment. A checker-judgment task holding
# script clauses is safe (house precedent in the archive) and stays legal.
#
# The kind is read off `clause.check_text`, the constitution's own field,
# never off the task's `check_method` paraphrase of it. A task's own prose
# can disagree with the clause it names—`check_method` is free text a
# worker or decompose step wrote, and reading it instead would report
# whichever clause the paraphrase happens to mention rather than the one
# that's actually unreachable. 36 of the archive's 40 tasks cite more than
# one clause, so a paraphrase-reading variant reports the wrong clause on
# most of the corpus it would ever run against.
#
# PROOF, not HEURISTIC: a checker-deterministic agent literally cannot run
# a rubric, so this proves the paperwork is broken rather than guessing at
# it. That's also why it has to run ahead of every heuristic in run_rules
# (R2, R9, R10, R12' per RULE_CLASS)—paperwork carrying both a routing
# defect and an inferred one must report the unwaivable proof, not the
# waivable guess a heuristic would offer first.
# ---------------------------------------------------------------------------

def rule_R21(ctx, audit_id):
    if audit_id == "CON-audit":
        return None  # no tasks yet to route
    for task in ctx.tasks:
        if task.checker != "checker-deterministic":
            continue
        for cid in task.clauses:
            clause = ctx.clauses.get(cid)
            if clause is None:
                continue  # an unknown clause id is R6's finding, not this one
            kind, _ = classify_check_text(clause.check_text)
            if kind == "judgment":
                return (
                    f"R21 checker-routing: {task.label} declares checker: "
                    f"checker-deterministic but cites {cid}, whose "
                    "constitution check is checker-judgment:—that agent runs "
                    "scripts and exercises no judgment, so the rubric can't "
                    "be applied"
                )
    return None


# ---------------------------------------------------------------------------
# R4: check form. Closes #121—a check that isn't a script invocation or a
# named judgment rubric is unverifiable prose masquerading as a check.
# ---------------------------------------------------------------------------

# The #121 evasion: word a check_method's free-text preamble to *describe*
# running a script, ahead of the real `C-N:` segments, so nothing keyed to a
# clause ever has to name it. A bare mention for context ("the suite lives
# in X.py") is common and harmless on its own—T-003's real preamble names
# its own suite this way to orient the reader before the numbered
# commands—so what has to stay caught is the INVOCATION shape: the token
# opens the preamble outright (read as a command line, not prose), or sits
# right before something command-arg shaped (a quote or a flag).
SCRIPT_TOKEN_RE = re.compile(r"\S+\.(sh|py|mjs)\b")
INVOCATION_TAIL_RE = re.compile(r"^\s*(['\"]|-\S)")


def _invocation_shaped_script_mention(preamble):
    for m in SCRIPT_TOKEN_RE.finditer(preamble):
        if preamble[:m.start()].strip() == "":
            return m  # opens the preamble outright
        if INVOCATION_TAIL_RE.match(preamble[m.end():]):
            return m  # followed by a quote or a flag, not just prose
    return None


def rule_R4(ctx, audit_id):
    for cid in sorted(ctx.clauses, key=lambda c: int(c[2:])):
        clause = ctx.clauses[cid]
        kind, _ = classify_check_text(clause.check_text)
        if kind is None:
            return (
                f"R4 check-form: constitution.md:{clause.check_line} clause {cid}'s "
                "check is neither a .agent-guild/scripts/ invocation nor "
                "checker-judgment: <rubric>"
            )
    for task in ctx.tasks:
        text = scoped(task.check_method_text)
        preamble, segments = find_segments(text)
        m = _invocation_shaped_script_mention(preamble)
        if m:
            line = task.line_for_check_method_offset(m.start())
            return (
                f"R4 check-form: {task.label}:{line} check_method names "
                f"{m.group(0)!r} outside any C-N: segment"
            )
        for cid, seg_start, seg_text in segments:
            kind, _ = classify_check_text(seg_text)
            if kind is None:
                line = task.line_for_check_method_offset(seg_start)
                return (
                    f"R4 check-form: {task.label}:{line} {cid}: segment is neither a "
                    ".agent-guild/scripts/ invocation nor checker-judgment: <rubric>"
                )
    return None


# ---------------------------------------------------------------------------
# R5: check runnable.
# ---------------------------------------------------------------------------

def _collect_script_checks(ctx):
    """[(label, line, invocation_text)] for every check classified "script"
    by R4—constitution clauses first, then task check_method segments."""
    checks = []
    for cid in sorted(ctx.clauses, key=lambda c: int(c[2:])):
        clause = ctx.clauses[cid]
        kind, val = classify_check_text(clause.check_text)
        if kind == "script":
            checks.append(("constitution.md", clause.check_line, val))
    for task in ctx.tasks:
        text = scoped(task.check_method_text)
        _, segments = find_segments(text)
        for cid, seg_start, seg_text in segments:
            kind, val = classify_check_text(seg_text)
            if kind == "script":
                line = task.line_for_check_method_offset(seg_start)
                checks.append((task.label, line, val))
    return checks


def rule_R5(ctx, repo_root):
    for label, line, invocation in _collect_script_checks(ctx):
        try:
            tokens = shlex.split(invocation)
        except ValueError as e:
            return f"R5 check-runnable: {label}:{line} check invocation can't be shell-parsed: {e}"
        if not tokens:
            return f"R5 check-runnable: {label}:{line} check invocation is empty"
        script_rel = tokens[0]
        script_path = os.path.join(repo_root, script_rel)
        if not os.path.isfile(script_path):
            return f"R5 check-runnable: {label}:{line} {script_rel} does not exist under --repo-root"
        if not os.access(script_path, os.X_OK):
            return f"R5 check-runnable: {label}:{line} {script_rel} is not executable (missing X_OK)"
        if os.path.basename(script_rel) == "check-build.sh":
            if len(tokens) < 2:
                return f"R5 check-runnable: {label}:{line} check-build.sh is given no quoted command"
            inner = tokens[1]
            # Syntax-check only—never execute. Executing a build/test
            # command from a linter that runs before every auditor dispatch
            # would make the linter itself part of the thing under test.
            try:
                proc = subprocess.run(
                    ["bash", "-n", "-c", inner], capture_output=True, text=True, timeout=10,
                )
            except (OSError, subprocess.TimeoutExpired) as e:
                return f"R5 check-runnable: {label}:{line} could not syntax-check check-build.sh's command: {e}"
            if proc.returncode != 0:
                detail = proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else f"exit {proc.returncode}"
                return f"R5 check-runnable: {label}:{line} check-build.sh's quoted command fails `bash -n`: {detail}"
    return None


# ---------------------------------------------------------------------------
# R6: clause wiring.
# ---------------------------------------------------------------------------

def rule_R6(ctx, audit_id):
    if audit_id == "CON-audit":
        return None
    if not ctx.tasks:
        return (
            "R6 clause-wiring: tasks/ is empty under --audit-id DEC-audit; "
            "a decomposition that produced no tasks decomposed nothing"
        )
    cited_by = {}
    for task in ctx.tasks:
        for cid in task.clauses:
            cited_by.setdefault(cid, []).append(task)
            if cid not in ctx.clauses:
                return (
                    f"R6 clause-wiring: {task.label} cites {cid} in clauses:, "
                    "which is not a clause in constitution.md"
                )
    for cid in sorted(ctx.clauses, key=lambda c: int(c[2:])):
        if cid not in cited_by:
            return f"R6 clause-wiring: constitution.md clause {cid} is never cited by any task"
    for task in ctx.tasks:
        text = scoped(task.check_method_text)
        _, segments = find_segments(text)
        keyed = {cid for cid, _, _ in segments}
        for cid in task.clauses:
            if cid not in keyed:
                return (
                    f"R6 clause-wiring: {task.label} cites {cid} in clauses: but "
                    f"check_method has no {cid}: segment"
                )
    return None


# ---------------------------------------------------------------------------
# R7: dependency DAG.
# ---------------------------------------------------------------------------

def rule_R7(ctx, audit_id):
    if audit_id == "CON-audit":
        return None
    by_id = {t.id: t for t in ctx.tasks}
    graph = {}
    for task in ctx.tasks:
        for dep in task.deps:
            if dep not in by_id:
                return f"R7 dag: {task.label} depends on {dep}, which is not a task in tasks/"
        graph[task.id] = set(task.deps)
    try:
        graphlib.TopologicalSorter(graph).prepare()
    except graphlib.CycleError as e:
        involved = e.args[1] if len(e.args) > 1 else e.args
        return f"R7 dag: dependency cycle among {', '.join(str(x) for x in involved)}"
    return None


# ---------------------------------------------------------------------------
# R15: owns shape. Closes #162's validation half. R13 below asks whether two
# entries overlap; that question only has a meaningful answer when both
# entries are one of the two shapes the field documents. A directory
# spelled without its trailing slash reads as a file claim and collides
# with nothing, so `src/lib` and `src/lib/` on two tasks pass R13 and enter
# the same wave over the same tree. R15 runs first so a malformed entry is
# reported as itself rather than as R13 finding nothing.
#
# Opt-in the same way R13 and R14 are, and for the same reason: an absent
# or empty `owns:` is not a violation, only a task with no entries to
# check. That keeps every archived corpus green (none of them has the
# field) while still refusing a bad entry in any job that does declare one.
# ---------------------------------------------------------------------------

def rule_R15(ctx, audit_id, repo_root):
    if audit_id == "CON-audit":
        return None  # no tasks yet to own anything
    if owns_entry_problem is None:
        return None  # check-diff-scope.py wasn't importable; see rule_R13
    for task in ctx.tasks:
        for entry in task.owns:
            problem = owns_entry_problem(entry, repo_root)
            if problem:
                return (
                    f"R15 owns-shape: {task.label} owns entry {entry!r} is malformed: "
                    f"{problem}. An entry is an exact file path or a directory prefix "
                    "ending in '/'"
                )
    return None


# ---------------------------------------------------------------------------
# R13: ownership overlap. Closes #133—two tasks dispatched concurrently can
# silently lose one task's write to the other's if they touch the same
# file, so any two tasks whose `owns` overlap have to be forced into
# sequence by a dep edge. Placed right after R7 (R15 goes between them,
# proving the entries are readable first), because walking a `deps` chain to
# look for that edge needs R7's acyclic-DAG guarantee—the same reason R8
# (below) waits for R7 too.
# ---------------------------------------------------------------------------

def rule_R13(ctx, audit_id):
    if audit_id == "CON-audit":
        return None  # no tasks yet to own anything
    if paths_overlap is None:
        # check-diff-scope.py wasn't importable. main()'s own import guard
        # already turns that into exit 3 for the CLI path; this branch is
        # only reachable via a direct rule_R13(ctx, audit_id) call with no
        # CLI import having run first, so silently finding nothing is the
        # same graceful-degradation shape DEFECT_SEVERITIES uses above.
        return None
    by_id = {t.id: t for t in ctx.tasks}
    owning = [t for t in ctx.tasks if t.owns]
    for i, ta in enumerate(owning):
        for tb in owning[i + 1:]:
            hit = None
            for pa in ta.owns:
                for pb in tb.owns:
                    if paths_overlap(pa, pb):
                        hit = (pa, pb)
                        break
                if hit:
                    break
            if hit is None:
                continue
            pa, pb = hit
            if tb.id in _transitive_deps(ta.id, by_id) or ta.id in _transitive_deps(tb.id, by_id):
                continue  # a dep path connects them, so they can't run concurrently anyway
            return (
                f"R13 ownership-overlap: {ta.label} owns {pa!r} and {tb.label} owns "
                f"{pb!r}, which overlap, with no dep path connecting {ta.id} and {tb.id}"
            )
    return None


# ---------------------------------------------------------------------------
# R14: dep rationale. Closes #125's dependency-justification half—every
# `deps` edge serializes a wave, so an edge nobody can name a reason for is
# wall clock nobody agreed to pay. Placed right next to R13 because it's
# opt-in the same way and for the same reason: scoped to owns-bearing tasks
# only, so the archived corpus (which predates both fields) stays green.
#
# This is the MECHANICAL half only—that a rationale exists for each dep and
# the two lists correspond one to one. Whether a rationale is actually
# TRUE, once it exists, is judgment: that's the auditor's job under
# DEC-audit, not this linter's.
# ---------------------------------------------------------------------------

def rule_R14(ctx, audit_id):
    if audit_id == "CON-audit":
        return None  # no tasks yet to depend on anything
    for task in ctx.tasks:
        if not task.owns:
            continue  # opt-in: a task with nothing to own owes no rationale
        for task_id, text in task.dep_rationale:
            if task_id is None:
                return (
                    f"R14 dep-rationale: {task.label} dep_rationale entry {text!r} is not "
                    "of the form 'T-NNN: rationale'"
                )
        rationale_ids = [task_id for task_id, _ in task.dep_rationale]
        rationale_set = set(rationale_ids)
        seen = set()
        for task_id in rationale_ids:
            if task_id in seen:
                return (
                    f"R14 dep-rationale: {task.label} names {task_id} more than once in "
                    "dep_rationale"
                )
            seen.add(task_id)
        for dep in task.deps:
            if dep not in rationale_set:
                return (
                    f"R14 dep-rationale: {task.label} depends on {dep} but dep_rationale "
                    "names no rationale for it"
                )
        deps_set = set(task.deps)
        for task_id in rationale_ids:
            if task_id not in deps_set:
                return (
                    f"R14 dep-rationale: {task.label} dep_rationale names {task_id}, which "
                    "is not in this task's deps"
                )
    return None


# ---------------------------------------------------------------------------
# R8: build ordering.
# ---------------------------------------------------------------------------

# Read off scripts/build-plugin.py's own source tree, not restated from
# memory: guild-core/ and these five .agent-guild/ subpaths are what it
# copies INTO the shipped trees. .agent-guild/state/ is deliberately absent
#—it's job bookkeeping, not a build input, and without this exclusion
# T-007's own commit-message.md (under .agent-guild/state/) would count as
# an input it regenerates from, making it a trivial self-dependency.
BUILD_INPUT_PREFIXES = (
    "guild-core/",
    ".agent-guild/CLAUDE.md",
    ".agent-guild/scripts",
    ".agent-guild/templates",
    ".agent-guild/schemas",
    ".agent-guild/hooks",
    "scripts/plugin-src/",
    "docs/plugin-readme.md",
    "CHANGELOG.md",
)
# The two marketplace files are outputs too (build-plugin.py's
# write_marketplaces), and neither sits under one of the three tree
# prefixes above—`.claude-plugin/` is a different directory from
# `.claude/`, and `.agents/` matches nothing here at all. Left out, a task
# whose only generated artifact is a marketplace file reads as a task that
# regenerates nothing, and R8 and R16 both go quiet on the job it belongs
# to. _is_generated uses startswith, so an exact-file entry works.
GENERATED_TREE_PREFIXES = (
    "plugin/",
    "plugins/",
    ".claude/",
    ".claude-plugin/marketplace.json",
    ".agents/plugins/marketplace.json",
)


def _is_build_input(path):
    if path.startswith(".agent-guild/state/"):
        return False
    return any(path == p or path.startswith(p) for p in BUILD_INPUT_PREFIXES)


def _is_generated(path):
    return any(path.startswith(p) for p in GENERATED_TREE_PREFIXES)


def _transitive_deps(task_id, by_id, seen=None):
    seen = seen if seen is not None else set()
    for dep in by_id[task_id].deps:
        if dep not in seen:
            seen.add(dep)
            _transitive_deps(dep, by_id, seen)
    return seen


# ---------------------------------------------------------------------------
# R22: delegation vs the schedule (#190). A clause can hand part of its own
# coverage to other clauses—"this binds coverage, not correctness, which is
# why C-2, C-3, and C-4 exist." Whether that note is true is not a fact about
# the constitution. It is a fact about the schedule, because a clause checked
# before the artifact it would have to read exists covers nothing.
#
# #143 measured how reliably an auditor catches one. Eight blind DEC rounds
# against a reconstructed #100 r1 constitution, each given the charter
# verbatim: every run filed four to six real findings, no charter caught all
# three planted defects every time, and the miss rotated between rounds
# rather than shrinking. The reading that fits is that a round files roughly
# a fixed number of findings whatever its charter says, so prose steers which
# defects a round reaches, not how many. This rule takes one class out of
# that competition entirely.
#
# Only `text` and `note` are scanned, and that scoping is what keeps this a
# proof. A delegation of coverage is a normative claim about what this clause
# does not have to cover, and both archived instances carry theirs in a
# `- **note**:` line—so `text` alone would miss the shape the rule exists for.
# The other two fields mention clause ids for reasons that are not
# delegations: `check` cross-references another clause to explain how to run
# this one (#100's C-4 cites C-2 to justify why a fixture can't exist), and
# `failing example` reaches for one by analogy (#117's C-9). Scanning either
# fires on correct paperwork, and a proof cannot be waived—R20 refuses—so a
# false positive here has no recourse short of state/PAUSED. Precision wins
# that trade. The cost is real and worth naming: a delegation written into a
# `check` field goes uncaught (2026-07-14's C-1 hands agent and skill
# presence to C-2 exactly that way). `scoped()` runs first, so a mention
# inside a fenced example or an HTML comment doesn't count, and the heading
# line is skipped—the id in it is the clause's own.
#
# Carriers come from task frontmatter `clauses:`, never from `check_method`'s
# paraphrase of it, for the reason R21 gives above. A clause with no carrier
# and a mention of a clause id that doesn't exist are both R6's findings, so
# this rule steps over them rather than reporting them twice.
#
# PROOF, not HEURISTIC: it fires only when the DAG settles the question
# outright—every named clause carried only by tasks strictly upstream of
# every task carrying the delegating clause. One named clause sharing a task,
# or carried by a task neither upstream nor downstream, is not provably early,
# and the rule claims only what the graph proves. That is also why it sits
# here rather than earlier: `_transitive_deps` recurses unguarded and is safe
# only behind R7's acyclicity proof, the same reason R13 and R8 run after R7.
# ---------------------------------------------------------------------------

CLAUSE_MENTION_RE = re.compile(r"\bC-\d+\b")


DELEGATING_FIELDS = ("text", "note")


def _delegated_clause_ids(clause, all_clauses):
    """The other clause ids named in `clause`'s `text` and `note` fields, in
    numeric order. Continuation lines count: #117's C-1 carries a bulleted
    list under `text`, and a mention there reads the same as one on the
    field's own line."""
    field = None
    named = set()
    for line in scoped(clause.block_text).split("\n")[1:]:
        m = CLAUSE_FIELD_RE.match(line.strip())
        if m:
            field = m.group(1).strip().lower()
        if field in DELEGATING_FIELDS:
            named.update(CLAUSE_MENTION_RE.findall(line))
    named -= {clause.id}
    return sorted((c for c in named if c in all_clauses), key=lambda c: int(c[2:]))


def rule_R22(ctx, audit_id):
    if audit_id == "CON-audit" or not ctx.tasks:
        return None  # no schedule yet to read a note against; empty tasks/ is R6's
    by_id = {t.id: t for t in ctx.tasks}
    upstream = {t.id: _transitive_deps(t.id, by_id) for t in ctx.tasks}
    carriers = {}
    for task in ctx.tasks:
        for cid in task.clauses:
            carriers.setdefault(cid, []).append(task)

    for cid in sorted(ctx.clauses, key=lambda c: int(c[2:])):
        mine = carriers.get(cid)
        if not mine:
            continue  # an uncited clause is R6's finding
        leaned = []
        for other in _delegated_clause_ids(ctx.clauses[cid], ctx.clauses):
            theirs = carriers.get(other)
            if not theirs:
                break  # also R6's finding
            if not all(t.id in upstream[m.id] for m in mine for t in theirs):
                break  # not provably early, so this clause proves nothing
            leaned.append(f"{other} ({', '.join(t.label for t in theirs)})")
        else:
            if leaned:
                return (
                    f"R22 delegation-schedule: constitution.md {cid}, carried by "
                    f"{', '.join(t.label for t in mine)}, leans on "
                    f"{'; '.join(leaned)}—every one of those is checked by a task "
                    f"strictly upstream, so all of that checking completes before "
                    f"{', '.join(t.id for t in mine)} produces anything"
                )
    return None


def rule_R8(ctx, audit_id):
    if audit_id == "CON-audit" or not ctx.tasks:
        return None  # empty tasks/ under DEC-audit is already an R6 failure
    by_id = {t.id: t for t in ctx.tasks}
    inputs = {t.id for t in ctx.tasks if any(_is_build_input(a) for a in t.artifacts)}
    generated = {t.id for t in ctx.tasks if any(_is_generated(a) for a in t.artifacts)}
    if not generated:
        return None  # nothing in this job regenerates a shipped tree
    universe = inputs | generated
    # Existence, not universal ordering: "every input precedes every
    # generator" self-fires on T-007, whose own artifacts are both an input
    # (the schema, ledger-append.py) and a generated-tree write (the copies
    # under plugin/, .claude/)—it would have to be transitively upstream
    # of itself. What actually has to hold is that SOME regenerating task
    # runs last, after every other input and generator it needs to capture.
    for t in sorted(generated):
        if universe - {t} <= _transitive_deps(t, by_id):
            return None
    return (
        "R8 build-ordering: no generated-tree task ("
        + ", ".join(sorted(generated))
        + ") is downstream of every build-input and generated-tree task in "
        + "this job (" + ", ".join(sorted(universe)) + "); a regeneration "
        "could run before the last edit it needs to capture"
    )


# ---------------------------------------------------------------------------
# R16: build serialization. Closes #164. R8 puts the regeneration last; it
# says nothing about how many tasks regenerate, or about a job where nobody
# does and every worker is left to run the build on its own. Both gaps are
# live only under waves (#125): before them the loop dispatched one task at
# a time, so two concurrent regenerations were impossible by construction.
#
# The collision is the build RUN, not the build-input EDIT. Reading it the
# other way—two tasks that both edit inputs can't share a wave—would
# serialize essentially every wave in a repo that dogfoods its own kit,
# since nearly every task there edits `guild-core/` or `.agent-guild/`.
# Editing an input writes nothing under the generated trees. Only running
# the build does, and a task that runs it says so by declaring those trees
# among its artifacts.
#
# So: exactly one regenerating task, downstream of the edits (R8's half),
# and nobody else regenerating (this rule's second half). What no linter
# can prove is that a worker didn't run the build anyway without declaring
# it; the worker roles carry that instruction, and R8's ordering is what
# makes the declared regeneration the one that wins.
# ---------------------------------------------------------------------------

def rule_R16(ctx, audit_id):
    if audit_id == "CON-audit" or not ctx.tasks:
        return None
    by_id = {t.id: t for t in ctx.tasks}
    inputs = sorted(t.id for t in ctx.tasks if any(_is_build_input(a) for a in t.artifacts))
    generated = sorted(t.id for t in ctx.tasks if any(_is_generated(a) for a in t.artifacts))
    if inputs and not generated:
        return (
            "R16 build-serialization: "
            + ", ".join(inputs)
            + (" edits" if len(inputs) == 1 else " edit")
            + " a build input, but no task declares a generated tree among "
            "its artifacts; add one terminal task that regenerates and names "
            "those trees in its own artifacts, or every worker is left to run "
            "the build itself and two of them can race"
        )
    for i, ta in enumerate(generated):
        for tb in generated[i + 1:]:
            if tb in _transitive_deps(ta, by_id) or ta in _transitive_deps(tb, by_id):
                continue
            return (
                f"R16 build-serialization: {ta} and {tb} both declare a "
                "generated tree, with no dep path connecting them, so both "
                "can regenerate at once and one build's output overwrites "
                "the other's"
            )
    return None


# ---------------------------------------------------------------------------
# Section scope for the remaining prose rules (R9, R10, R12'): every region
# R1/R2/R3 already scan, reused so the "what counts as paperwork" boundary
# lives in one place.
# ---------------------------------------------------------------------------

def gather_prose_regions(ctx):
    """[(artifact_key, label, text, line_of_offset_fn)]. `artifact_key` is
    what "different artifacts" means for R12'—one key per file, so a
    task's own spec excerpt and check_method don't cross-compare against
    each other, only against a DIFFERENT file's regions."""
    regions = []
    for task in ctx.tasks:
        regions.append((task.path, task.label, scoped(task.spec_excerpt_text), task.line_for_excerpt_offset))
        regions.append((task.path, task.label, scoped(task.check_method_text), task.line_for_check_method_offset))
    for cid, clause in ctx.clauses.items():
        text = scoped(clause.block_text)

        def line_of(offset, _start=clause.block_start_line, _text=text):
            return _start + _text.count("\n", 0, offset)

        regions.append(("constitution.md", "constitution.md", text, line_of))
    # Post-Clauses sections (`## Protected content`, `## Non-goals`, ...)
    # were scanned before #160's boundary fix too—as the last clause's
    # accidental tail. Registering them here keeps that surface and fixes
    # the attribution: the section's own label, not an innocent clause id.
    # The artifact_key stays constitution.md on purpose, so R12' keeps
    # treating a section and a clause of the same file as one artifact
    # rather than cross-comparing them as two.
    for title, block_text, start_line in ctx.trailing_sections:
        text = scoped(block_text)

        def line_of(offset, _start=start_line, _text=text):
            return _start + _text.count("\n", 0, offset)

        regions.append(("constitution.md", f"constitution.md ({title})", text, line_of))
    return regions


def citation_regions(ctx):
    """Regions for R1/R2/R3, which additionally need `## Spec excerpt` and
    check_method kept separate from clause blocks (constitution.md carries
    its own line numbers directly, no offset function needed beyond what
    gather_prose_regions already builds)—same shape, so just reuse it."""
    return [(label, text, line_of) for _key, label, text, line_of in gather_prose_regions(ctx)]


# ---------------------------------------------------------------------------
# R9: verdict contradiction.
# ---------------------------------------------------------------------------

PASS_TOKEN_RE = re.compile(r"\b(pass|passes|passing)\b", re.I)
DEFECT_TOKEN_RE = re.compile(r"\b(major|blocker|defect|finding|gap)\b", re.I)

# The veto list is still what separates a real violation from the correct
# instruction that must exist to describe it—T-007's own C-9 text, "an
# absent fact is a FAIL, never a pass carrying a finding," reads as an
# instance of the very defect R9 exists to catch if all you check is
# "pass" and a defect word somewhere in the same sentence.
#
# #132's adversarial review found the false negative this produced: the
# veto used to fire on any of these words ANYWHERE in the sentence, so
# "If a named fact is not present, pass this task and file the gap as a
# major finding"—arguably the most natural phrasing of the exact defect
# this rule exists to catch—read as vetoed, because "not" happens to sit
# a few words upstream of an unrelated "present." The fix: a veto token
# only counts if it directly GOVERNS the pass token—sits right before it,
# with at most a determiner or two between ("never a pass", "refuses a
# pass", "would accept a pass," which are T-007's own three real
# instances)—rather than merely occurring somewhere in the same sentence.
# "not present, pass" no longer qualifies: the comma between them is what
# a person reads as the boundary between "not" governing "present" and
# "pass" starting a new clause, and requiring the veto and pass to be
# joined only by bare words (no comma reachable through `\s+\w+`) encodes
# that same boundary without a separate clause-splitter.
#
# Known residual false positive, left in deliberately: "the checker passes
# this clause only once every major finding it raised has been resolved
# upstream" still fires, because its qualifier follows the pass token
# instead of governing it. Widening the veto to look forward as well
# silences T-007's three real instances too, so the choice was one
# unlikely false positive against re-blinding the rule. If a real job hits
# it, rephrase the check_method rather than widening this—every widening
# here costs a defect the rule used to catch.
VETO_TOKENS = (
    "never", "not", "no", "nothing", "refuses", "rejects", "forbid",
    "anyway", "instead of", "rather than", "would accept", "cannot", "fails",
)
VETO_GOVERNS_PASS_RE = re.compile(
    r"\b(" + "|".join(re.escape(t) for t in VETO_TOKENS) + r")\b"
    r"(?:\s+\w+){0,2}\s+(?:pass|passes|passing)\b",
    re.I,
)


def r9_fires(sentence):
    # All three conjuncts required, biased toward false negatives: a false
    # positive here deadlocks a job on a sentence ABOUT the rule rather than
    # a violation of it, and an auditor still catches a real miss downstream.
    return bool(
        PASS_TOKEN_RE.search(sentence)
        and DEFECT_TOKEN_RE.search(sentence)
        and not VETO_GOVERNS_PASS_RE.search(sentence)
    )


def rule_R9(ctx):
    for cid in sorted(ctx.clauses, key=lambda c: int(c[2:])):
        clause = ctx.clauses[cid]
        if clause.severity not in DEFECT_SEVERITIES:
            continue
        for s in sentences(clause.check_text):
            if r9_fires(s):
                return (
                    f"R9 verdict-contradiction: constitution.md:{clause.check_line} "
                    f"clause {cid} ({clause.severity}) check text instructs a pass "
                    f"alongside a defect: {s!r}"
                )
    for task in ctx.tasks:
        text = scoped(task.check_method_text)
        _, segments = find_segments(text)
        for cid, seg_start, seg_text in segments:
            clause = ctx.clauses.get(cid)
            if clause is None or clause.severity not in DEFECT_SEVERITIES:
                continue
            for s in sentences(seg_text):
                if r9_fires(s):
                    local_offset = seg_text.find(s)
                    line = task.line_for_check_method_offset(seg_start + max(local_offset, 0))
                    return (
                        f"R9 verdict-contradiction: {task.label}:{line} {cid}: instructs "
                        f"a pass alongside a defect: {s!r}"
                    )
    return None


# ---------------------------------------------------------------------------
# R10: count vs list.
# ---------------------------------------------------------------------------

WORD2NUM = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
}
NUMBER_TOKEN_RE = re.compile(r"\b(\d+|" + "|".join(WORD2NUM) + r")\b", re.I)


def number_value(tok):
    if tok.isdigit():
        return int(tok)
    return WORD2NUM.get(tok.lower())


# "one" is the one number word that's usually not a number: constitution.md's
# own C-4 text reads "Every one of the 18 rows..."—a false "1" sitting one
# word from a real count ("18") that made R12' fire on the unmutated corpus,
# comparing it against T-006's genuine "Ten of the 18 rows...". Every other
# WORD2NUM entry is unambiguous; only "one" doubles as a pronoun, and only
# behind one of these four words. Filtering just that combination keeps
# genuine counts like T-006's "One row's `started_at` carries fractional
# seconds" intact.
_ONE_IDIOM_GUARD = ("every", "any", "no", "some")


def is_real_number_match(text, match):
    """False for a NUMBER_TOKEN_RE match that's "one" used as a pronoun
    rather than a count, given the text it's matched within."""
    if match.group(1).lower() != "one":
        return True
    before = text[:match.start()].rstrip()
    prev_word = before.rsplit(None, 1)[-1].lower() if before.split() else ""
    return prev_word not in _ONE_IDIOM_GUARD


# A number can sit on a list-introducing line without describing the list
# at all: "the archive for issue 27:" (an id), "see version 2:" (a
# version), "2026-08-08:" (a date). None of those are counts, so a bare
# `#`, "issue", "version", or "v" immediately before the number—or a
# hyphen touching either side, the shape a date or a version range takes
# once NUMBER_TOKEN_RE has split it into separate digit runs—rules a
# candidate out before it's ever compared against the list length.
_COUNT_EXCLUDE_WORDS = ("issue", "version", "v")


def _is_excluded_count_context(text, match):
    start, end = match.start(), match.end()
    if start > 0 and text[start - 1] in "#-":
        return True
    if end < len(text) and text[end] == "-":
        return True
    before = text[:start].rstrip()
    prev_word = before.rsplit(None, 1)[-1].lower().strip(".,;:()") if before.split() else ""
    return prev_word in _COUNT_EXCLUDE_WORDS


# The other half of the fix: a real count word sits right before the noun
# it's counting ("four findings", "3 archives"), so require that shape
# instead of just grabbing whichever number happens to be last on the
# line—T-006's "for issue 27" repro showed the last number is often
# something else's id, not the list's count, and "record four findings,
# each verified against all 3 archives" showed the reverse: the true count
# ("four") sits earlier, with an unrelated number ("3", agreeing with the
# list by coincidence) sitting last.
#
# The noun doesn't have to be the very next token (#193). "Four further
# rules constrain how:" is caught exactly like "Four rules constrain
# how:"—one or more modifiers may sit between the count and the plural
# noun it governs. This walks forward over whatever words are there
# without ever classifying them: no fixed adjective list, no er/ly/ing/ed
# suffix gate, because either one is exactly what a modifier invented at
# run time defeats. It only ever asks the same question the strict
# version asked of the single word right after the count—does THIS word
# end in "s"—repeated a bounded number of times, so a number elsewhere in
# the sentence is never credited with governing a plural noun it has
# nothing to do with.
_MODIFIER_WORD_RE = re.compile(r"[A-Za-z][A-Za-z-]*")
_MAX_GOVERNING_WORDS = 4


def _governs_plural_noun(text, match):
    tail = text[match.end():]
    for _ in range(_MAX_GOVERNING_WORDS):
        tail = tail.lstrip()
        m = _MODIFIER_WORD_RE.match(tail)
        if not m:
            return False
        word = m.group(0)
        if word.endswith("s"):
            return True
        tail = tail[m.end():]
    return False


LIST_ITEM_RE = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+")
FENCE_LINE_RE = re.compile(r"^\s*```")
BLOCKQUOTE_LINE_RE = re.compile(r"^\s*>")
TABLE_ROW_RE = re.compile(r"^\s*\|")
TABLE_SEP_RE = re.compile(r"^\s*\|?[\s:|-]+\|[\s:|-]+\|?\s*$")


def find_r10_violation(text, line_of, label):
    lines = text.split("\n")
    offsets = []
    pos = 0
    for l in lines:
        offsets.append(pos)
        pos += len(l) + 1
    n = len(lines)
    in_fence = False
    i = 0
    while i < n:
        raw = lines[i]
        if FENCE_LINE_RE.match(raw):
            in_fence = not in_fence
            i += 1
            continue
        if in_fence or BLOCKQUOTE_LINE_RE.match(raw) or TABLE_ROW_RE.match(raw) or LIST_ITEM_RE.match(raw):
            i += 1
            continue
        stripped = raw.rstrip()
        if stripped.endswith(":"):
            j = i + 1
            while j < n and lines[j].strip() == "":
                j += 1
            m0 = LIST_ITEM_RE.match(lines[j]) if j < n else None
            if m0 and not TABLE_SEP_RE.match(lines[j]):
                top_indent = len(m0.group(1))
                count = 0
                k = j
                while k < n:
                    if lines[k].strip() == "":
                        k2 = k + 1
                        while k2 < n and lines[k2].strip() == "":
                            k2 += 1
                        mk2 = LIST_ITEM_RE.match(lines[k2]) if k2 < n else None
                        if mk2 and len(mk2.group(1)) >= top_indent:
                            k = k2
                            continue
                        break
                    mk = LIST_ITEM_RE.match(lines[k])
                    if not mk:
                        break
                    indent = len(mk.group(1))
                    if indent < top_indent:
                        break
                    if indent == top_indent:
                        count += 1
                    k += 1
                candidates = [
                    m for m in NUMBER_TOKEN_RE.finditer(stripped)
                    if is_real_number_match(stripped, m)
                    and not _is_excluded_count_context(stripped, m)
                    and _governs_plural_noun(stripped, m)
                ]
                for m in candidates:
                    tok = m.group(1)
                    val = number_value(tok)
                    if val is not None and val != count:
                        line = line_of(offsets[i])
                        return (
                            f"R10 count-vs-list: {label}:{line} says {tok!r} ({val}) but "
                            f"the following list has {count} item(s)"
                        )
        i += 1
    return None


def rule_R10(ctx):
    for _key, label, text, line_of in gather_prose_regions(ctx):
        msg = find_r10_violation(text, line_of, label)
        if msg:
            return msg
    return None


# ---------------------------------------------------------------------------
# R12': cross-artifact count.
# ---------------------------------------------------------------------------

WORD_RE = re.compile(r"\S+")


def strip_numbers_with_map(text):
    """(stripped_text, index_map)—number tokens deleted outright (not
    blanked), with index_map[i] giving stripped_text[i]'s offset in the
    original. Deletion, not same-length blanking, is what makes this safe:
    "Ten" (3 chars) and "Eleven" (6 chars) blank to runs of different
    length, and SequenceMatcher is free to align the last 3 of Eleven's 6
    blanked characters against all of Ten's 3—a match that starts
    mid-token, with no word boundary left for the backward number scan to
    anchor on. Deleting the token leaves nothing there to partially match:
    the two stripped strings either agree from the word right after the
    number, or they don't."""
    out_chars = []
    index_map = []
    i = 0
    for m in NUMBER_TOKEN_RE.finditer(text):
        while i < m.start():
            out_chars.append(text[i])
            index_map.append(i)
            i += 1
        i = m.end()
    while i < len(text):
        out_chars.append(text[i])
        index_map.append(i)
        i += 1
    return "".join(out_chars), index_map


def nearest_preceding_number(text, offset):
    """The value of the closest number token within 5 words before
    `offset` in `text`, or None. Scans NUMBER_TOKEN_RE matches directly
    (rather than per-word) so `is_real_number_match` sees the real text
    around each candidate, not an isolated word."""
    prefix = text[:offset]
    words = list(WORD_RE.finditer(prefix))
    window_start = words[-5].start() if len(words) >= 5 else 0
    for m in reversed(list(NUMBER_TOKEN_RE.finditer(prefix))):
        if m.start() < window_start:
            break
        if is_real_number_match(prefix, m):
            return number_value(m.group(1))
    return None


# A pair can only reach the match.size >= 60 floor below if it shares a
# common substring at least that long, which necessarily contains a run of
# NGRAM_N consecutive characters identical in both stripped sentences—so
# intersecting each pair's NGRAM_N-character shingle sets can never drop a
# pair that would have fired; it only skips pairs provably capped below 60.
# That's what keeps most pairs out of the SequenceMatcher step entirely.
# Measured on the real #117 corpus (7 tasks, 90 entries after the len>=20
# filter): the unindexed sweep ran 2.88s; indexed, 0.22s—about 13x, and
# candidate-pair count stays well below the O(n^2) ceiling on realistically
# varied prose (a 40-task synthetic corpus of hand-varied sentences: 0.28s;
# dispatch-guard's 15s timeout would have made the unindexed version a
# silent no-op somewhere around a 20-task job). The one case that still
# scales closer to quadratic is highly templated prose—many tasks built
# from the same handful of sentence shapes, sharing >=16-char boilerplate
# runs regardless of subject—which is a stress case this comment names
# rather than a realistic decomposition; even there, 40 templated tasks
# ran in 0.28s and 160 in 3.8s, both comfortably inside a single check.
NGRAM_N = 16


def _shingles(s, n=NGRAM_N):
    if len(s) < n:
        return set()
    return {s[i:i + n] for i in range(len(s) - n + 1)}


def _candidate_pairs(shingle_sets, keys):
    """[(i, j)] with i<j, restricted to entries sharing at least one
    shingle AND belonging to different artifacts—both conditions the
    O(n^2) loop used to check per-pair, checked here while the index is
    built so a same-artifact or shingle-less pair never reaches the
    expensive SequenceMatcher step at all."""
    buckets = {}
    pairs = []
    seen = set()
    for i, grams in enumerate(shingle_sets):
        partners = set()
        for g in grams:
            bucket = buckets.get(g)
            if bucket:
                partners.update(bucket)
            buckets.setdefault(g, []).append(i)
        for j in partners:
            if keys[i] == keys[j]:
                continue
            pair = (j, i) if j < i else (i, j)
            if pair not in seen:
                seen.add(pair)
                pairs.append(pair)
    pairs.sort()
    return pairs


def rule_R12(ctx):
    regions = gather_prose_regions(ctx)
    entries = []  # (region_index, sentence_text, start_offset_in_region_text)
    for ri, (_key, _label, text, _line_of) in enumerate(regions):
        for s in sentences(text):
            if len(s) < 20:
                continue
            start = text.find(s)
            if start >= 0:
                entries.append((ri, s, start))

    # Stripped once per entry (was rebuilt inside the O(n^2) inner loop on
    # every pair before), and again used to build the shingle index that
    # replaces the full pairwise sweep below.
    stripped = [strip_numbers_with_map(s) for _, s, _ in entries]
    keys = [regions[ri][0] for ri, _, _ in entries]
    shingle_sets = [_shingles(ss) for ss, _ in stripped]

    for i, j in _candidate_pairs(shingle_sets, keys):
        ri_a, sa, off_a = entries[i]
        ri_b, sb, off_b = entries[j]
        ssa, map_a = stripped[i]
        ssb, map_b = stripped[j]
        match = difflib.SequenceMatcher(None, ssa, ssb, autojunk=False).find_longest_match(
            0, len(ssa), 0, len(ssb)
        )
        # 60 is a measured floor, not a round number: this corpus's own
        # noise ceiling is 38 (two sentences about DIFFERENT counts that
        # happen to share "record absolute artifact paths under"), and
        # its one real duplicated-count pair shares 93. 60 sits with
        # better than 2x margin over the noise and well under the signal
        #—SequenceMatcher.ratio() has no such gap anywhere (see the
        # module docstring's design notes for the numbers that ruled it out).
        if match.size < 60:
            continue
        orig_a = map_a[match.a] if match.a < len(map_a) else len(sa)
        orig_b = map_b[match.b] if match.b < len(map_b) else len(sb)
        num_a = nearest_preceding_number(sa, orig_a)
        num_b = nearest_preceding_number(sb, orig_b)
        if num_a is None or num_b is None or num_a == num_b:
            continue
        label_a, label_b = regions[ri_a][1], regions[ri_b][1]
        line_a = regions[ri_a][3](off_a + orig_a)
        line_b = regions[ri_b][3](off_b + orig_b)
        excerpt = ssa[match.a:match.a + match.size].strip()
        return (
            f"R12' cross-artifact-count: {label_a}:{line_a} says {num_a} where "
            f"{label_b}:{line_b} says {num_b} for the same restated fact ({excerpt!r})"
        )
    return None


# ---------------------------------------------------------------------------
# Context assembly and rule ordering.
# ---------------------------------------------------------------------------

class Context:
    # weight and trailing_sections default so a direct importer building a
    # Context by hand (the module-scope-load audience above) keeps working;
    # R17 reads a missing weight as its missing-line finding either way.
    def __init__(self, clauses, tasks, weight=None, trailing_sections=(),
                 lint_exceptions=None, malformed_exceptions=()):
        self.clauses = clauses
        self.tasks = tasks
        self.weight = weight
        self.trailing_sections = trailing_sections
        # Defaults empty for the same hand-built-Context audience as weight:
        # no waivers is the ordinary state, and R20 has nothing to check.
        self.lint_exceptions = lint_exceptions or {}
        self.malformed_exceptions = malformed_exceptions


def load_context(state_dir, compose_brief):
    """(Context, None) on success, (None, error) on an infra-level failure—
    a missing constitution, or any task file compose-brief.py itself
    couldn't read."""
    const_path = os.path.join(state_dir, "constitution.md")
    try:
        with open(const_path, encoding="utf-8") as f:
            const_text = f.read()
    except OSError as e:
        return None, f"cannot read {const_path}: {e}"

    clauses = parse_constitution(const_text)
    weight = parse_weight_line(const_text)
    trailing_sections = parse_trailing_sections(const_text)
    lint_exceptions, malformed_exceptions = parse_lint_exceptions(const_text)

    task_paths = sorted(glob.glob(os.path.join(state_dir, "tasks", "*.md")))
    tasks = []
    for p in task_paths:
        task, err = load_task_file(p, compose_brief)
        if err:
            return None, err
        tasks.append(task)

    return Context(clauses, tasks, weight, trailing_sections,
                   lint_exceptions, malformed_exceptions), None


def run_rules(ctx, audit_id, repo_root):
    """(message, class, waived) for the first violation across all rules,
    evaluated in the plan's order—proofs before heuristics—or
    (None, None, waived) if every rule passes.

    `class` is PROOF or HEURISTIC and decides the exit code, so a caller can
    tell a proved defect from a guessed one without reading the prose (#139).
    `waived` lists the rule ids a `**Lint exception**:` line silenced and
    that actually fired, so a pass that depended on a waiver says so instead
    of looking clean.

    A waiver only ever skips a heuristic: R20 runs early and refuses a
    waiver against anything else, so by the time a heuristic consults
    ctx.lint_exceptions here, the ids in it have already been proved
    waivable."""
    regions = citation_regions(ctx)
    steps = (
        lambda: rule_R6(ctx, audit_id),
        lambda: rule_R7(ctx, audit_id),
        lambda: rule_R21(ctx, audit_id),
        lambda: rule_R22(ctx, audit_id),
        lambda: rule_R17(ctx),
        lambda: rule_R18(ctx),
        lambda: rule_R20(ctx),
        lambda: rule_R19(ctx),
        lambda: rule_R15(ctx, audit_id, repo_root),
        lambda: rule_R13(ctx, audit_id),
        lambda: rule_R14(ctx, audit_id),
        lambda: rule_R4(ctx, audit_id),
        lambda: rule_R5(ctx, repo_root),
        lambda: check_citation_rules(regions, repo_root, "R1"),
        lambda: check_citation_rules(regions, repo_root, "R3"),
        lambda: rule_R8(ctx, audit_id),
        lambda: rule_R16(ctx, audit_id),
        lambda: check_citation_rules(regions, repo_root, "R2"),
        lambda: rule_R9(ctx),
        lambda: rule_R10(ctx),
        lambda: rule_R12(ctx),
    )
    waived = []
    for step in steps:
        msg = step()
        if not msg:
            continue
        cls = rule_class_of(msg)
        rid = rule_id_of(msg)
        if cls == HEURISTIC and rid in ctx.lint_exceptions:
            # Skip and keep going rather than return clean: a later rule may
            # still have a real finding, and the waiver was for this rule
            # only. Recorded so the pass line can name it—a silenced rule
            # nobody can see is the failure mode this replaced.
            waived.append(rid)
            continue
        return msg, cls, waived
    return None, None, waived


# ---------------------------------------------------------------------------
# self-test
# ---------------------------------------------------------------------------

_FIXTURE_CHECK_BUILD_SH = """#!/usr/bin/env bash
set -uo pipefail
bash -c "$*"
exit $?
"""

_FIXTURE_MYTOOL_PY = """#!/usr/bin/env python3
print("ok")
"""

_FIXTURE_HELPER_PY = """# helper module



def other():
def helper(): return True

# padding
# padding
# padding
"""

_FIXTURE_NOTES_MD = """# Notes

- an ordinary line here for citations

## A heading
body
"""

_FIXTURE_CONSTITUTION = """# Constitution: self-test fixture

**Job weight**: light, two clauses, both through existing checks

### C-1: first clause
- **text**: The build must stay green.
- **check**: .agent-guild/scripts/check-build.sh 'echo ok'
- **severity**: major
- **failing example**: n/a

### C-2: second clause
- **text**: The helper function must match its documented contract.
- **check**: checker-judgment: read lib/helper.py and confirm it matches.
- **severity**: major
- **failing example**: n/a
"""

_FIXTURE_T001 = """---
id: T-001
title: First task
spec: .agent-guild/state/spec.md#one
clauses: [C-1]
executor: worker-standard
executor_model: sonnet
checker: checker-deterministic
check_method: >-
  C-1: .agent-guild/scripts/check-build.sh 'echo ok'
status: pending
retries: 0
max_retries: 2
deps: []
escalations: []
artifacts:
  - .agent-guild/scripts/mytool.py
---

## Spec excerpt

The build must stay green.

See `lib/helper.py:6` for the reference implementation (`def helper(): return True`).

Three things matter here:

- correctness
- clarity
- speed

Ten widgets ship broken from the factory floor before anyone notices the defect in the packaging line.
"""

_FIXTURE_T002 = """---
id: T-002
title: Second task
spec: .agent-guild/state/spec.md#two
clauses: [C-2]
executor: worker-standard
executor_model: sonnet
checker: checker-judgment
check_method: >-
  C-2: checker-judgment: read lib/helper.py and confirm it matches. An
  absent fact must never pass with a major finding.
status: pending
retries: 0
max_retries: 2
deps: [T-001]
escalations: []
artifacts:
  - plugin/generated.md
---

## Spec excerpt

Reads and confirms the helper.

Ten widgets ship broken from the factory floor before anyone notices the defect in the packaging line, according to the audit.
"""


def _fixture_files(mutation=None):
    """The base fixture, or the base fixture with one substring replaced—
    every mutation changes exactly one thing, so a fixture that's meant to
    fail only R9 (say) doesn't happen to also fail R1 first and mask it."""
    files = {
        ".agent-guild/scripts/check-build.sh": _FIXTURE_CHECK_BUILD_SH,
        ".agent-guild/scripts/mytool.py": _FIXTURE_MYTOOL_PY,
        "lib/helper.py": _FIXTURE_HELPER_PY,
        "lib/notes.md": _FIXTURE_NOTES_MD,
        ".agent-guild/state/constitution.md": _FIXTURE_CONSTITUTION,
        ".agent-guild/state/tasks/T-001.md": _FIXTURE_T001,
        ".agent-guild/state/tasks/T-002.md": _FIXTURE_T002,
    }
    if mutation is not None:
        path, find, replace = mutation
        assert find in files[path], f"self-test fixture bug: {find!r} not found in {path}"
        files[path] = files[path].replace(find, replace, 1)
    return files


def _write_fixture(root, mutation=None):
    for rel, content in _fixture_files(mutation).items():
        full = os.path.join(root, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "w", encoding="utf-8") as f:
            f.write(content)
    for rel in (".agent-guild/scripts/check-build.sh", ".agent-guild/scripts/mytool.py"):
        p = os.path.join(root, rel)
        os.chmod(p, os.stat(p).st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


# (name, mutation, expect_ok, needle-required-in-stderr-on-failure)
_SELF_TEST_CASES = [
    ("valid base fixture", None, True, None),
    (
        "R6 clauses: id not in constitution",
        (".agent-guild/state/tasks/T-002.md", "clauses: [C-2]", "clauses: [C-3]"),
        False, "R6",
    ),
    (
        "R7 dep on a nonexistent task",
        (".agent-guild/state/tasks/T-002.md", "deps: [T-001]", "deps: [T-999]"),
        False, "R7",
    ),
    (
        "R4 check_method segment neither script nor judgment",
        (
            ".agent-guild/state/tasks/T-001.md",
            "C-1: .agent-guild/scripts/check-build.sh 'echo ok'",
            "C-1: bash -c 'echo ok'",
        ),
        False, "R4",
    ),
    (
        "R5 check_method script does not exist",
        (
            ".agent-guild/state/tasks/T-001.md",
            "C-1: .agent-guild/scripts/check-build.sh 'echo ok'",
            "C-1: .agent-guild/scripts/does-not-exist.sh 'echo ok'",
        ),
        False, "R5",
    ),
    (
        "R1 citation line past end of file",
        (".agent-guild/state/tasks/T-001.md", "lib/helper.py:6", "lib/helper.py:999"),
        False, "R1",
    ),
    (
        "R3 citation lands on a heading",
        (".agent-guild/state/tasks/T-001.md", "lib/helper.py:6", "lib/notes.md:5"),
        False, "R3",
    ),
    (
        "R8 no generated-tree task downstream of its inputs",
        (".agent-guild/state/tasks/T-002.md", "deps: [T-001]", "deps: []"),
        False, "R8",
    ),
    (
        "R2 citation line doesn't carry the quoted code",
        (".agent-guild/state/tasks/T-001.md", "lib/helper.py:6", "lib/helper.py:1"),
        False, "R2",
    ),
    (
        "R9 pass instructed alongside a major finding, no veto",
        (".agent-guild/state/tasks/T-002.md", "must never pass", "may still pass"),
        False, "R9",
    ),
    (
        "R10 count word disagrees with its list",
        (".agent-guild/state/tasks/T-001.md", "Three things matter here:", "Four things matter here:"),
        False, "R10",
    ),
    (
        "R12' the same restated fact carries two different counts",
        (".agent-guild/state/tasks/T-001.md", "Ten widgets ship broken", "Eleven widgets ship broken"),
        False, "R12",
    ),
]


def self_test():
    failures = []
    seen_classes = set()

    # Every rule run_rules dispatches needs a RULE_CLASS entry. Without this,
    # a rule added later falls to rule_class_of's PROOF default and its class
    # is a guess the table never made—which is the single-place-declaration
    # this issue exists to establish (#139).
    declared = set(RULE_CLASS)
    for rid in ("R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10",
                "R12", "R13", "R14", "R15", "R16", "R17", "R18", "R19", "R20",
                "R21", "R22"):
        if rid not in declared:
            failures.append(f"RULE_CLASS is missing an entry for {rid}")

    for name, mutation, expect_ok, needle in _SELF_TEST_CASES:
        with tempfile.TemporaryDirectory(prefix="check-job-spec-fixture-") as root:
            _write_fixture(root, mutation)
            proc = subprocess.run(
                [sys.executable, __file__, "--audit-id", "DEC-audit"],
                cwd=root, capture_output=True, text=True,
            )
            got_ok = proc.returncode == 0
            combined = proc.stdout + proc.stderr

            if got_ok != expect_ok:
                failures.append(
                    f"{name}: expected {'pass' if expect_ok else 'fail'}, got exit "
                    f"{proc.returncode} (stdout={proc.stdout!r} stderr={proc.stderr!r})"
                )
                continue

            if not expect_ok:
                if not combined.strip():
                    failures.append(f"{name}: failed with NO diagnostic message at all")
                    continue
                if "job-spec:" not in combined:
                    failures.append(f"{name}: diagnostic missing the 'job-spec:' prefix (got {combined!r})")
                    continue
                if needle not in combined:
                    failures.append(
                        f"{name}: diagnostic did not name the expected rule "
                        f"(expected {needle!r} in {combined!r})"
                    )
                    continue

                # The class the fixture's own rule declares, checked against
                # both places a caller can read it: the exit code and the
                # `job-spec: ` line. Derived from the needle rather than
                # listed per case, so every fixture asserts its class and a
                # rule that changes class can't pass by nobody re-listing it.
                want = RULE_CLASS.get(rule_id_of(needle))
                if want is None:
                    failures.append(
                        f"{name}: needle {needle!r} does not start with a rule "
                        "id RULE_CLASS knows, so its class cannot be checked"
                    )
                    continue
                seen_classes.add(want)
                want_code = 4 if want == HEURISTIC else 1
                if proc.returncode != want_code:
                    failures.append(
                        f"{name}: {rule_id_of(needle)} is a {want}, expected exit "
                        f"{want_code}, got {proc.returncode}"
                    )
                if f"[{want}]" not in combined:
                    failures.append(
                        f"{name}: diagnostic did not carry the [{want}] class tag "
                        f"(got {combined!r})"
                    )
                if want == HEURISTIC and "**Lint exception**" not in combined:
                    failures.append(
                        f"{name}: a heuristic block must name the waiver as its "
                        f"recourse (got {combined!r})"
                    )

    for want in (PROOF, HEURISTIC):
        if want not in seen_classes:
            failures.append(
                f"no self-test fixture exercises a {want} rule, so the emitted "
                f"class for {want} is unasserted"
            )

    if failures:
        sys.stderr.write("SELF-TEST FAILED:\n")
        for m in failures:
            sys.stderr.write(f"  - {m}\n")
        return 1

    print(f"OK: self-test passed ({len(_SELF_TEST_CASES)} fixtures)")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="Lint a guild job's constitution and task decomposition before an auditor is dispatched."
    )
    ap.add_argument("state", nargs="?", default=".agent-guild/state", help="path to the state directory")
    ap.add_argument("--repo-root", default=None, help="root citations and scripts resolve against (default: cwd)")
    ap.add_argument("--audit-id", choices=["CON-audit", "DEC-audit"], default="DEC-audit")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    if not os.path.isdir(args.state):
        sys.stderr.write(f"job-spec: state directory not found: {args.state}\n")
        return 3

    try:
        compose_brief = _load_module("compose_brief_cjs", "compose-brief.py")
        validate_verdict = _load_module("validate_verdict_cjs", "validate-verdict.py")
        diff_scope = _load_module("check_diff_scope_cjs", "check-diff-scope.py")
    except Exception as e:
        sys.stderr.write(f"job-spec: cannot import a kit script this linter depends on: {e}\n")
        return 3

    global DEFECT_SEVERITIES, paths_overlap, owns_entry_problem
    DEFECT_SEVERITIES = validate_verdict.DEFECT_SEVERITIES
    paths_overlap = diff_scope.paths_overlap
    owns_entry_problem = diff_scope.owns_entry_problem

    ctx, err = load_context(args.state, compose_brief)
    if err:
        sys.stderr.write(f"job-spec: {err}\n")
        return 3

    repo_root = args.repo_root or os.getcwd()
    msg, cls, waived = run_rules(ctx, args.audit_id, repo_root)
    if msg:
        sys.stderr.write(f"job-spec: [{cls}] {msg}\n")
        if cls == HEURISTIC:
            sys.stderr.write(
                f"job-spec: {rule_id_of(msg)} infers this defect rather than "
                "proving it. If it misread the paperwork, record a "
                f"`**Lint exception**: {rule_id_of(msg)} — <why>` line in the "
                "constitution's preamble and re-run. Do not reach for "
                "state/PAUSED, which stands down every gate in the system "
                "rather than this one rule.\n"
            )
        return 4 if cls == HEURISTIC else 1

    note = f" ({', '.join(waived)} waived)" if waived else ""
    print(f"OK: {args.state} passes check-job-spec ({args.audit_id}){note}")
    if waived:
        # Also on stderr, because a pass that leaned on a waiver is the one
        # thing about this run a reader must not miss, and stdout is the
        # channel this whole design is built around nobody reading:
        # dispatch-guard captures both and forwards only stderr. A silenced
        # rule nobody can see is what the waiver was introduced to replace,
        # so it would be a poor joke to announce it where the gate is deaf.
        sys.stderr.write(
            f"job-spec: passed with {', '.join(waived)} waived by a "
            "**Lint exception** line in constitution.md. That rule did fire; "
            "a recorded reason is why it isn't blocking.\n"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
