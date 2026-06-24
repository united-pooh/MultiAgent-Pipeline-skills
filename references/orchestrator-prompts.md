# Orchestrator Prompt Templates

Use these templates as default host-specific stage prompt scaffolds. Fill the placeholders, delete irrelevant lines, and keep the final prompt short. Do not restate the entire skill; point the subagent at the stage prompt and contract files it must follow.

## Global Rules

- Always name the stage and the expected artifact.
- Include the current stage's `templates/artifacts/<artifact>.json` path as the
  JSON skeleton alongside `references/contracts.md`.
- Pass artifact JSON inline when the subagent needs exact content; otherwise pass exact repo-relative or absolute paths.
- Tell the subagent to return exactly one fenced `json` block and no extra prose, except for the Spec stage, which returns two blocks: one `json` and one `markdown`.
- For retries or rework passes, name the triggering artifact and the current iteration.
- For `Execution`, request real browser validation only when it may be required
  and suitable tooling is available.
- For `Spec` and `Plan`, use skill-internal methodology references under
  `references/methodologies/`; do not rely on external methodology packages.
- The orchestrator/main agent must never modify code or repo files directly.
  It may read code, dispatch stages, write pipeline workspace bookkeeping, validate
  artifacts, aggregate feedback, and report.
- File/code mutations are only allowed in Execution-stage worker subagents.
- Validation, QA, Doc, Tree Rubrics, Tree Grading, Review, Final Assessment,
  and every other non-Execution stage are read-only; send failures and feedback
  back to Execution for repair.
- Maintain one global 6-slot subagent pool across Execution, Validation, Tree
  Rubrics, Tree Grading, and QA. Every spawned subagent in those stages consumes
  one slot until it finishes.
- Dispatch fanout is capped at 6 groups per wave and should maximize safe
  concurrency up to 6 without inventing unsafe splits.
- Let finished groups continue early into Validation, Tree Rubrics, Tree
  Grading, and QA as soon as dependencies are satisfied and slots are
  available; do not wait for the whole execution wave.
- Tree Grading consumes 3 slots by default. Wait until 3 slots are available,
  then spawn the 3 graders together.
- Select the host adapter first. Codex and OpenCode use the same stage prompts and contracts but different tool schemas.

## Codex Adapter

Use this adapter in Codex Desktop or Codex CLI.

- Use `spawn_agent` for delegated stages and `wait_agent` for blocking waits.
- Use the stage profile's pinned model settings by default: `model: "gpt-5.5"`, `reasoning_effort: "xhigh"`, and `service_tier: "priority"`.
- The profile field names are camelCase (`reasoningEffort`, `serviceTier`); convert them to the `spawn_agent` snake_case fields when calling the tool.
- When using `fork_context: true`, omit `agent_type`, `model`, `reasoning_effort`, and `service_tier`; put the intended stage role in the prompt text.
- When a tool-level role matters, such as `worker`, spawn without a full-history fork and pass the needed context explicitly.
- Use `wait_agent` with `timeout_ms: 600000` whenever the next pipeline step is blocked on that result.
- `DEFAULT_CODEX_STAGE_PROFILES` in `src/runtime/constants.js` is the runtime default.

## OpenCode Expert Adapter

Use this adapter from the custom primary agent documented in
`references/opencode-expert-mode.md` and `templates/opencode-expert-agent.md`.

- OpenCode does not use Codex's `spawn_agent` schema. Do not pass Codex-only fields such as `agent_type`, `service_tier`, or `fork_context`.
- Invoke stage workers through OpenCode's Task/subagent mechanism when host permissions allow it.
- Keep the expert agent as the primary orchestrator; subagents produce bounded artifacts or proposals.
- Configure `permission.skill` so `multi-agent-pipeline` can load through the native `skill` tool.
- Configure `permission.task` so the expert agent can call the intended subagents.
- Translate the current stage profile from `DEFAULT_OPENCODE_EXPERT_STAGE_PROFILES` into the local OpenCode agent/task call shape.
- If the active OpenCode setup cannot provide safe subagent delegation, preserve the stage order locally and record the limitation in the run summary.
- Continue to read only the current stage prompt plus required references; do not paste the whole skill into a subagent prompt.

## Brainstorming

Brainstorming is orchestrator-local. Do not spawn a subagent for this stage.
Follow `references/methodologies/brainstorming.md`.

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
You are the Spec stage for a multi-agent pipeline.

Follow:
- <skill>/agents/spec.md
- <skill>/references/contracts.md
- <skill>/references/methodologies/brainstorming.md
- <skill>/references/methodologies/superpowers.md

Use only the repo-owned internal methodology context. Do not rely on host
methodology packages. Record `applied_skills: []`.

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
    {"type": "text", "text": "<filled template above>"}
  ]
}
```

## Spec Retry

Use when the user requests changes to spec.md after reviewing it.

```text
You are the Spec stage (retry, iteration <n>) for a multi-agent pipeline.

Follow:
- <skill>/agents/spec.md
- <skill>/references/contracts.md
- references/methodologies/brainstorming.md
- references/methodologies/superpowers.md

Use only the repo-owned internal methodology context. Do not rely on host
methodology packages. Record `applied_skills: []`.

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
You are the Plan stage for a multi-agent pipeline.

Follow:
- <skill>/agents/plan.md
- <skill>/references/contracts.md
- references/methodologies/superpowers.md

Use only the repo-owned internal methodology context. Do not rely on host
methodology packages. Record `applied_skills: []`.

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
    {"type": "text", "text": "<filled template above>"}
  ]
}
```

## Architecture

```text
You are the Architecture stage for a multi-agent pipeline.

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
You are the Dispatch stage for a multi-agent pipeline.

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
Each execution wave must contain at most 6 groups. Maximize safe concurrency up
to 6 groups, merge excess independent components by affinity, and never invent
unsafe splits.
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
You are the Architecture rework stage for a multi-agent pipeline.

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
- latest tree_grading_feedback.json: <paste content or omit>
- Repo root: <repo_root>

This is an upward rework pass. Decide whether architecture repair is sufficient or the plan must be redone.
Set `recommended_next_stage` and `rework_reason` correctly.
Return exactly one fenced `json` block and no extra prose.
```

## Execution

```text
You are the Execution stage for a multi-agent pipeline.

Follow:
- <skill>/agents/execution.md
- <skill>/references/contracts.md
<only add the next line when worker_group.required_skills includes ce-frontend-design>
- references/methodologies/frontend-design.md

Inputs:
- spec.json:
<paste spec.json content>
- plan.json:
<paste plan.json content>
- architecture.json:
<paste architecture.json content>
- assigned worker_group from dispatch.json:
<paste worker_group content>
- base_ref:
<paste base_ref>
- latest tree_grading_feedback.json: <paste content or omit>
- validation-report.json from the previous attempt: <paste content or omit>
- qa-report.json from the previous attempt: <paste content or omit>
- Repo root: <repo_root>
- Iteration: <n>

Implement only within `worker_group.owned_files` plus directly adjacent tests or docs needed for this group.
You are the only stage with repo file write authority. File/code mutations are only allowed in Execution-stage worker subagents.
When `worker_group.required_skills` includes `ce-frontend-design`, apply the internal frontend-design capability guidance and record `ce-frontend-design` in `applied_skills`.
You are not alone in the codebase; do not revert unrelated edits.
On retries, you may add related same-group local goals inside the same ownership boundary.
If the fix requires unowned files, cross-group ownership changes, or a different worker split, return `status = "blocked"` and start the first blocker with `REPLAN_REQUIRED:`.
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
You are the Validation stage for a multi-agent pipeline.

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

Validation is read-only. Detect the project language, run the check-layer commands defined in agents/validation.md, and capture full stdout/stderr plus exit codes.
Do not edit files or run formatter, auto-fix, auto-correct, code generation, dependency installation, or other repo-mutating commands.
If checks fail, record `blocking_failures`; the orchestrator passes failed `validation-report.json` back to Execution, and Execution owns retry work.
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
You are the Execution stage for a multi-agent pipeline.

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

## Tree Rubrics Generation And Grading

Run these stages after Validation passes or skips for a worker group. A group
may enter this sequence as soon as it is ready and a global pool slot is
available, even when other groups from the same execution wave are still
running.

### Tree Classification

```text
Follow:
- <skill>/agents/tree-classification.md
- <skill>/references/contracts.md

Inputs:
- spec.json:
<paste spec.json content>
- architecture.json:
<paste architecture.json content>
- worker_group:
<paste worker group>
- Iteration: <iteration>

Return exactly one fenced `json` block with `classification.json` and no extra prose.
```

### Tree Rubric Generation

```text
Follow:
- <skill>/agents/tree-rubric-generation.md
- <skill>/references/contracts.md

Inputs:
- spec.json:
<paste spec.json content>
- architecture.json:
<paste architecture.json content>
- worker_group:
<paste worker group>
- classification.json:
<paste classification.json content>

Return exactly one fenced `json` block with `tree_rubrics.json` and no extra prose.
```

### Tree Rubric Verification

```text
Follow:
- <skill>/agents/tree-rubric-verification.md
- <skill>/references/contracts.md

Inputs:
- spec.json:
<paste spec.json content>
- worker_group:
<paste worker group>
- classification.json:
<paste classification.json content>
- tree_rubrics.json:
<paste tree_rubrics.json content>

Return exactly one fenced `json` block with `validation_result.json` and no extra prose.
```

### Tree Rubric Refinement

```text
Follow:
- <skill>/agents/tree-rubric-refinement.md
- <skill>/references/contracts.md

Inputs:
- spec.json:
<paste spec.json content>
- worker_group:
<paste worker group>
- classification.json:
<paste classification.json content>
- tree_rubrics.json:
<paste tree_rubrics.json content>
- validation_result.json:
<paste validation_result.json content>

Return exactly one fenced `json` block with `tree_rubrics_refined.json` and no extra prose.
```

### Tree Grading

Tree Grading consumes 3 global pool slots by default. Wait until all 3 slots
are available, then spawn all 3 graders before waiting on them.

```text
Follow:
- <skill>/agents/tree-grading.md
- <skill>/references/contracts.md

Inputs:
- spec.json:
<paste spec.json content>
- worker_group:
<paste worker group>
- tree_rubrics_refined.json:
<paste tree_rubrics_refined.json content>
- final-output-files.json:
<paste final-output-files.json content>
- Grader ID: <grader_id>
- Iteration: <iteration>

Only use the final output file contents. Do not use execution, merge, validation, complexity, logs, retries, or tool traces.
This stage is read-only. Do not edit files; failing rubric evidence goes back to Execution for repair.
Return exactly one fenced `json` block with `tree_grading_individual_N.json` and no extra prose.
```

**spawn_agent calls:**
```json
[
  {"agent_type": "default", "fork_context": false, "message": "<grader_id: 1>"},
  {"agent_type": "default", "fork_context": false, "message": "<grader_id: 2>"},
  {"agent_type": "default", "fork_context": false, "message": "<grader_id: 3>"}
]
```

## Review PRE

Deprecated compatibility path. The current pipeline uses Tree Rubrics Generation And Grading instead.

```text
You are reviewer <reviewer_id> for a multi-agent pipeline in PRE mode.

Follow:
- <skill>/agents/review.md
- <skill>/references/contracts.md
- <skill>/references/pre-rubric.md

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
- Browser evidence: <paste evidence or say unavailable>

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
You are reviewer <reviewer_id> for a multi-agent pipeline in EME mode.

Follow:
- <skill>/agents/review.md
- <skill>/references/contracts.md
- <skill>/references/pre-rubric.md

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
- Browser evidence: <paste evidence or say unavailable>

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
You are the Plan rework stage for a multi-agent pipeline.

Follow:
- <skill>/agents/plan.md
- <skill>/references/contracts.md
- references/methodologies/superpowers.md

Use only the repo-owned internal methodology context. Do not rely on host
methodology packages. Record `applied_skills: []`.

Inputs:
- spec.json:
<paste spec.json content>
- latest execution-report.json: <paste content or omit>
- latest tree_grading_feedback.json: <paste content or omit>
- latest architecture.json: <paste content or omit>

This is a rework pass. Redo phase decomposition, dependency order, execution order, and ownership boundaries.
Produce a full replacement `plan.json`.
Return exactly one fenced `json` block and no extra prose.
```

## QA

```text
You are the QA stage for a multi-agent pipeline.

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
- tree_grading_feedback.json:
<paste tree_grading_feedback.json content>
- merge-report.json:
<paste merge-report.json content>
- Repo root: <repo_root>

Run dynamic or scenario validation that is not already covered by command-layer Validation.
QA is read-only. Do not modify source, generated files, documentation, config, lockfiles, or repo-local fixtures; use external temporary locations when scenario tooling requires scratch files.
If QA finds a blocking issue, record the same-group repair evidence or
ownership/dependency concern in `blocking_issues` and `notes`. The orchestrator
passes failed `qa-report.json` to Execution; Execution owns retry work and emits
`REPLAN_REQUIRED:` as its first blocker when a different ownership split or
re-dispatch is required.
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
You are the Doc stage for a multi-agent pipeline.

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
- tree_grading_feedback.json:
<paste tree_grading_feedback.json content>
- qa-report.json:
<paste qa-report.json content>
- Repo root: <repo_root>

Doc is read-only. Audit documentation that should change, including `CHANGELOG.md` when the repository has one, but do not edit files.
If documentation changes are required, return `status = "changes_required"`, list the required documentation paths in `updated_files`, and explain the needed Execution repair in `notes`.
Do not commit or push; the orchestrator owns optional Git publication after integration.
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
You are the Final Assessment stage for a multi-agent pipeline.

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
- all tree grading feedback artifacts:
<paste tree grading feedback>
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
