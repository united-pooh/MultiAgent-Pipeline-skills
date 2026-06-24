# Pipeline Stages

This file is the detailed phase guide for the active multi-agent production
pipeline. The main `SKILL.md` keeps only the map and hard gates.

## Global 6-Slot Worker Pool

The orchestrator maintains one global pool of 6 subagent slots for the active
asynchronous stages:

- Execution
- Validation
- Tree Rubrics
- Tree Grading
- QA

Every spawned subagent in those stages consumes one slot until it finishes.
Tree Grading consumes 3 slots by default because the group receives 3
independent graders. Start Tree Grading only when all 3 slots are free; do not
spawn a partial grader set or downgrade the grader count unless the user
explicitly asks for a cheaper pass.

Groups advance independently through the review chain. When a group finishes
Execution and merges successfully, it may immediately enter Validation if a
slot is available, even while other groups from the same execution wave are
still running. The same early-continuation rule applies from Validation to Tree
Rubrics, from Tree Rubrics to Tree Grading, and from Tree Grading to QA.

Dispatch waves still express dependency readiness and the maximum fanout for
new Execution groups. They are not barriers for downstream review stages once a
group has produced a merged proposal.

## Global Write Authority

- The orchestrator/main agent must never modify code or repo files directly.
- The orchestrator may read code, schedule stages, write pipeline workspace bookkeeping,
  persist canonical pipeline artifacts, validate outputs, aggregate feedback,
  and report status.
- File/code mutations are only allowed in Execution-stage worker subagents.
- Validation, QA, Doc, Tree Rubrics, Tree Grading, Review, Final Assessment,
  and every other non-Execution stage are read-only. They must record failures
  or feedback and send the repair request back to Execution.

## 0. Brainstorming

Brainstorming is orchestrator-local. Do not spawn a subagent.
Use the repo-owned internal methodology at
`references/methodologies/brainstorming.md`.

Goal:

- Explore project context, relevant files, and recent git history when useful.
- Ask focused questions only when the answer materially changes scope or
  acceptance criteria.
- Propose viable approaches with tradeoffs when the design choice is still open.
- Write the approved or user-implied design to `.pipeline-workspace/design.md`.

If the user asks to brainstorm or choose a design, ask for approval before
proceeding. If the user supplied a concrete task and explicitly asked for
execution, record that request as the approved design and continue.

## 1. Spec

Spawn the Spec subagent with `agents/spec.md` and `references/contracts.md`.
Pass `design.md` inline.
Provide the internal methodology context from
`references/methodologies/brainstorming.md` and
`references/methodologies/superpowers.md`, or the matching methodology reference files.

Outputs:

- `spec.json` for downstream stages
- `spec.md` in Chinese for human review

Rules:

- Record explicit assumptions instead of stopping on every ambiguity.
- Keep scope tight and acceptance criteria testable.
- Record `applied_skills: []`.
- Do not rely on external methodology packages.
- Use only brainstorming/specification discipline in this stage.

## 2. Plan

Spawn the Plan subagent with `spec.json`.
Provide the internal methodology context from
`references/methodologies/superpowers.md`.

Output:

- `plan.json`

Rules:

- Break work into phases, task order, dependencies, and risks.
- Keep tasks implementation-sized.
- Prefer task boundaries that preserve future worker independence.
- Record `applied_skills: []`.
- Do not rely on external methodology packages.

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
- Each execution wave contains at most 6 groups.
- Maximize safe concurrency up to 6 groups per wave.
- If more than 6 independent components are ready in one dependency layer,
  merge excess components by affinity, such as module proximity, shared feature
  area, runtime surface, test surface, or skill routing.
- Never split overlapping or coupled work merely to fill all 6 slots.
- Derive `worker_groups[].required_skills` only from
  `architecture.json.proposed_changes[].concerns`.
- Map `frontend_design` to `ce-frontend-design`.
- Emit the fixed integration strategy from `references/contracts.md`.
- Explain why if no safe parallelism can be extracted.

## 5. Execution

For each execution wave, spawn Execution `worker` agents for ready groups while
respecting the global 6-slot pool.

Rules:

- The worker owns only its declared files plus adjacent tests/docs required to
  complete the task.
- The worker is not alone in the codebase and must not revert unrelated edits.
- Return a group-scoped `execution-report.json`.
- If `required_skills` contains `ce-frontend-design`, apply the internal
  frontend-design capability guidance from
  `references/methodologies/frontend-design.md`, record the label in
  `applied_skills`, and require `frontend_design_summary`.
- A same-group retry may add related local goals only inside the existing group
  ownership or adjacent tests/docs.
- If retry feedback requires unowned files, cross-group ownership changes, or a
  different split, the worker must return `status = "blocked"` with a blocker
  string beginning `REPLAN_REQUIRED:` so the orchestrator can re-dispatch.

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

Merge is orchestrator-local for decisions, validation, and bookkeeping. Do not
spawn a subagent.

Rules:

- Do not directly edit code or repo files during Merge.
- Compare each Execution proposal against `{base_ref, proposal_ref, current
  main workspace}` and record the integration decision.
- If integration requires file changes outside an existing Execution proposal,
  route the group through an Execution sync pass or re-dispatch.
- Write one `merge-report.json` per group execution pass.
- Use conservative three-way merge semantics.
- `merged`: merge succeeded.
- `noop`: proposal introduces no effective change.
- `conflicted`: merge is not safe. Write the report, preserve the workspace,
  and pause for human input.
- Human conflict resolution produces `conflict-resolution.json`.
- Resume from Merge after conflict resolution. Do not rerun Dispatch.

## 7. Validation

Run Validation before Tree Rubrics for every successfully merged worker group.

Rules:

- Spawn a Validation `worker` with the group's execution, complexity, and merge
  reports plus repo root.
- Detect language and run the read-only check layer in `agents/validation.md`.
- Write `validation-report.json`.
- Failed or errored validation routes the group back to Execution as a
  same-group retry unless the required fix needs re-dispatch.
- Passed or skipped validation continues to Tree Rubrics.
- Validation must not run fix-layer commands or edit files. Execution retry
  owns all repair work.
- A group does not wait for other groups in its execution wave before entering
  Validation when a pool slot is free.

## 8. Tree Rubrics

After Validation passes or is skipped, run the Tree Rubrics sequence for the
worker group.

Stages:

- Tree Classification: `agents/tree-classification.md` produces
  `classification.json`.
- Tree Rubric Generation: `agents/tree-rubric-generation.md` produces
  `tree_rubrics.json`.
- Tree Rubric Verification: `agents/tree-rubric-verification.md` produces
  `validation_result.json`.
- Tree Rubric Refinement: `agents/tree-rubric-refinement.md` produces
  `tree_rubrics_refined.json`.

Rules:

- The rubric must stay tied to the worker group's spec and final output files.
- Verification checks rubric quality, not implementation quality.
- Refinement incorporates verification feedback before grading starts.
- Run this sequence for a group as soon as its Validation stage passes or is
  skipped and a pool slot is available.

## 9. Final Output Files And Tree Grading

The orchestrator locally builds `final-output-files.json` from the group's
`changed_files` and owned files, then spawns 3 independent Tree Grading
subagents with `agents/tree-grading.md`.

Rules:

- Graders evaluate only `spec`, `tree_rubrics_refined.json`, and
  `final-output-files.json`.
- Graders must not grade process logs, agent behavior, or intermediate
  execution history.
- The orchestrator aggregates grader outputs into `tree_grading_feedback.json`.
- A group passes grading when `weighted_score >= 0.80` and all depth-1 rubric
  nodes pass.
- Failed grading routes the group back to Execution with feedback.
- Tree Grading consumes 3 slots by default. Wait until 3 pool slots are free,
  then spawn the grader trio together before waiting on their results.

## 10. QA

After Tree Grading passes, spawn a QA `worker` for the group.

Rules:

- QA validates runtime or scenario behavior that command Validation and Tree
  Grading cannot cover.
- Write `qa-report.json`.
- QA is read-only with respect to integrated source changes.
- A group is cleanup-eligible only after Tree Grading and QA both pass.
- QA starts for a group as soon as that group passes Tree Grading and a pool
  slot is available.

## 11. Documentation

After every worker group passes Validation, Tree Grading, and QA, spawn a Doc
worker.

Rules:

- Doc is read-only and audits only the documentation that should change.
- Update `CHANGELOG.md` when the repository has one or the task requires release
  notes by sending the required documentation update back to Execution.
- Return `doc-report.json`.
- If docs are missing or stale, return `status = "changes_required"` with the
  affected docs in `updated_files` and notes explaining the required Execution
  repair.
- The orchestrator reviews doc feedback before final assessment.
- If `gitPolicy` is enabled, the orchestrator may commit the integrated
  Execution-produced documentation files with a `docs(pipeline): :memo: ...`
  Chinese Conventional Commit message. Push is controlled by the Doc phase
  policy.

## 12. Final Assessment

Spawn Final Assessment with the complete artifact set.

Rules:

- Evaluate the delivered feature across all worker groups.
- Write `final-assessment.json`.
- Decide acceptance or earliest restart point.
- Give definite readability and complexity conclusions.
- Record `skill_usage_summary`.
- Use `restart_from = "merge"` when the blocking issue originates in merge or
  conflict resolution rather than implementation.

## 13. Cleanup

Cleanup is orchestrator-local. Do not spawn a subagent.

Rules:

- On accept, write `.pipeline-last-run-summary.json`, then delete
  `.pipeline-workspace/`.
- If `gitPolicy` is enabled, publish the accepted final worktree after cleanup
  with a gitmoji + Conventional Commits Chinese message.
- On reject or pause, preserve `.pipeline-workspace/`.
- On reject or pause, do not auto commit or push.
- Never delete integrated code, tests, docs, release notes, or user-retained
  files as part of cleanup.

## Legacy Review

`agents/review.md` and `references/pre-rubric.md` remain for compatibility with
older PRE/EME runs. Do not use them as the default quality gate in the active
pipeline.
