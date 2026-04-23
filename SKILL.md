---
name: multi-agent-pipeline
description: >
  Codex-first multi-agent production pipeline for non-trivial implementation work. Uses
  `spawn_agent` to run Spec, Plan, Architecture, Dispatch, Execution, Review, QA, Doc,
  and Final Assessment subagents, persists artifacts in `.pipeline-workspace/`, and
  coordinates grouped execution/review/QA before final delivery assessment. Use when the
  user wants a feature, refactor, or subsystem built with explicit staged delivery, or
  mentions "pipeline", "multi-agent", "production workflow", or "full implementation".
---

# Multi-Agent Production Pipeline

Use this skill when the task is large enough to benefit from explicit staging instead of ad hoc implementation.

The local Codex agent is the orchestrator. It owns user communication, artifact persistence, review aggregation, and final integration. Subagents own bounded stage work.

## Codex Execution Model

This skill is written for Codex, not as a generic "agent framework".

- Use `spawn_agent` for each stage. Default to `fork_context: true`.
- Keep orchestration local. Subagents produce artifacts or bounded code/doc changes; the orchestrator decides what to run next.
- Default review mode is `EME`. Do not ask the user to choose unless speed or token budget is an explicit concern. Use `PRE` only for clearly small changes or when the user asks for a cheaper/faster pass.
- Ask the user only for blocking ambiguities. Otherwise proceed with explicit assumptions in `spec.json`.
- Use `wait_agent` only when the next pipeline step is blocked on that result.
- Never rely on the default `wait_agent` timeout for this skill. Always pass an explicit long `timeout_ms`.
- Default waiting policy for this skill: use `timeout_ms: 600000` (10 minutes) for any stage that is blocking the next step.
- If `wait_agent` returns without a final result because the timeout elapsed, treat that as "still running", not as failure. Keep the agent open and call `wait_agent` again with another long timeout until a final status arrives or a real blocker is identified.
- Close completed agents after their outputs are integrated.
- Be conscious of agent thread limits. Before any fan-out stage such as `EME` review, close finished stage agents so reviewer spawning does not fail on thread exhaustion.

## Recommended Agent Types

- Spec: `default`
- Plan: `default`
- Architecture: `default`
- Dispatch: `default`
- Execution: `worker`
- Review: `default`
- QA: `worker`
- Doc: `worker`
- Final Assessment: `default`

Use `explorer` only for narrow side questions during architecture or review, not for the main pipeline stages.

## Recommended Model Overrides

Use explicit `model` and `reasoning_effort` overrides when spawning stage agents unless the user asks for a cheaper or faster run.

- Spec: `gpt-5.4`, `reasoning_effort: xhigh`
- Plan: `gpt-5.4`, `reasoning_effort: xhigh`
- Architecture: `gpt-5.4`, `reasoning_effort: xhigh`
- Dispatch: `gpt-5.4`, `reasoning_effort: high`
- Execution: `gpt-5.4`, `reasoning_effort: high`
- Review `PRE`: `gpt-5.4`, `reasoning_effort: xhigh`
- Review `EME`: spawn 3 reviewers total using `gpt-5.4`, `gpt-5.4`, and `gpt-5.4-mini`
- QA: `gpt-5.4`, `reasoning_effort: high`
- Doc: `gpt-5.4`, `reasoning_effort: medium`
- Final Assessment: `gpt-5.4`, `reasoning_effort: xhigh`

If a stage omits `model`, it inherits the orchestrator's current model. `wait_agent` has no model setting because it only waits on an existing agent.

Recommended `wait_agent` timeouts for this skill:
- Spec / Plan / Architecture / Dispatch: `timeout_ms: 600000`
- Execution: `timeout_ms: 600000`
- Review `PRE`: `timeout_ms: 600000`
- Review `EME`: `timeout_ms: 600000` per reviewer wait call
- QA: `timeout_ms: 600000`
- Doc: `timeout_ms: 600000`
- Final Assessment: `timeout_ms: 600000`

Example blocking wait pattern:

```json
{
  "targets": ["<agent_id>"],
  "timeout_ms": 600000
}
```

If the wait returns timed out or empty, immediately wait again with the same long timeout instead of assuming the subagent reply was lost.

## Workspace

Create a run workspace before the first stage:

```text
.pipeline-workspace/
├── spec.json
├── plan.json
├── architecture.json
├── dispatch.json
├── doc-report.json
├── final-assessment.json
├── execution/
│   ├── GROUP-1/
│   │   ├── iteration-1-execution-report.json
│   │   └── iteration-2-execution-report.json
│   └── GROUP-2/
│       └── iteration-1-execution-report.json
├── review_history/
│   ├── GROUP-1/
│   │   ├── iteration-1-reviewer-1.json
│   │   ├── iteration-1-reviewer-2.json
│   │   ├── iteration-1-reviewer-3.json
│   │   └── iteration-1-review-feedback.json
│   └── GROUP-2/
│       └── ...
├── qa/
│   ├── GROUP-1/
│   │   └── iteration-1-qa-report.json
│   └── GROUP-2/
│       └── iteration-1-qa-report.json
├── assessment_history/
│   ├── iteration-1-final-assessment.json
│   └── ...
└── logs/
    └── pipeline.log
```

The orchestrator writes these files locally after each stage. `references/contracts.md` defines payload shape only; this workspace layout is the orchestrator's storage convention for per-group and per-iteration artifacts. Do not rely on subagents to persist canonical artifacts in the main workspace.

## Pipeline

### 1. Spec

Spawn the Spec subagent using `agents/spec.md` and `references/contracts.md`.

Goal:
- Turn the request into `spec.json`
- Record explicit assumptions instead of stopping on every ambiguity
- Keep scope tight and acceptance criteria testable

User interruption rule:
- If the subagent identifies a truly blocking ambiguity that changes the core feature or acceptance criteria, the orchestrator asks the user before continuing.
- Otherwise, the orchestrator writes `spec.json` and proceeds.

### 2. Plan

Spawn the Plan subagent with `spec.json`.

Goal:
- Produce `plan.json`
- Break work into phases, task order, dependencies, and risks
- Keep tasks implementation-sized, not speculative

### 3. Architecture

Spawn the Architecture subagent with `spec.json` and `plan.json`.

Goal:
- Read the actual codebase
- Decide `incremental`, `refactor`, or `hybrid`
- Produce `architecture.json`

Stop condition:
- If `feasibility` is `infeasible`, halt the pipeline and show `infeasibility_reason` and `rollback_notes` to the user.

### 4. Dispatch

Spawn the Dispatch subagent with `spec.json`, `plan.json`, and `architecture.json`.

Goal:
- Produce `dispatch.json`
- Partition tasks into worker groups with explicit file ownership
- Arrange those groups into dependency-respecting execution waves

Stop condition:
- If `dispatch.json` collapses to a single group, continue normally. This is a valid no-parallelism outcome, not an error.

### 5. Execution

For each wave in `dispatch.json.execution_waves`, spawn one Execution `worker` per group that is ready to run. Give each worker `spec.json`, `plan.json`, `architecture.json`, its assigned `worker_group`, and the latest group-specific `review_feedback.json` when retrying.

Worker ownership:
- The worker owns only files listed in `dispatch.json.worker_groups[].owned_files` for its group, plus directly adjacent tests and docs it must touch.
- The worker is not alone in the codebase and must not revert unrelated edits.
- The worker implements in its forked workspace and returns a group-scoped `execution-report.json` payload summarizing changed files, requirement coverage, tests, and blockers.

Before starting group review, the orchestrator must review the worker's uploaded changes and integrate or reproduce them in the main workspace. The main workspace, not the worker fork, is what reviewers and QA evaluate.

Integration rule:
- First inspect whether the worker's changes are already present in the main workspace.
- If they are already present and match the intended implementation, record that and proceed.
- If they are not present, manually integrate or reproduce the worker's uploaded changes in the main workspace before review.
- After integration, rerun the most relevant targeted verification so review sees the real main-workspace state.

Wave rule:
- Waves execute sequentially.
- Groups inside the same wave may execute concurrently as long as their ownership remains disjoint.

### 6. Review

Run review after every execution pass for each worker group independently.

`EME` mode:
- Spawn 3 independent Review subagents in parallel.
- Give each reviewer the same group-specific inputs and a distinct `reviewer_id`.
- Each reviewer returns one `review_individual_N.json`.
- The orchestrator writes all reviewer outputs to that group's `review_history/` folder and merges them into a group-specific `review_feedback.json`.

`PRE` mode:
- Spawn 1 Review subagent.
- Convert its single review directly into the group-specific `review_feedback.json`.

Voting rules:
- `warning` counts as `pass` for majority voting.
- Any failed dimension keeps that worker group in the Execution/Review loop.
- Preserve warnings even when the final verdict is `pass`.

Loop rule:
- Each worker group repeats Execution and Review until its `review_feedback.json.verdict == "pass"` or the user stops the pipeline.
- A downstream wave does not begin until every group it depends on has passed review and been integrated.

### 7. QA

After a worker group passes review, spawn a QA `worker` for that group with `spec.json`, `architecture.json`, the group's `execution-report.json`, and the group's `review_feedback.json`.

Goal:
- Run runtime validation that static review cannot cover
- Produce one `qa-report.json` per worker group
- Catch scenario failures before documentation or final delivery assessment

Gate:
- Do not move to Documentation until every worker group has both passed review and passed QA.

### 8. Documentation

After all worker groups have passed review and QA, spawn a Doc `worker` with `spec.json`, `architecture.json`, and the final integrated execution reports.

Goal:
- Update only the docs that actually changed
- Always update `CHANGELOG.md`
- Return `doc-report.json`

Before final delivery, the orchestrator must review and integrate the Doc worker's uploaded doc changes into the main workspace.

### 9. Final Assessment

After documentation is integrated, spawn the Final Assessment subagent with the full artifact set: `spec.json`, `plan.json`, `architecture.json`, `dispatch.json`, all execution reports, all review feedback artifacts, all QA reports, and `doc-report.json`.

Goal:
- Evaluate the delivered feature holistically across all worker groups
- Produce `final-assessment.json`
- Decide acceptance or the earliest correct restart point

## Orchestration Rules

### Prompt Construction

For each spawned stage:
- Read the stage instructions from `agents/<stage>.md`
- Read only the specific contract or rubric files that stage needs
- Pass artifact contents or file paths explicitly
- Tell the subagent to return exactly one fenced `json` block and no extra prose

### Artifact Discipline

- The orchestrator is the source of truth for artifact files in `.pipeline-workspace/`.
- Parse subagent JSON, validate the required fields, then write the canonical artifact locally.
- If a subagent response is malformed, fix the prompt and rerun that stage instead of hand-waving the artifact.
- Write artifacts even when the corresponding stage also changed files. Artifact persistence and code/doc integration are separate responsibilities.

### Review Aggregation

The orchestrator merges reviewer outputs locally:
- Exactly 8 PRE dimensions
- Majority vote per dimension in `EME`
- Merge all failed-dimension issues into `merged_issues`
- Keep reviewer IDs in `flagged_by`
- Increment `iteration` on every review pass for the relevant worker group

Operational note:
- In real Codex sessions, `EME` review is the most likely point to hit thread limits because it spawns 3 reviewers at once.
- Close Spec, Plan, Architecture, and any completed Execution agents before spawning the reviewer trio.
- If a reviewer spawn still fails because of temporary thread pressure, close any finished idle agents first, then retry the missing reviewer instead of downgrading silently to fewer reviewers.

### File Ownership

When spawning `worker` agents:
- Assign exact file ownership from `dispatch.json.worker_groups[].owned_files`
- Tell the worker it may also touch directly adjacent tests or docs needed to complete the task
- Tell the worker not to revert edits it did not make
- Treat uploaded worker changes as proposals until they are confirmed in the main workspace.

### When Not to Use This Skill

Skip this pipeline for:
- Tiny one-file edits
- Pure Q&A or design discussion
- Tasks where the user explicitly wants a quick direct patch rather than staged delivery

## Files To Read

- Stage prompts: `agents/spec.md`, `agents/plan.md`, `agents/architecture.md`, `agents/dispatch.md`, `agents/execution.md`, `agents/review.md`, `agents/qa.md`, `agents/doc.md`, `agents/final-assessment.md`
- Contracts: `references/contracts.md`
- Review rubric: `references/pre-rubric.md`
