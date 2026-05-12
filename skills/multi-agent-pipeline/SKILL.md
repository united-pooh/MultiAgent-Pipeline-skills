---
name: multi-agent-pipeline
description: >
  Claude Code multi-agent production pipeline for non-trivial implementation work. Uses
  the Agent tool to run Spec, Plan, Architecture, Execution, Review, and Doc subagents,
  persists artifacts in `.pipeline-workspace/`, and loops Execution and Review until the
  change passes. Use when the user wants a feature, refactor, or subsystem built with
  explicit spec/plan/architecture/review stages, or mentions "pipeline", "multi-agent",
  "production workflow", or "full implementation".
---

# Multi-Agent Production Pipeline

Use this skill when the task is large enough to benefit from explicit staging instead of ad hoc implementation.

The main Claude Code session is the orchestrator. It owns user communication, artifact persistence, stage routing, review aggregation, and context management. Subagents own bounded stage work.

## Claude Code Execution Model

This skill is written for Claude Code, using the `Agent` tool.

- Use the `Agent` tool for each stage. Each Agent call is synchronous — it blocks until the subagent returns.
- Keep orchestration local. Subagents produce artifacts or bounded code/doc changes; the orchestrator decides what to run next.
- Default review mode is `EME`. Do not ask the user to choose unless the user explicitly requests a mode. Use `PRE` when the user needs the strictest production gate: a single reviewer applies the full PRE checklist, and any failed dimension sends the work back for rework.
- Ask the user only for blocking ambiguities. Otherwise proceed with explicit assumptions in `spec.json`.
- For EME parallel review, send all 3 `Agent` calls in a single response message — Claude Code runs them concurrently when in the same message.
- If a subagent returns malformed JSON, rerun that stage with a corrected prompt. Do not hand-wave the artifact.

## Main Agent Role

The orchestrator is orchestration-only. Keep the main context lean.

- The orchestrator should avoid implementing feature code, writing tests, authoring docs, or doing functionality-level browser validation.
- The orchestrator is responsible for:
  - reading skill instructions, contracts, and rubric files
  - creating and maintaining `.pipeline-workspace/`
  - parsing and persisting canonical artifacts (using `Write` and `Read` tools directly)
  - spawning stage subagents via the `Agent` tool
  - deciding the next stage based on artifact outputs
  - aggregating review results and routing retries or upward rework
  - bringing genuinely blocking ambiguities back to the user
- The orchestrator should not "just fix it" after an Execution or Review failure.
- The only implementation-adjacent exceptions are:
  - rerunning a stage when a subagent returned malformed JSON
  - asking the same or a new stage worker to sync intended changes into the main workspace when the expected changes did not land

## Recommended Agent Types (subagent_type)

- Spec: `general-purpose`
- Plan: `general-purpose`
- Architecture: `Explore`
- Execution: `general-purpose`
- Review: `general-purpose`
- Doc: `general-purpose`

## Recommended Models

Use explicit `model` overrides in the `Agent` tool call when spawning stage subagents unless the user asks for a cheaper or faster run.

- Spec: `opus`
- Plan: `opus`
- Architecture: `opus`
- Execution: `opus`
- Review PRE: `opus`
- Review EME: spawn 3 reviewers — `opus`, `opus`, `sonnet`
- Doc: `sonnet`

If a stage omits `model`, it inherits the orchestrator's current model.

## Parallelism

Claude Code's `Agent` tool is synchronous per call, but **multiple `Agent` calls in the same response message run concurrently**. Use this for:

- EME Review: send all 3 reviewer `Agent` calls in one message
- Any fan-out where stages do not depend on each other's outputs

For sequential stages (Spec → Plan → Architecture → Execution), call one `Agent` at a time and wait for the result before proceeding.

## Workspace

Create a run workspace before the first stage:

```text
.pipeline-workspace/
├── spec.json
├── plan.json
├── architecture.json
├── execution-report.json
├── validation-report.json
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

The orchestrator writes these files locally after each stage using the `Write` tool. Do not rely on subagents to persist canonical artifacts in the main workspace.

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
- Read the actual codebase (subagent has full tool access including `Glob`, `Grep`, `Read`)
- Decide `incremental`, `refactor`, or `hybrid`
- Produce `architecture.json`

Stop condition:
- If `feasibility` is `infeasible`, halt the pipeline and show `infeasibility_reason` and `rollback_notes` to the user.

### 4. Execution

Spawn an Execution subagent with `spec.json`, `plan.json`, `architecture.json`, and the latest `review_feedback.json` when retrying.

Worker ownership:
- The worker owns only files named in `architecture.json.proposed_changes` plus directly related tests and docs it must touch.
- The worker is not alone in the codebase and must not revert unrelated edits.
- The worker implements directly in the main workspace (Claude Code subagents share the filesystem) and returns an `execution-report.json` payload summarizing changed files, requirement coverage, tests, and blockers.
- The worker is the implementation owner. If browser automation is required for validation, include the Playwright skill path in the prompt and tell the worker to use it before inventing a browser workflow.

Before starting review, the orchestrator performs lightweight integration checks.

Integration rule:
- Verify that `execution-report.json` is valid, `changed_files` exist in the workspace, and `tests_run` is populated.
- If expected files are missing, send a follow-up `Agent` call to the same execution prompt asking it to sync the intended implementation.
- Functional correctness is the Review subagent's job.

### 4a. Validation

After every successful Execution pass, before starting Review, spawn a Validation subagent using `agents/validation.md`.

Goal:
- Run `go test ./...` and `go vet ./...` against the current workspace
- Collect raw command output, exit codes, and test counts
- Produce `validation-report.json` — objective evidence for the Review stage

Integration rule:
- If `validation-report.json.status == "failed"` or `"error"`, route directly back to Execution. Do not start Review. Pass `validation-report.json` to the next Execution pass as additional context alongside `review_feedback.json`.
- If `validation-report.json.status == "passed"`, continue to Review. Pass `validation-report.json` inline in the Review prompt.

The orchestrator writes `validation-report.json` to `.pipeline-workspace/` after each Validation pass.

### 5. Review

Run review after every execution pass where Validation passed.

`EME` mode:
- Send 3 independent Review `Agent` calls **in a single message** (they run in parallel).
- Give each reviewer the same inputs and a distinct `reviewer_id`.
- Each reviewer returns one `review_individual_N.json`.
- The orchestrator writes all reviewer outputs to `review_history/` and merges them into `review_feedback.json`.

`PRE` mode:
- Spawn 1 Review subagent.
- Treat PRE as the strictest production gate: the reviewer evaluates the full 8-dimension checklist, and any failed dimension blocks acceptance.
- Convert its single review directly into `review_feedback.json`; if any dimension fails, route the work back for rework.

Voting rules:
- `warning` counts as `pass` for majority voting.
- Any failed dimension keeps the pipeline in the retry loop, but the next stage is chosen from `review_feedback.json.recommended_next_stage`.
- Preserve warnings even when the final verdict is `pass`.
- **Warning threshold rule**: After aggregating votes, count total warning dimensions (`warning_count`). If `warning_count >= 2`, force `verdict = "fail"` and set `warning_threshold_triggered = true`, even if no individual dimension scored `fail`. Set `recommended_next_stage = "execution"` when only the warning threshold triggered the failure.

Loop rule:
- `Execution → Review → fail` normally loops back to `Execution` only when `review_feedback.json.recommended_next_stage == "execution"`.
- If `Execution` returns `status = "blocked"` with `recommended_next_stage = "architecture"` or `"plan"`, do not send the change to Review. Route upward immediately.
- If `Review` returns `verdict = "fail"` with `recommended_next_stage = "architecture"` or `"plan"`, route upward immediately.
- Track `consecutive_exec_review_failures` only for the normal `Execution → Review(fail, execution)` loop.
- After 2 consecutive `Execution → Review(fail, execution)` cycles, force an `Architecture` rework even if the latest review still points to `execution`.
- Reset `consecutive_exec_review_failures` whenever review passes or the pipeline routes to `Architecture` or `Plan`.

### 5a. Architecture Rework

Run an Architecture rework pass when:
- `Execution` reports `status = "blocked"` and recommends `architecture`
- `Review` fails and recommends `architecture`
- the pipeline hit 2 consecutive `Execution → Review(fail, execution)` cycles
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

After review passes, spawn a Doc subagent with `spec.json`, `architecture.json`, and `execution-report.json`.

Goal:
- Update only the docs that actually changed
- Always update `CHANGELOG.md`
- Return `doc-report.json`

Before final delivery, the orchestrator only verifies that `doc-report.json` is valid and the expected documentation files are present in the workspace. If docs did not land, spawn a new Doc `Agent` call. The orchestrator does not hand-author the documentation.

## Orchestration Rules

### Prompt Construction

For each spawned stage:
- Read the stage instructions from `agents/<stage>.md` using the `Read` tool
- Use `references/orchestrator-prompts.md` as the default scaffold for the Agent prompt
- Read only the specific contract or rubric files that stage needs
- Pass artifact contents inline in the prompt (paste JSON directly) — subagents cannot reliably reference workspace paths unless told explicitly
- Tell the subagent to return exactly one fenced `json` block and no extra prose
- For `Execution` and `Review`, include the Playwright skill path in the prompt whenever real browser validation may be required

### Artifact Discipline

- The orchestrator is the source of truth for artifact files in `.pipeline-workspace/`.
- Parse subagent JSON from the Agent tool result, validate required fields, then write the canonical artifact locally using the `Write` tool.
- If a subagent response is malformed, fix the prompt and rerun that stage.
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

### Rework Routing

- `Execution` owns implementation. `Review` owns correctness judgment. `Architecture` and `Plan` own top-level redesign.
- Route to `Architecture` before `Plan` whenever there is ambiguity about which upstream layer failed.
- Route directly to `Plan` only when the failure clearly comes from phase decomposition, execution order, or ownership boundaries.
- After any `Plan` rework, always rerun `Architecture` before `Execution`.
- When upward routing occurs, keep the latest failure artifacts on disk and pass them into the rework stage.

### File Ownership

When spawning execution subagents:
- Assign exact file ownership from `architecture.json.proposed_changes`
- Tell the subagent it may also touch directly adjacent tests or docs needed to complete the task
- Tell the subagent not to revert edits it did not make
- After the Agent call returns, verify the expected files are present. If missing, resend with a sync-pass prompt.

### When Not to Use This Skill

Skip this pipeline for:
- Tiny one-file edits
- Pure Q&A or design discussion
- Tasks where the user explicitly wants a quick direct patch rather than staged delivery

## Files To Read

- Stage prompts: `agents/spec.md`, `agents/plan.md`, `agents/architecture.md`, `agents/execution.md`, `agents/validation.md`, `agents/review.md`, `agents/doc.md`
- Contracts: `references/contracts.md`
- Review rubric: `references/pre-rubric.md`
- Prompt scaffolds: `references/orchestrator-prompts.md`
