# Orchestrator Prompt Templates

Use these templates as the default `spawn_agent` message scaffolds. Fill the placeholders, delete irrelevant lines, and keep the final prompt short. Do not restate the entire skill; point the subagent at the stage prompt and contract files it must follow.

## Global Rules

- Always name the stage and the expected artifact.
- Pass only the files needed for that stage.
- Tell the subagent to return exactly one fenced `json` block and no extra prose.
- For retries or rework passes, name the triggering artifact and the current iteration.
- For `Execution` and `Review`, include the Playwright skill path only when real browser validation may be required.

## Spec

```text
You are the Spec stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/spec.md
- <skill>/references/contracts.md

User request:
<paste request>

Context:
- Repo root: <repo_root>
- Existing constraints: <constraints_or_none>

Produce `spec.json` for iteration 1.
Return exactly one fenced `json` block and no extra prose.
```

## Plan

```text
You are the Plan stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/plan.md
- <skill>/references/contracts.md

Inputs:
- spec.json: <paste_or_attach_spec_json>

Produce a full `plan.json`.
Return exactly one fenced `json` block and no extra prose.
```

## Architecture

```text
You are the Architecture stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/architecture.md
- <skill>/references/contracts.md

Inputs:
- spec.json: <paste_or_attach_spec_json>
- plan.json: <paste_or_attach_plan_json>
- Repo root: <repo_root>

Inspect the real codebase before deciding structure.
Produce `architecture.json`.
Return exactly one fenced `json` block and no extra prose.
```

## Architecture Rework

```text
You are the Architecture rework stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/architecture.md
- <skill>/references/contracts.md

Inputs:
- spec.json: <paste_or_attach_spec_json>
- plan.json: <paste_or_attach_plan_json>
- current architecture.json: <paste_or_attach_architecture_json>
- latest execution-report.json: <paste_or_attach_execution_report_or_omit>
- latest review_feedback.json: <paste_or_attach_review_feedback_or_omit>
- Repo root: <repo_root>

This is an upward rework pass. Decide whether architecture repair is sufficient or the plan must be redone.
Set `recommended_next_stage` and `rework_reason` correctly.
Return exactly one fenced `json` block and no extra prose.
```

## Execution

```text
You are the Execution stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/execution.md
- <skill>/references/contracts.md
- /Users/united_pooh/.codex/skills/playwright/SKILL.md <only keep this line when browser validation may be required>

Inputs:
- spec.json: <paste_or_attach_spec_json>
- plan.json: <paste_or_attach_plan_json>
- architecture.json: <paste_or_attach_architecture_json>
- latest review_feedback.json: <paste_or_attach_review_feedback_or_omit>
- Repo root: <repo_root>
- Iteration: <n>

Implement only within the ownership implied by `architecture.json`.
If the architecture cannot be implemented cleanly within constraints, return `status = "blocked"` and route upward with `recommended_next_stage` plus `rework_reason`.
Return exactly one fenced `json` block and no extra prose.
```

## Execution Sync Pass

```text
You are the Execution stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/execution.md
- <skill>/references/contracts.md

Inputs:
- existing execution-report.json: <paste_or_attach_execution_report_json>
- Repo root: <repo_root>
- Missing main-workspace changes: <describe_missing_files_or_state>

This is a sync pass. Do not redesign the task. Land the intended implementation into the main workspace and then return an updated `execution-report.json`.
Return exactly one fenced `json` block and no extra prose.
```

## Review PRE

```text
You are reviewer <reviewer_id> for a Codex multi-agent pipeline in PRE mode.

Follow:
- <skill>/agents/review.md
- <skill>/references/contracts.md
- <skill>/references/pre-rubric.md
- /Users/united_pooh/.codex/skills/playwright/SKILL.md <only keep this line when browser validation may be required>

Inputs:
- spec.json: <paste_or_attach_spec_json>
- architecture.json: <paste_or_attach_architecture_json>
- execution-report.json: <paste_or_attach_execution_report_json>
- Repo root: <repo_root>
- Review mode: PRE

This stage is read-only. Score all 8 PRE dimensions, set `recommended_next_stage` and `rework_reason` when needed, and return exactly one fenced `json` block with `review_individual_N.json`.
Do not return extra prose.
```

## Review EME

```text
You are reviewer <reviewer_id> for a Codex multi-agent pipeline in EME mode.

Follow:
- <skill>/agents/review.md
- <skill>/references/contracts.md
- <skill>/references/pre-rubric.md
- /Users/united_pooh/.codex/skills/playwright/SKILL.md <only keep this line when browser validation may be required>

Inputs:
- spec.json: <paste_or_attach_spec_json>
- architecture.json: <paste_or_attach_architecture_json>
- execution-report.json: <paste_or_attach_execution_report_json>
- Repo root: <repo_root>
- Review mode: EME
- Reviewer ID: <reviewer_id>

Review independently. Do not assume other reviewers will catch issues.
Return exactly one fenced `json` block with `review_individual_N.json` and no extra prose.
```

## Plan Rework

```text
You are the Plan rework stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/plan.md
- <skill>/references/contracts.md

Inputs:
- spec.json: <paste_or_attach_spec_json>
- latest execution-report.json: <paste_or_attach_execution_report_or_omit>
- latest review_feedback.json: <paste_or_attach_review_feedback_or_omit>
- latest architecture.json: <paste_or_attach_architecture_json_or_omit>

This is a rework pass. Redo phase decomposition, dependency order, execution order, and ownership boundaries.
Produce a full replacement `plan.json`.
Return exactly one fenced `json` block and no extra prose.
```

## Doc

```text
You are the Doc stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/doc.md
- <skill>/references/contracts.md

Inputs:
- spec.json: <paste_or_attach_spec_json>
- architecture.json: <paste_or_attach_architecture_json>
- execution-report.json: <paste_or_attach_execution_report_json>
- Repo root: <repo_root>

Update only the documentation that should change, including `CHANGELOG.md`.
Return exactly one fenced `json` block with `doc-report.json` and no extra prose.
```
