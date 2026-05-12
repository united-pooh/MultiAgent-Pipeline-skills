# Orchestrator Prompt Templates

Use these templates as the default `Agent` tool prompt scaffolds. Fill the placeholders, delete irrelevant lines, and keep the final prompt short. Do not restate the entire skill; point the subagent at the stage prompt and contract files it must follow.

## Global Rules

- Always name the stage and the expected artifact.
- Pass all artifact JSON inline — paste the content directly into the prompt.
- Tell the subagent to return exactly one fenced `json` block and no extra prose.
- For retries or rework passes, name the triggering artifact and the current iteration.
- For `Execution` and `Review`, include the Playwright skill path only when real browser validation may be required.

## Spec

```text
You are the Spec stage for a Claude Code multi-agent pipeline.

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

**Agent tool call:**
```json
{
  "description": "Spec stage — produce spec.json",
  "subagent_type": "general-purpose",
  "model": "opus",
  "prompt": "<filled template above>"
}
```

## Plan

```text
You are the Plan stage for a Claude Code multi-agent pipeline.

Follow:
- <skill>/agents/plan.md
- <skill>/references/contracts.md

Inputs:
- spec.json:
<paste spec.json content>

Produce a full `plan.json`.
Return exactly one fenced `json` block and no extra prose.
```

**Agent tool call:**
```json
{
  "description": "Plan stage — produce plan.json",
  "subagent_type": "general-purpose",
  "model": "opus",
  "prompt": "<filled template above>"
}
```

## Architecture

```text
You are the Architecture stage for a Claude Code multi-agent pipeline.

Follow:
- <skill>/agents/architecture.md
- <skill>/references/contracts.md

Inputs:
- spec.json:
<paste spec.json content>
- plan.json:
<paste plan.json content>
- Repo root: <repo_root>

Use Glob, Grep, and Read tools to inspect the real codebase before deciding structure.
Produce `architecture.json`.
Return exactly one fenced `json` block and no extra prose.
```

**Agent tool call:**
```json
{
  "description": "Architecture stage — produce architecture.json",
  "subagent_type": "Explore",
  "model": "opus",
  "prompt": "<filled template above>"
}
```

## Architecture Rework

```text
You are the Architecture rework stage for a Claude Code multi-agent pipeline.

Follow:
- <skill>/agents/architecture.md
- <skill>/references/contracts.md

Inputs:
- spec.json:
<paste spec.json content>
- plan.json:
<paste plan.json content>
- current architecture.json:
<paste architecture.json content>
- latest execution-report.json: <paste content or omit>
- latest review_feedback.json: <paste content or omit>
- Repo root: <repo_root>

This is an upward rework pass. Decide whether architecture repair is sufficient or the plan must be redone.
Set `recommended_next_stage` and `rework_reason` correctly.
Return exactly one fenced `json` block and no extra prose.
```

## Execution

```text
You are the Execution stage for a Claude Code multi-agent pipeline.

Follow:
- <skill>/agents/execution.md
- <skill>/references/contracts.md
<only add the next line when browser validation may be required>
- <playwright_skill_path>/SKILL.md

Inputs:
- spec.json:
<paste spec.json content>
- plan.json:
<paste plan.json content>
- architecture.json:
<paste architecture.json content>
- latest review_feedback.json: <paste content or omit>
- Repo root: <repo_root>
- Iteration: <n>

Implement only within the ownership implied by `architecture.json`.
If the architecture cannot be implemented cleanly within constraints, return `status = "blocked"` and route upward with `recommended_next_stage` plus `rework_reason`.
Return exactly one fenced `json` block and no extra prose.
```

**Agent tool call:**
```json
{
  "description": "Execution stage iteration <n> — implement changes",
  "subagent_type": "general-purpose",
  "model": "opus",
  "prompt": "<filled template above>"
}
```

## Validation

```text
You are the Validation stage for a Claude Code multi-agent pipeline.

Follow:
- <skill>/agents/validation.md
- <skill>/references/contracts.md

Inputs:
- execution-report.json:
<paste execution-report.json content>
- Repo root: <repo_root>

Run `go vet ./...` and `go test ./...` against the repo root. Capture the full stdout, stderr, and exit code for each command.
Do not edit any files. Do not interpret results or make pass/fail recommendations beyond setting the `status` field.
Return exactly one fenced `json` block with `validation-report.json` and no extra prose.
```

**Agent tool call:**
```json
{
  "description": "Validation stage — run go vet and go test",
  "subagent_type": "general-purpose",
  "model": "sonnet",
  "prompt": "<filled template above>"
}
```

## Execution Sync Pass

```text
You are the Execution stage for a Claude Code multi-agent pipeline.

Follow:
- <skill>/agents/execution.md
- <skill>/references/contracts.md

Inputs:
- existing execution-report.json:
<paste execution-report.json content>
- Repo root: <repo_root>
- Missing main-workspace changes: <describe missing files or state>

This is a sync pass. Do not redesign the task. Land the intended implementation into the main workspace and then return an updated `execution-report.json`.
Return exactly one fenced `json` block and no extra prose.
```

## Review PRE

```text
You are reviewer <reviewer_id> for a Claude Code multi-agent pipeline in PRE mode.

Follow:
- <skill>/agents/review.md
- <skill>/references/contracts.md
- <skill>/references/pre-rubric.md
<only add the next line when browser validation may be required>
- <playwright_skill_path>/SKILL.md

Inputs:
- spec.json:
<paste spec.json content>
- architecture.json:
<paste architecture.json content>
- execution-report.json:
<paste execution-report.json content>
- validation-report.json:
<paste validation-report.json content>
- Repo root: <repo_root>
- Review mode: PRE

This stage is read-only. Score all 8 PRE dimensions, set `recommended_next_stage` and `rework_reason` when needed, and return exactly one fenced `json` block with `review_individual_N.json`.

For the Correctness and Test Coverage dimensions, you MUST reference `validation-report.json` test output as evidence. Do not score either dimension as `pass` without citing the validation report. If `validation-report.json` was not provided or its `status` is not `passed`, those two dimensions must be at most `warning`.

Do not return extra prose.
```

**Agent tool call:**
```json
{
  "description": "Review PRE — reviewer 1",
  "subagent_type": "general-purpose",
  "model": "opus",
  "prompt": "<filled template above>"
}
```

## Review EME (send all 3 in one message for parallel execution)

```text
You are reviewer <reviewer_id> for a Claude Code multi-agent pipeline in EME mode.

Follow:
- <skill>/agents/review.md
- <skill>/references/contracts.md
- <skill>/references/pre-rubric.md
<only add the next line when browser validation may be required>
- <playwright_skill_path>/SKILL.md

Inputs:
- spec.json:
<paste spec.json content>
- architecture.json:
<paste architecture.json content>
- execution-report.json:
<paste execution-report.json content>
- validation-report.json:
<paste validation-report.json content>
- Repo root: <repo_root>
- Review mode: EME
- Reviewer ID: <reviewer_id>

Review independently. Do not assume other reviewers will catch issues.

For the Correctness and Test Coverage dimensions, you MUST reference `validation-report.json` test output as evidence. Do not score either dimension as `pass` without citing the validation report. If `validation-report.json` was not provided or its `status` is not `passed`, those two dimensions must be at most `warning`.

Return exactly one fenced `json` block with `review_individual_N.json` and no extra prose.
```

**Agent tool calls (send all 3 in one response message):**
```json
[
  {
    "description": "EME reviewer 1",
    "subagent_type": "general-purpose",
    "model": "opus",
    "prompt": "<reviewer_id: 1>"
  },
  {
    "description": "EME reviewer 2",
    "subagent_type": "general-purpose",
    "model": "opus",
    "prompt": "<reviewer_id: 2>"
  },
  {
    "description": "EME reviewer 3",
    "subagent_type": "general-purpose",
    "model": "sonnet",
    "prompt": "<reviewer_id: 3>"
  }
]
```

## Plan Rework

```text
You are the Plan rework stage for a Claude Code multi-agent pipeline.

Follow:
- <skill>/agents/plan.md
- <skill>/references/contracts.md

Inputs:
- spec.json:
<paste spec.json content>
- latest execution-report.json: <paste content or omit>
- latest review_feedback.json: <paste content or omit>
- latest architecture.json: <paste content or omit>

This is a rework pass. Redo phase decomposition, dependency order, execution order, and ownership boundaries.
Produce a full replacement `plan.json`.
Return exactly one fenced `json` block and no extra prose.
```

## Doc

```text
You are the Doc stage for a Claude Code multi-agent pipeline.

Follow:
- <skill>/agents/doc.md
- <skill>/references/contracts.md

Inputs:
- spec.json:
<paste spec.json content>
- architecture.json:
<paste architecture.json content>
- execution-report.json:
<paste execution-report.json content>
- Repo root: <repo_root>

Update only the documentation that should change, including `CHANGELOG.md`.
Return exactly one fenced `json` block with `doc-report.json` and no extra prose.
```

**Agent tool call:**
```json
{
  "description": "Doc stage — update documentation",
  "subagent_type": "general-purpose",
  "model": "sonnet",
  "prompt": "<filled template above>"
}
```
