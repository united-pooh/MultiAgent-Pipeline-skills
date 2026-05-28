# Orchestration Rules

Read this file when constructing prompts, validating artifacts, aggregating
review, merging proposals, or cleaning up a run.

## Prompt Construction

For each spawned stage:

- Read the stage instructions from `agents/<stage>.md`.
- Read only the specific contract or rubric files that stage needs.
- Pass artifact contents or exact file paths explicitly.
- For any required skill, include the exact skill name and absolute path valid
  in the current environment.
- Spec and Plan prompts must attach `superpowers` and explicitly forbid its
  build, TDD, commit, and finish-branch behaviors.
- Execution and Review prompts must attach `ce-frontend-design` whenever
  `worker_group.required_skills` contains it.
- When this skill was explicitly invoked by the user, prompts may treat
  subagent delegation and safe parallel work as authorized within host
  constraints.
- Tell subagents to return the exact fenced block format required by the stage
  prompt.

For copy-ready prompt scaffolds, use `references/orchestrator-prompts.md`.

## Artifact Discipline

- The orchestrator is the source of truth for artifact files in
  `.pipeline-workspace/`.
- Parse subagent JSON and validate required fields before writing canonical
  artifacts.
- If a subagent response is malformed, fix the prompt and rerun that stage
  instead of hand-waving the artifact.
- Write artifacts even when the corresponding stage also changed files.
- Artifact persistence and code/doc integration are separate responsibilities.
- The orchestrator writes `merge-report.json`, `conflict-resolution.json`, and
  `.pipeline-last-run-summary.json` locally.
- Cleanup eligibility is derived locally after Validation, Review, and QA pass.

## Review Aggregation

The orchestrator merges reviewer outputs locally:

- Exactly 8 PRE dimensions
- Majority vote per dimension in `EME`
- `warning` counts as pass for majority vote
- Failed-dimension issues merge into `merged_issues`
- Reviewer IDs stay in `flagged_by`
- Iteration increments on every review pass for the relevant group

Operational note: `EME` review is the most likely point to hit thread limits
because it spawns three reviewers at once. Close finished stage agents before
spawning the reviewer trio. If a reviewer spawn fails from temporary thread
pressure, close finished idle agents and retry the missing reviewer instead of
silently downgrading the review.

## File Ownership And Worker Routing

When spawning `worker` agents:

- Assign exact file ownership from
  `dispatch.json.worker_groups[].owned_files`.
- Pass `required_skills` exactly as derived by Dispatch.
- Tell the worker it may also touch directly adjacent tests or docs needed to
  complete the task.
- Tell the worker it is not alone in the codebase and must not revert edits it
  did not make.
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

- Validation, Review, and QA passing make a group cleanup-eligible, but do not
  delete artifacts immediately.
- Only accepted runs automatically delete `.pipeline-workspace/`.
- Rejected or paused runs keep artifacts so the next iteration can restart from
  `merge` or `execution`.
- `.pipeline-last-run-summary.json` is the retained summary artifact for
  terminal runs.
- Never delete integrated code, tests, docs, release notes, or user-retained
  files as part of cleanup.

