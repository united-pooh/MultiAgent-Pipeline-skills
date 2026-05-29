# Orchestrator Prompt Templates

Use these templates as default Codex `spawn_agent` prompt scaffolds. Fill the placeholders, delete irrelevant lines, and keep the final prompt short. Do not restate the entire skill; point the subagent at the stage prompt and contract files it must follow.

## Global Rules

- Always name the stage and the expected artifact.
- Pass artifact JSON inline when the subagent needs exact content; otherwise pass exact repo-relative or absolute paths.
- Tell the subagent to return exactly one fenced `json` block and no extra prose, except for the Spec stage, which returns two blocks: one `json` and one `markdown`.
- For retries or rework passes, name the triggering artifact and the current iteration.
- For `Execution` and `Review`, include the Playwright skill path only when real browser validation may be required.
- For `Spec` and `Plan`, attach the `superpowers` skill and explicitly restrict it to brainstorming/planning discipline.
- Use the stage profile's pinned model settings by default: `model: "gpt-5.5"`, `reasoning_effort: "xhigh"`, and `service_tier: "priority"`.
- The profile field names are camelCase (`reasoningEffort`, `serviceTier`); convert them to the `spawn_agent` snake_case fields when calling the tool.
- When using `fork_context: true`, omit `agent_type`, `model`, `reasoning_effort`, and `service_tier`; put the intended stage role in the prompt text.
- When a tool-level role matters, such as `worker`, spawn without a full-history fork and pass the needed context explicitly.
- Use `wait_agent` with `timeout_ms: 600000` whenever the next pipeline step is blocked on that result.

## Brainstorming

Brainstorming is orchestrator-local. Do not spawn a subagent for this stage.

Write the approved or user-implied design to `.pipeline-workspace/design.md`:

```markdown
## Objective
<what is being built and why>

## Chosen Approach
<agreed approach and rationale>

## Constraints
<technical or business constraints>

## Success Criteria
<testable done criteria>
```

## Spec

```text
You are the Spec stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/spec.md
- <skill>/references/contracts.md

Use the attached `superpowers` skill only for brainstorming and planning discipline. Do not use its build, TDD, commit, or finish-branch behaviors.

Inputs:
- design.md (brainstorming output):
<paste design.md content>

Context:
- Repo root: <repo_root>
- Existing constraints: <constraints_or_none>

Produce `spec.json` and `spec.md` (see agents/spec.md for format).
Return exactly two fenced blocks and no extra prose:
1. A `json` block with spec.json
2. A `markdown` block with spec.md (Chinese)
```

**spawn_agent call:**
```json
{
  "agent_type": "default",
  "fork_context": false,
  "items": [
    {"type": "skill", "name": "superpowers", "path": "<absolute_superpowers_skill_path>"},
    {"type": "text", "text": "<filled template above>"}
  ]
}
```

## Spec Retry

Use when the user requests changes to spec.md after reviewing it.

```text
You are the Spec stage (retry, iteration <n>) for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/spec.md
- <skill>/references/contracts.md

Use the attached `superpowers` skill only for brainstorming and planning discipline. Do not use its build, TDD, commit, or finish-branch behaviors.

Inputs:
- design.md (brainstorming output):
<paste design.md content>
- prior spec.md (user-reviewed, needs changes):
<paste prior spec.md content>
- prior spec.json:
<paste prior spec.json content>
- User feedback:
<paste user's requested changes>

Context:
- Repo root: <repo_root>

Revise `spec.json` and `spec.md` based on user feedback.
Return exactly two fenced blocks and no extra prose:
1. A `json` block with the updated spec.json
2. A `markdown` block with the updated spec.md (Chinese)
```

## Plan

```text
You are the Plan stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/plan.md
- <skill>/references/contracts.md

Use the attached `superpowers` skill only for planning discipline. Do not use its build, TDD, commit, or finish-branch behaviors.

Inputs:
- spec.json:
<paste spec.json content>

Produce a full `plan.json`.
Return exactly one fenced `json` block and no extra prose.
```

**spawn_agent call:**
```json
{
  "agent_type": "default",
  "fork_context": false,
  "items": [
    {"type": "skill", "name": "superpowers", "path": "<absolute_superpowers_skill_path>"},
    {"type": "text", "text": "<filled template above>"}
  ]
}
```

## Architecture

```text
You are the Architecture stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/architecture.md
- <skill>/references/contracts.md

Inputs:
- spec.json:
<paste spec.json content>
- plan.json:
<paste plan.json content>
- Repo root: <repo_root>

Inspect the real codebase with the available filesystem and search tools before deciding structure.
Produce `architecture.json`.
Return exactly one fenced `json` block and no extra prose.
```

**spawn_agent call:**
```json
{
  "agent_type": "default",
  "fork_context": false,
  "message": "<filled template above>"
}
```

## Dispatch

```text
You are the Dispatch stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/dispatch.md
- <skill>/references/contracts.md

Inputs:
- spec.json:
<paste spec.json content>
- plan.json:
<paste plan.json content>
- architecture.json:
<paste architecture.json content>

Partition work into dependency-respecting worker groups with explicit file ownership.
Derive `required_skills` only from `architecture.json.proposed_changes[].concerns`.
Produce `dispatch.json`.
Return exactly one fenced `json` block and no extra prose.
```

**spawn_agent call:**
```json
{
  "agent_type": "default",
  "fork_context": false,
  "message": "<filled template above>"
}
```

## Architecture Rework

```text
You are the Architecture rework stage for a Codex multi-agent pipeline.

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
You are the Execution stage for a Codex multi-agent pipeline.

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
- validation-report.json from the previous attempt: <paste content or omit>
- Repo root: <repo_root>
- Iteration: <n>

Implement only within the ownership implied by `architecture.json`.
You are not alone in the codebase; do not revert unrelated edits.
If the architecture cannot be implemented cleanly within constraints, return `status = "blocked"` and route upward with `recommended_next_stage` plus `rework_reason`.
Return exactly one fenced `json` block and no extra prose.
```

**spawn_agent call:**
```json
{
  "agent_type": "worker",
  "fork_context": false,
  "message": "<filled template above>"
}
```

## Validation

```text
You are the Validation stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/validation.md
- <skill>/references/contracts.md

Inputs:
- execution-report.json:
<paste execution-report.json content>
- complexity-report.json:
<paste complexity-report.json content>
- merge-report.json:
<paste merge-report.json content>
- Repo root: <repo_root>

Detect the project language, run the fix-layer and check-layer commands defined in agents/validation.md, and capture full stdout/stderr plus exit codes.
Do not edit files except through explicitly documented fix-layer commands.
Do not interpret results or make pass/fail recommendations beyond setting the `status` field.
Return exactly one fenced `json` block with `validation-report.json` and no extra prose.
```

**spawn_agent call:**
```json
{
  "agent_type": "worker",
  "fork_context": false,
  "message": "<filled template above>"
}
```

## Execution Sync Pass

```text
You are the Execution stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/execution.md
- <skill>/references/contracts.md

Inputs:
- existing execution-report.json:
<paste execution-report.json content>
- Repo root: <repo_root>
- Missing main-workspace changes: <describe missing files or state>

This is a sync pass. Do not redesign the task. Land the intended implementation into the assigned workspace and then return an updated `execution-report.json`.
Return exactly one fenced `json` block and no extra prose.
```

## Review PRE

```text
You are reviewer <reviewer_id> for a Codex multi-agent pipeline in PRE mode.

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
- complexity-report.json:
<paste complexity-report.json content>
- merge-report.json:
<paste merge-report.json content>
- validation-report.json:
<paste validation-report.json content>
- Repo root: <repo_root>
- Review mode: PRE

This stage is read-only. Score all 8 PRE dimensions, set `recommended_next_stage` and `rework_reason` when needed, and return exactly one fenced `json` block with `review_individual_N.json`.

For the Correctness and Test Coverage dimensions, you MUST reference `validation-report.json` test output as evidence. Do not score either dimension as `pass` without citing the validation report. If `validation-report.json` was not provided or its `status` is neither `passed` nor `skipped`, those two dimensions must be at most `warning`.

Do not return extra prose.
```

**spawn_agent call:**
```json
{
  "agent_type": "default",
  "fork_context": false,
  "message": "<filled template above>"
}
```

## Review EME

Spawn all 3 reviewers before waiting on them.

```text
You are reviewer <reviewer_id> for a Codex multi-agent pipeline in EME mode.

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
- complexity-report.json:
<paste complexity-report.json content>
- merge-report.json:
<paste merge-report.json content>
- validation-report.json:
<paste validation-report.json content>
- Repo root: <repo_root>
- Review mode: EME
- Reviewer ID: <reviewer_id>

Review independently. Do not assume other reviewers will catch issues.

For the Correctness and Test Coverage dimensions, you MUST reference `validation-report.json` test output as evidence. Do not score either dimension as `pass` without citing the validation report. If `validation-report.json` was not provided or its `status` is neither `passed` nor `skipped`, those two dimensions must be at most `warning`.

Return exactly one fenced `json` block with `review_individual_N.json` and no extra prose.
```

**spawn_agent calls:**
```json
[
  {"agent_type": "default", "fork_context": false, "message": "<reviewer_id: 1>"},
  {"agent_type": "default", "fork_context": false, "message": "<reviewer_id: 2>"},
  {"agent_type": "default", "fork_context": false, "message": "<reviewer_id: 3>"}
]
```

## Plan Rework

```text
You are the Plan rework stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/plan.md
- <skill>/references/contracts.md

Use the attached `superpowers` skill only for planning discipline. Do not use its build, TDD, commit, or finish-branch behaviors.

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

## QA

```text
You are the QA stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/qa.md
- <skill>/references/contracts.md

Inputs:
- spec.json:
<paste spec.json content>
- architecture.json:
<paste architecture.json content>
- execution-report.json:
<paste execution-report.json content>
- complexity-report.json:
<paste complexity-report.json content>
- validation-report.json:
<paste validation-report.json content>
- review_feedback.json:
<paste review_feedback.json content>
- merge-report.json:
<paste merge-report.json content>
- Repo root: <repo_root>

Run dynamic or scenario validation that is not already covered by command-layer Validation.
Return exactly one fenced `json` block with `qa-report.json` and no extra prose.
```

**spawn_agent call:**
```json
{
  "agent_type": "worker",
  "fork_context": false,
  "message": "<filled template above>"
}
```

## Doc

```text
You are the Doc stage for a Codex multi-agent pipeline.

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
- complexity-report.json:
<paste complexity-report.json content>
- validation-report.json:
<paste validation-report.json content>
- review_feedback.json:
<paste review_feedback.json content>
- qa-report.json:
<paste qa-report.json content>
- Repo root: <repo_root>

Update only the documentation that should change, including `CHANGELOG.md` when the repository has one.
Return exactly one fenced `json` block with `doc-report.json` and no extra prose.
```

**spawn_agent call:**
```json
{
  "agent_type": "worker",
  "fork_context": false,
  "message": "<filled template above>"
}
```

## Final Assessment

```text
You are the Final Assessment stage for a Codex multi-agent pipeline.

Follow:
- <skill>/agents/final-assessment.md
- <skill>/references/contracts.md

Inputs:
- spec.json and spec.md:
<paste contents>
- plan.json:
<paste plan.json content>
- architecture.json:
<paste architecture.json content>
- dispatch.json:
<paste dispatch.json content>
- all execution reports:
<paste execution reports>
- all complexity reports:
<paste complexity reports>
- all merge reports:
<paste merge reports>
- all validation reports:
<paste validation reports>
- all review feedback artifacts:
<paste review feedback>
- all QA reports:
<paste QA reports>
- doc-report.json:
<paste doc-report.json content>
- Repo root: <repo_root>

Evaluate the complete delivered change and choose `accept` or the earliest correct restart point. Include definite `readability_conclusion` and `complexity_conclusion` values.
Return exactly one fenced `json` block with `final-assessment.json` and no extra prose.
```

**spawn_agent call:**
```json
{
  "agent_type": "default",
  "fork_context": false,
  "message": "<filled template above>"
}
```
