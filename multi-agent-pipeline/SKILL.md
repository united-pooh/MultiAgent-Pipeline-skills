---
name: multi-agent-pipeline
description: >
  Codex-first multi-agent production pipeline for non-trivial implementation work. Uses
  `spawn_agent` to run Spec, Plan, Architecture, Execution, Review, and Doc subagents,
  persists artifacts in `.pipeline-workspace/`, and loops Execution and Review until the
  change passes. Use when the user wants a feature, refactor, or subsystem built with
  explicit spec/plan/architecture/review stages, or mentions "pipeline", "multi-agent",
  "production workflow", or "full implementation".
---

# Multi-Agent Production Pipeline

Use this skill when the task is large enough to benefit from explicit staging instead of ad hoc implementation.

The local Codex agent is the orchestrator. It owns user communication, artifact persistence, stage routing, review aggregation, and thread/timeout management. Subagents own bounded stage work.

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

## Main Agent Role

The orchestrator is orchestration-only. Keep the main context lean.

- The orchestrator should avoid implementing feature code, writing tests, authoring docs, or doing functionality-level browser validation.
- The orchestrator is responsible for:
  - reading skill instructions, contracts, and rubric files
  - creating and maintaining `.pipeline-workspace/`
  - parsing and persisting canonical artifacts
  - spawning, waiting on, and closing stage agents
  - deciding the next stage based on artifact outputs
  - aggregating review results and routing retries or upward rework
  - bringing genuinely blocking ambiguities back to the user
- The orchestrator should not "just fix it" after an Execution or Review failure.
- The only implementation-adjacent exceptions are:
  - rerunning a stage when a subagent returned malformed JSON
  - asking the same or a new stage worker to sync intended changes into the main workspace when the expected changes did not land

## Recommended Agent Types

- Spec: `default`
- Plan: `default`
- Architecture: `default`
- Execution: `worker`
- Review: `default`
- Doc: `worker`

Use `explorer` only for narrow side questions during architecture or review, not for the main pipeline stages.

## Recommended Model Overrides

Use explicit `model` and `reasoning_effort` overrides when spawning stage agents unless the user asks for a cheaper or faster run.

- Spec: `gpt-5.4`, `reasoning_effort: xhigh`
- Plan: `gpt-5.4`, `reasoning_effort: xhigh`
- Architecture: `gpt-5.4`, `reasoning_effort: xhigh`
- Execution: `gpt-5.4`, `reasoning_effort: high`
- Review `PRE`: `gpt-5.4`, `reasoning_effort: xhigh`
- Review `EME`: spawn 3 reviewers total using `gpt-5.4`, `gpt-5.4`, and `gpt-5.4-mini`
- Doc: `gpt-5.4`, `reasoning_effort: medium`

If a stage omits `model`, it inherits the orchestrator's current model. `wait_agent` has no model setting because it only waits on an existing agent.

Recommended `wait_agent` timeouts for this skill:
- Spec / Plan / Architecture: `timeout_ms: 600000`
- Execution: `timeout_ms: 600000`
- Review `PRE`: `timeout_ms: 600000`
- Review `EME`: `timeout_ms: 600000` per reviewer wait call
- Doc: `timeout_ms: 600000`

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
├── execution-report.json
├── review_feedback.json
├── doc-report.json
├── review_history/
│   ├── iteration-1-reviewer-1.json
│   ├── iteration-1-reviewer-2.json
│   ├── iteration-1-reviewer-3.json
│   └── ...
└── logs/
    └── pipeline.log
```

The orchestrator writes these files locally after each stage. Do not rely on subagents to persist canonical artifacts in the main workspace.

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

### 4. Execution

Spawn an Execution `worker` with `spec.json`, `plan.json`, `architecture.json`, and the latest `review_feedback.json` when retrying.

Worker ownership:
- The worker owns only files named in `architecture.json.proposed_changes` plus directly related tests and docs it must touch.
- The worker is not alone in the codebase and must not revert unrelated edits.
- The worker implements in its forked workspace and returns an `execution-report.json` payload summarizing changed files, requirement coverage, tests, and blockers.
- The worker is the implementation owner. If browser automation is required for validation, include `/Users/united_pooh/.codex/skills/playwright/SKILL.md` in the spawn prompt and tell the worker to use it before inventing a browser workflow.

Before starting review, the orchestrator only performs lightweight integration checks. The main workspace, not the worker fork, is what reviewers evaluate.

Integration rule:
- First inspect whether the worker's changes are already present in the main workspace.
- If they are already present and match the intended implementation, record that and proceed.
- If they are not present, do not manually integrate or reproduce them in the main workspace. Send a follow-up task to the same Execution worker asking it to sync the intended implementation into the main workspace.
- If the original Execution worker is unavailable, spawn a new Execution worker whose only job is to land the intended implementation into the main workspace using the existing `execution-report.json` and any prior worker context.
- Before review, the orchestrator should only check that `execution-report.json` is valid, `changed_files` exist in the main workspace, and `tests_run` is populated. Functional correctness is the Review worker's job.

### 5. Review

Run review after every execution pass.

`EME` mode:
- Spawn 3 independent Review subagents in parallel.
- Give each reviewer the same inputs and a distinct `reviewer_id`.
- Each reviewer returns one `review_individual_N.json`.
- The orchestrator writes all reviewer outputs to `review_history/` and merges them into `review_feedback.json`.
- If browser automation is required for review evidence, include `/Users/united_pooh/.codex/skills/playwright/SKILL.md` in the spawn prompt and tell reviewers to use it in a read-only validation mode.

`PRE` mode:
- Spawn 1 Review subagent.
- Convert its single review directly into `review_feedback.json`.

Voting rules:
- `warning` counts as `pass` for majority voting.
- Any failed dimension keeps the pipeline in the retry loop, but the next stage is chosen from `review_feedback.json.recommended_next_stage`.
- Preserve warnings even when the final verdict is `pass`.

Loop rule:
- `Execution -> Review -> fail` normally loops back to `Execution` only when `review_feedback.json.recommended_next_stage == "execution"`.
- If `Execution` returns `status = "blocked"` with `recommended_next_stage = "architecture"` or `"plan"`, do not send the change to Review. Route upward immediately.
- If `Review` returns `verdict = "fail"` with `recommended_next_stage = "architecture"` or `"plan"`, route upward immediately.
- Track `consecutive_exec_review_failures` only for the normal `Execution -> Review(fail, execution)` loop.
- After 2 consecutive `Execution -> Review(fail, execution)` cycles, force an `Architecture` rework even if the latest review still points to `execution`.
- Reset `consecutive_exec_review_failures` whenever review passes or the pipeline routes to `Architecture` or `Plan`.

### 5a. Architecture Rework

Run an Architecture rework pass when:
- `Execution` reports `status = "blocked"` and recommends `architecture`
- `Review` fails and recommends `architecture`
- the pipeline hit 2 consecutive `Execution -> Review(fail, execution)` cycles
- `Review` or `Execution` recommends `plan`, because Plan rework must flow through Architecture again before execution resumes

Inputs:
- `spec.json`
- `plan.json`
- current `architecture.json`
- latest `execution-report.json` when available
- latest `review_feedback.json` when available

Routing rule:
- If the Architecture rework produces `recommended_next_stage = "execution"`, resume at `Execution`.
- If the Architecture rework produces `recommended_next_stage = "plan"`, route to `Plan` rework.
- If `feasibility = "infeasible"`, stop and return control to the user.

### 5b. Plan Rework

Run a Plan rework pass only when:
- `Execution` reports `status = "blocked"` and recommends `plan`
- `Review` fails and recommends `plan`
- an Architecture rework concludes that the plan itself must be redone

Inputs:
- `spec.json`
- latest `execution-report.json` when available
- latest `review_feedback.json` when available
- latest `architecture.json` when available

Routing rule:
- A Plan rework always produces a full replacement `plan.json`.
- After `Plan` rework, always run a fresh standard `Architecture` pass before returning to `Execution`.

### 6. Documentation

After review passes, spawn a Doc `worker` with `spec.json`, `architecture.json`, and `execution-report.json`.

Goal:
- Update only the docs that actually changed
- Always update `CHANGELOG.md`
- Return `doc-report.json`

Before final delivery, the orchestrator only verifies that `doc-report.json` is valid and the expected documentation files are present in the main workspace. If docs did not land, send a follow-up task to the same Doc worker or a new Doc worker. The orchestrator does not hand-author the documentation.

## Orchestration Rules

### Prompt Construction

For each spawned stage:
- Read the stage instructions from `agents/<stage>.md`
- Use `references/orchestrator-prompts.md` as the default scaffold for the plain-text `spawn_agent` message instead of improvising a new prompt each time
- Read only the specific contract or rubric files that stage needs
- Pass artifact contents or file paths explicitly
- Tell the subagent to return exactly one fenced `json` block and no extra prose
- For `Execution` and `Review`, include `/Users/united_pooh/.codex/skills/playwright/SKILL.md` in the prompt whenever real browser validation may be required.

### Artifact Discipline

- The orchestrator is the source of truth for artifact files in `.pipeline-workspace/`.
- Parse subagent JSON, validate the required fields, then write the canonical artifact locally.
- If a subagent response is malformed, fix the prompt and rerun that stage instead of hand-waving the artifact.
- Write artifacts even when the corresponding stage also changed files. Artifact persistence and code/doc integration are separate responsibilities.
- The orchestrator should not manually repair artifact contents except by rerunning the responsible stage.

### Review Aggregation

The orchestrator merges reviewer outputs locally:
- Exactly 8 PRE dimensions
- Majority vote per dimension in `EME`
- Merge all failed-dimension issues into `merged_issues`
- Keep reviewer IDs in `flagged_by`
- Increment `iteration` on every review pass
- Aggregate `recommended_next_stage` from reviewer outputs. Use the dominant blocking recommendation across failing reviewers. If there is no clear upstream signal, default failed review routing to `execution`.
- Aggregate `rework_reason` into a concise top-level root-cause summary in `review_feedback.json`.

Operational note:
- In real Codex sessions, `EME` review is the most likely point to hit thread limits because it spawns 3 reviewers at once.
- Close Spec, Plan, Architecture, and any completed Execution agents before spawning the reviewer trio.
- If a reviewer spawn still fails because of temporary thread pressure, close any finished idle agents first, then retry the missing reviewer instead of downgrading silently to fewer reviewers.

### Rework Routing

- `Execution` owns implementation. `Review` owns correctness judgment. `Architecture` and `Plan` own top-level redesign.
- Route to `Architecture` before `Plan` whenever there is ambiguity about which upstream layer failed.
- Route directly to `Plan` only when the failure clearly comes from phase decomposition, execution order, or ownership boundaries.
- After any `Plan` rework, always rerun `Architecture` before `Execution`.
- When upward routing occurs, keep the latest failure artifacts on disk and pass them into the rework stage.

### File Ownership

When spawning `worker` agents:
- Assign exact file ownership from `architecture.json.proposed_changes`
- Tell the worker it may also touch directly adjacent tests or docs needed to complete the task
- Tell the worker not to revert edits it did not make
- Treat uploaded worker changes as proposals until they are confirmed in the main workspace.
- If the proposals are missing from the main workspace, send the responsible worker back to sync them instead of taking over the work in the orchestrator.

### When Not to Use This Skill

Skip this pipeline for:
- Tiny one-file edits
- Pure Q&A or design discussion
- Tasks where the user explicitly wants a quick direct patch rather than staged delivery

## Files To Read

- Stage prompts: `agents/spec.md`, `agents/plan.md`, `agents/architecture.md`, `agents/execution.md`, `agents/review.md`, `agents/doc.md`
- Contracts: `references/contracts.md`
- Review rubric: `references/pre-rubric.md`
- Prompt scaffolds: `references/orchestrator-prompts.md`
