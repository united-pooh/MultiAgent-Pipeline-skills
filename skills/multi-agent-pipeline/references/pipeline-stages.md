# Pipeline Stages

This file is the detailed phase guide for the multi-agent production pipeline.
The main `SKILL.md` keeps only the map and hard gates.

## 0. Brainstorming

Brainstorming is orchestrator-local. Do not spawn a subagent.

Goal:

- Explore project context, relevant files, and recent git history when useful.
- Ask focused questions only when the answer materially changes scope or
  acceptance criteria.
- Propose viable approaches with tradeoffs when the design choice is still open.
- Write the approved or user-implied design to `.pipeline-workspace/design.md`.

`design.md` format:

```markdown
## Objective
[What is being built and why]

## Chosen Approach
[Chosen approach and brief rationale]

## Constraints
[Technical or business constraints]

## Success Criteria
[Concrete, testable done criteria]
```

If the user asks to brainstorm or choose a design, ask for approval before
proceeding. If the user already supplied a concrete task and explicitly asked
for execution, record that request as the approved design and continue.

## 1. Spec

Spawn the Spec subagent with `agents/spec.md` and `references/contracts.md`.
Pass `design.md` inline.

Outputs:

- `spec.json` for downstream stages
- `spec.md` in Chinese for human review

Rules:

- Record explicit assumptions instead of stopping on every ambiguity.
- Keep scope tight and acceptance criteria testable.
- Record `applied_skills: ["superpowers"]`.
- Attach `superpowers` and restrict it to brainstorming/planning discipline.
- Do not allow build, TDD, commit, or finish-branch behaviors from
  `superpowers` in this stage.

## 2. Plan

Spawn the Plan subagent with `spec.json`.

Output:

- `plan.json`

Rules:

- Break work into phases, task order, dependencies, and risks.
- Keep tasks implementation-sized.
- Prefer task boundaries that preserve future worker independence.
- Record `applied_skills: ["superpowers"]`.
- Attach `superpowers` for planning discipline only.

## 3. Architecture

Spawn the Architecture subagent with `spec.json` and `plan.json`.

Output:

- `architecture.json`

Rules:

- Inspect the actual codebase.
- Decide `incremental`, `refactor`, or `hybrid`.
- Tag each `proposed_changes[]` entry with routing `concerns`.
- Use `frontend_design` for changes affecting layout, components, styling,
  themes, animation, interaction copy, responsive layout, visual hierarchy,
  design-system consistency, or UI accessibility.
- If `feasibility` is `infeasible`, halt and show `infeasibility_reason` and
  `rollback_notes`.

## 4. Dispatch

Spawn the Dispatch subagent with `spec.json`, `plan.json`, and
`architecture.json`.

Output:

- `dispatch.json`

Rules:

- Partition tasks into worker groups with explicit file ownership.
- Arrange groups into dependency-respecting execution waves.
- Derive `worker_groups[].required_skills` only from
  `architecture.json.proposed_changes[].concerns`.
- Map `frontend_design` to `ce-frontend-design`.
- Emit the fixed integration strategy from `references/contracts.md`.
- Explain why if no safe parallelism can be extracted.

## 5. Execution

For each execution wave, spawn one Execution `worker` per ready group.

Inputs:

- `spec.json`
- `plan.json`
- `architecture.json`
- the assigned worker group
- current `base_ref`
- latest group-specific `review_feedback.json` on retries

Rules:

- The worker owns only its declared files plus adjacent tests/docs required to
  complete the task.
- The worker is not alone in the codebase and must not revert unrelated edits.
- Return a group-scoped `execution-report.json`.
- If `required_skills` contains `ce-frontend-design`, attach that skill and
  require `frontend_design_summary`.

## 5a. Complexity Hook

Immediately after successful Execution, the orchestrator runs the local Python
cognitive complexity hook against `execution-report.json.changed_files`, reading
from the worker proposal path before merge.

Rules:

- Use `scripts/better_highlights_cognitive_repro.py`.
- Write one `complexity-report.json` per group and iteration under
  `.pipeline-workspace/complexity/`.
- Non-Python changed files are skipped, not failed.
- Analyzer errors are preserved and force `readability_conclusion = "low"` and
  `complexity_conclusion = "high"` for downstream manual review.

## 6. Merge

Merge is orchestrator-local. Do not spawn a subagent.

Rules:

- Merge each proposal into the main workspace using `{base_ref, proposal_ref,
  current main workspace}`.
- Write one `merge-report.json` per group execution pass.
- Use conservative three-way merge semantics.
- `merged`: merge succeeded.
- `noop`: proposal introduces no effective change.
- `conflicted`: merge is not safe. Write the report, preserve the workspace,
  and pause for human input.
- Human conflict resolution produces `conflict-resolution.json`.
- Resume from Merge after conflict resolution. Do not rerun Dispatch.

## 7. Validation And Review

Run Validation before Review for every successfully merged worker group.

Validation:

- Spawn a Validation `worker` with the group's execution, complexity, and merge
  reports plus repo root.
- Detect language and run the fix/check layers in `agents/validation.md`.
- Write `validation-report.json`.
- Failed or errored validation routes back to Execution.
- Passed or skipped validation continues to Review.
- Any fix-layer file edits become part of the current merged main-workspace
  result before Review.

Review:

- Evaluate the merged main-workspace result, not the worker fork directly.
- Treat `complexity-report.json` as evidence for Code Quality and Architecture
  Compliance.
- Default `EME`: spawn three independent reviewers and aggregate by PRE
  dimension majority vote.
- `PRE`: spawn one reviewer and convert the single result directly into
  `review_feedback.json`.
- `warning` counts as pass for majority voting; preserve warnings even when the
  verdict is pass.
- Failed dimensions route the group back to Execution.

## 8. QA

After Review passes, spawn a QA `worker` for the group.

Rules:

- QA validates runtime or scenario behavior that command Validation and static
  Review cannot cover.
- Write `qa-report.json`.
- QA is read-only with respect to integrated source changes.
- A group is cleanup-eligible only after Review and QA both pass.

## 9. Documentation

After every worker group passes Validation, Review, and QA, spawn a Doc worker.

Rules:

- Update only docs that actually changed.
- Update `CHANGELOG.md` when the repository has one or the task requires release
  notes.
- Return `doc-report.json`.
- The orchestrator reviews and integrates doc changes before final assessment.

## 10. Final Assessment

Spawn Final Assessment with the complete artifact set.

Rules:

- Evaluate the delivered feature across all worker groups.
- Write `final-assessment.json`.
- Decide acceptance or earliest restart point.
- Give definite readability and complexity conclusions.
- Record `skill_usage_summary`.
- Use `restart_from = "merge"` when the blocking issue originates in merge or
  conflict resolution rather than implementation.

## 11. Cleanup

Cleanup is orchestrator-local. Do not spawn a subagent.

Rules:

- On accept, write `.pipeline-last-run-summary.json`, then delete
  `.pipeline-workspace/`.
- On reject or pause, preserve `.pipeline-workspace/`.
- Never delete integrated code, tests, docs, release notes, or user-retained
  files as part of cleanup.

