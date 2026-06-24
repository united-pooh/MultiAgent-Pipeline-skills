# Orchestration Rules

Read this file when constructing prompts, validating artifacts, aggregating
Tree Grading, merging proposals, or cleaning up a run.

## Prompt Construction

For each spawned stage:

- Read the stage instructions from `agents/<stage>.md`.
- Read only the specific contract or rubric files that stage needs.
- Read the current stage's `templates/artifacts/<artifact>.json` as the nearby
  JSON skeleton. Use it to keep output structure stable under tight context.
- Pass artifact contents or exact file paths explicitly.
- For routed Execution capability labels, pass the exact label values from
  `worker_group.required_skills`.
- Spec and Plan prompts must use the repo-owned internal methodology references
  under `references/methodologies/` and must not require external methodology
  packages.
- Execution prompts must include `references/methodologies/frontend-design.md`
  whenever `worker_group.required_skills` contains `ce-frontend-design`.
- When this skill was explicitly invoked by the user, prompts may treat
  subagent delegation and safe parallel work as authorized within host
  constraints.
- Tell subagents to return the exact fenced block format required by the stage
  prompt.
- Execution prompts must pass the assigned `worker_group`, `base_ref`, and any
  retry feedback explicitly. Tell retry workers to return a `REPLAN_REQUIRED:`
  blocker when the fix needs unowned files or changed group ownership.

For copy-ready prompt scaffolds, use `references/orchestrator-prompts.md`.

## Artifact Discipline

- The orchestrator is the source of truth for artifact files in
  `.pipeline-workspace/`.
- Parse subagent JSON, materialize it against the stage artifact template, and
  validate required fields before writing canonical artifacts.
- Templates may fill deterministic fields such as `version`, refs, `group_id`,
  `iteration`, fixed dimensions, and fixed integration strategy. They must not
  fabricate requirements, tasks, grading evidence, test results, or final
  acceptance decisions.
- If a subagent response is malformed, fix the prompt and rerun that stage
  instead of hand-waving the artifact.
- Write artifacts even when the corresponding stage also changed files.
- Artifact persistence and code/doc integration are separate responsibilities.
- The orchestrator writes `merge-report.json`, `conflict-resolution.json`,
  `final-output-files.json`, `tree_grading_feedback.json`, and
  `.pipeline-last-run-summary.json` locally.
- Cleanup eligibility is derived locally after Validation, Tree Grading, and QA
  pass.

## Global 6-Slot Subagent Pool

The orchestrator runs one global pool of 6 subagent slots across Execution,
Validation, Tree Rubrics, Tree Grading, and QA.

- Every spawned subagent in those stages consumes one slot until it finishes.
- Dispatch may fan out at most 6 Execution groups in a wave and should maximize
  safe concurrency up to that limit.
- Groups continue independently after merge. A finished group may immediately
  advance to Validation, Tree Rubrics, Tree Grading, or QA when the next stage's
  dependencies are satisfied and enough slots are free.
- Do not wait for the rest of an execution wave before starting downstream
  review stages for a group that is already ready.
- Tree Grading consumes 3 slots by default. Start it only when 3 slots are
  available, then spawn the grader trio together.
- If fewer than 3 slots are available for Tree Grading, run other ready
  one-slot stages or wait; do not spawn a partial grader set.

## Tree Grading Aggregation

The orchestrator merges grader outputs locally:

- Use exactly 3 graders by default.
- Each rubric node receives a majority-vote score.
- Depth 1 nodes have weight 1, depth 2 nodes weight 2, and depth 3+ nodes
  weight 3.
- If a shallow node fails, deeper nodes in the same branch have effective score
  0.
- A group passes when `weighted_score >= 0.80` and all depth-1 nodes pass.
- Preserve grader IDs, per-node evidence, and dissenting notes in
  `tree_grading_feedback.json`.

Operational note: Tree Grading is the most likely point to hit thread limits
because it consumes three slots at once. Wait until 3 slots are free, close
finished stage agents, and then spawn the grader trio. If a grader spawn fails
from temporary thread pressure, close finished idle agents and retry the missing
grader instead of silently downgrading the grader count.

## File Ownership And Worker Routing

When spawning `worker` agents:

- Assign exact file ownership from
  `dispatch.json.worker_groups[].owned_files`.
- Pass `required_skills` exactly as derived by Dispatch.
- Tell the worker it may also touch directly adjacent tests or docs needed to
  complete the task.
- Tell the worker it is not alone in the codebase and must not revert edits it
  did not make.
- On retries, tell the worker it may add related same-group local goals only
  inside its ownership boundary or adjacent tests/docs.
- If a fix requires unowned files, cross-group ownership changes, or a new
  worker split, the worker must return `status = "blocked"` with the first
  blocker beginning `REPLAN_REQUIRED:` so the orchestrator can restart at
  Dispatch.
- Treat uploaded worker changes as proposals until merged into the main
  workspace.

## Merge Discipline

- Record one base snapshot reference per group execution pass before the worker
  starts.
- Use conservative three-way merge / diff3 semantics for text-like files.
- Treat JSON arrays, YAML arrays, binary files, spreadsheets, presentations, and
  other non-text outputs as conflict-prone unless a safe format-specific rule
  exists.
- Re-running merge with the same `{base_ref, mainline_ref, proposal_ref}` must
  produce the same result.
- If merge safety is ambiguous, write `merge-report.json`, preserve the
  workspace, and pause for human input.

## Cleanup Policy

- Validation, Tree Grading, and QA passing make a group cleanup-eligible, but do
  not delete artifacts immediately.
- Only accepted runs automatically delete `.pipeline-workspace/`.
- Rejected or paused runs keep artifacts so the next iteration can restart from
  `merge` or `execution`.
- `.pipeline-last-run-summary.json` is the retained summary artifact for
  terminal runs.
- Never delete integrated code, tests, docs, release notes, or user-retained
  files as part of cleanup.

## Git Publication Policy

- Git publication is disabled unless `gitPolicy.enabled === true`.
- Only the orchestrator may commit or push. Subagents must never run git
  publication commands.
- Commit subjects use `type(scope): :gitmoji: 中文描述`, for example
  `feat(pipeline): :sparkles: 完成流水线交付`. This keeps the subject compatible
  with Conventional Commits while preserving gitmoji and Chinese intent.
- Doc publication runs only after Execution-produced documentation changes are
  integrated and accepted. By default it stages the accepted documentation paths
  recorded in `doc-report.updated_files`, commits with
  `docs(pipeline): :memo: 更新流水线交付文档`, and does not push unless the Doc phase
  policy enables push.
- Cleanup publication runs only after Final Assessment accepts the run and
  `.pipeline-workspace/` has been removed. By default it stages the final
  worktree, commits with `feat(pipeline): :sparkles: 完成流水线交付`, and pushes to
  `origin` on the current branch.
- Rejected or paused runs must not auto commit or push.
- Publication failures fail fast by default. Set `failureMode: "log"` only when
  a project explicitly wants delivery to continue after git publication errors.

## Legacy PRE Review

PRE/EME Review aggregation remains documented in `agents/review.md` and
`references/pre-rubric.md` for older runs. Do not use it as the active quality
gate unless a user explicitly asks to run the legacy review path.
