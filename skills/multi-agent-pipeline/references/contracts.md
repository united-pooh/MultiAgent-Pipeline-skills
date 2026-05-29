# JSON Contract Schemas

All canonical pipeline artifacts are written by the orchestrator into `.pipeline-workspace/`, except `.pipeline-last-run-summary.json`, which lives at the repository root. Subagents return JSON matching these contracts; the orchestrator validates and persists them.

## design.md

Produced by: **Orchestrator** (Brainstorming stage)
Consumed by: **Spec Agent**

Free-form Markdown document capturing the agreed design from the brainstorming dialogue. The language matches the conversation language. Written to `.pipeline-workspace/design.md` by the orchestrator after the design is approved or after a concrete user request already implies approval to proceed.

### Format

```markdown
## Objective
[One paragraph describing what is being built and why]

## Chosen Approach
[The approach agreed on, with brief rationale]

## Constraints
[Technical or business constraints identified during dialogue]

## Success Criteria
[What "done" looks like — testable, concrete]
```

### Notes

- This is a pipeline-internal artifact. Do not write it to the codebase `docs/` directory.
- The language should match the conversation language.
- The orchestrator may add or expand sections if the brainstorming dialogue surfaces additional relevant structure.

---

## spec.json

Produced by: **Spec Agent** (reads `design.md` from Brainstorming stage)
Consumed by: **Plan Agent**, **Architecture Agent**, **Dispatch Agent**, **Execution Agent**, **Validation Agent**, **Review Agent**, **QA Agent**, **Doc Agent**, **Final Assessment Agent**

```json
{
  "version": "1.0",
  "applied_skills": ["superpowers"],
  "feature_name": "string — concise feature title",
  "objective": "string — one-paragraph goal description",
  "requirements": [
    {
      "id": "REQ-001",
      "description": "string — what must be achieved",
      "priority": "must-have | should-have | nice-to-have",
      "acceptance_criteria": [
        "string — specific, testable criterion"
      ]
    }
  ],
  "constraints": [
    "string — technical or business constraint"
  ],
  "out_of_scope": [
    "string — explicitly excluded items"
  ],
  "assumptions": [
    "string — reasonable assumptions made to avoid blocking"
  ],
  "input_type": "natural_language | document",
  "original_input_summary": "string — distilled version of the user's original input"
}
```

### Field Rules

- `applied_skills`: Must include `superpowers` exactly once for this pipeline.
- `id`: Sequential, prefixed with `REQ-`. Start from `REQ-001`.
- `priority`: Every requirement must have one. Default to `must-have` if unclear.
- `acceptance_criteria`: At least one per requirement. Must be objectively verifiable.
- `constraints`: Include backward compatibility, performance budgets, or API contracts that must not break.
- `out_of_scope`: Helps downstream agents avoid scope creep.
- `assumptions`: Use for low-risk inferences that the orchestrator can surface if needed. Empty array when not needed.

---

## spec.md

Produced by: **Spec Agent**
Consumed by: **User** (approval gate before Plan stage)

Human-readable Chinese specification document. Presented to the user by the orchestrator for explicit approval when the run is approval-driven.

### Format

```markdown
# [功能名称] 规格说明

## 目标
[一段话说明要做什么、为什么要做]

## 需求

### REQ-001：[标题]
- **优先级：** 必须有 / 应该有 / 可以有
- **描述：** [需求内容]
- **设计理由：** [为什么需要这个需求，背景和动机]
- **验收标准：**
  - [具体可测试的标准1]
  - [具体可测试的标准2]

### REQ-002：[标题]
- **优先级：** 必须有 / 应该有 / 可以有
- **描述：** [需求内容]
- **设计理由：** [为什么需要这个需求，背景和动机]
- **验收标准：**
  - [具体可测试的标准1]

## 约束
- [约束项]：[为什么存在这个约束]

## 范围外
- [排除项]：[为什么不做]

## 假设
- [假设内容]：[依据]
```

### Field Rules

- Language: Chinese throughout.
- `优先级` values: `must-have` -> `必须有`, `should-have` -> `应该有`, `nice-to-have` -> `可以有`.
- `设计理由`: Required for every requirement. Explains motivation, not just what.
- Every constraint and out-of-scope item must include a brief inline reason after the colon.
- REQ IDs must match exactly with corresponding entries in `spec.json`.
- If there are no assumptions, omit the `## 假设` section entirely.

---

## plan.json

Produced by: **Plan Agent**
Consumed by: **Architecture Agent**, **Dispatch Agent**, **Execution Agent**, **Final Assessment Agent**

```json
{
  "version": "1.0",
  "applied_skills": ["superpowers"],
  "spec_ref": "spec.json",
  "phases": [
    {
      "id": "PHASE-1",
      "name": "string — phase title",
      "tasks": [
        {
          "id": "TASK-001",
          "description": "string — specific, actionable task",
          "depends_on": ["TASK-ID"],
          "estimated_complexity": "low | medium | high",
          "target_files": ["string — file paths"]
        }
      ]
    }
  ],
  "execution_order": ["TASK-001", "TASK-002"],
  "risk_items": [
    "string — potential risks and mitigations"
  ]
}
```

### Field Rules

- `applied_skills`: Must include `superpowers` exactly once for this pipeline.
- `id`: Tasks use `TASK-NNN`, phases use `PHASE-N`.
- `depends_on`: References other task IDs. Empty array if no dependencies.
- `execution_order`: Flattened topological sort of all tasks respecting dependencies.
- `target_files`: Best-effort list of files that will be touched. Architecture Agent may refine this.
- `risk_items`: At least one entry. If no significant risks exist, say so explicitly with rationale.

---

## architecture.json

Produced by: **Architecture Agent**
Consumed by: **Dispatch Agent**, **Execution Agent**, **Review Agent**, **QA Agent**, **Doc Agent**, **Final Assessment Agent**

```json
{
  "version": "1.0",
  "spec_ref": "spec.json",
  "plan_ref": "plan.json",
  "codebase_analysis": {
    "relevant_modules": ["string — directory or module paths"],
    "current_patterns": ["string — design patterns currently in use"],
    "tech_debt": ["string — relevant tech debt discovered"]
  },
  "decision": "refactor | incremental | hybrid",
  "decision_rationale": "string — why this strategy was chosen over alternatives",
  "proposed_changes": [
    {
      "target": "string — file path",
      "change_type": "modify | create | delete | move",
      "description": "string — what changes and why",
      "concerns": ["frontend_design"]
    }
  ],
  "dependency_changes": [
    {
      "action": "add | remove | upgrade",
      "package": "string",
      "reason": "string"
    }
  ],
  "feasibility": "feasible | infeasible",
  "infeasibility_reason": "string | null — required if infeasible",
  "rollback_notes": "string | null — required if infeasible"
}
```

### Field Rules

- `decision`: Choose based on analysis — `incremental` for small changes that fit current structure, `refactor` for structural changes, `hybrid` for mixed cases.
- `proposed_changes[].concerns`: Use `frontend_design` when a change affects page layouts, components, styles, themes, design tokens, animation, interaction copy, responsive layout, visual hierarchy, design-system consistency, or UI accessibility. Use an empty array when no skill-routing concern exists.
- `concerns`: Routing concerns are assigned only by Architecture. Downstream stages must not re-infer them.
- `feasibility`: Set to `infeasible` only when delivery would violate stated constraints or require unreasonable restructuring.
- `infeasibility_reason` and `rollback_notes`: Must be non-null when `feasibility` is `infeasible`. Must be `null` when `feasible`.
- `dependency_changes`: Empty array if no dependency changes are needed.

---

## dispatch.json

Produced by: **Dispatch Agent**
Consumed by: **Execution Agent**, **QA Agent**, **Final Assessment Agent**, **Orchestrator**

```json
{
  "version": "1.0",
  "spec_ref": "spec.json",
  "plan_ref": "plan.json",
  "architecture_ref": "architecture.json",
  "worker_groups": [
    {
      "group_id": "GROUP-1",
      "tasks": ["TASK-001", "TASK-003"],
      "owned_files": ["src/handler.go", "src/handler_test.go"],
      "depends_on_groups": [],
      "required_skills": ["ce-frontend-design"]
    }
  ],
  "execution_waves": [
    {
      "wave": 1,
      "groups": ["GROUP-1", "GROUP-2"]
    }
  ],
  "integration_strategy": {
    "merge_mode": "three_way",
    "conflict_policy": "pause_for_human",
    "base_strategy": "wave_start_snapshot"
  },
  "rationale": "string — explanation of grouping decisions and any tradeoffs"
}
```

### Field Rules

- `worker_groups`: Each group contains one or more tasks from `plan.json` and the files those tasks own, derived from `architecture.json.proposed_changes`. No file may appear in more than one group's `owned_files` within the same execution wave.
- `depends_on_groups`: References other group IDs. A group can only begin execution after all groups it depends on have completed. Empty array when no inter-group dependency exists.
- `required_skills`: Deterministic union of `concerns` for the files owned by that group. Map `frontend_design` to `ce-frontend-design`. Use an empty array when no routed skill is required.
- `execution_waves`: Groups with no unresolved `depends_on_groups` run in the same wave. Waves execute sequentially; groups within a wave execute concurrently. At least one wave must be produced.
- `integration_strategy`: Must always be `{ "merge_mode": "three_way", "conflict_policy": "pause_for_human", "base_strategy": "wave_start_snapshot" }` in this pipeline version.
- `rationale`: A plain-language explanation of why the tasks were grouped this way and what tradeoffs were made.

---

## execution-report.json

Produced by: **Execution Agent**
Consumed by: **Complexity Hook**, **Merge Stage**, **Validation Agent**, **Review Agent**, **QA Agent**, **Doc Agent**, **Final Assessment Agent**, **Orchestrator**

```json
{
  "version": "1.0",
  "group_id": "GROUP-1",
  "iteration": 1,
  "base_ref": "bases/wave-1-group-1-base.json",
  "proposal_ref": "worker://GROUP-1/iteration-1",
  "applied_skills": ["ce-frontend-design"],
  "status": "implemented | blocked",
  "changed_files": ["string — repo-relative file paths"],
  "requirements_covered": ["REQ-001"],
  "frontend_design_summary": {
    "system_mode": "existing_system | partial_system | greenfield | ambiguous",
    "visual_thesis": "string — one-sentence visual direction",
    "content_plan": "string — concise page or component structure plan",
    "interaction_plan": [
      "string — specific motion or interaction idea"
    ],
    "visual_verification_method": "string — screenshot, Playwright, mental review, or skip reason",
    "visual_verification_result": "string — what was verified or why it was skipped"
  },
  "tests_run": [
    {
      "command": "string — exact command",
      "status": "passed | failed | not_run",
      "details": "string — concise outcome"
    }
  ],
  "follow_up_notes": [
    "string — risks, caveats, or rationale"
  ],
  "blockers": [
    "string — required when status is blocked"
  ]
}
```

### Field Rules

- `group_id`: Must match one entry in `dispatch.json.worker_groups[].group_id`.
- `iteration`: Starts at 1 and matches the current execution/merge/review loop.
- `base_ref`: Reference to the wave-start snapshot used by the orchestrator for three-way merge.
- `proposal_ref`: Reference to the worker proposal the orchestrator will merge. It may point to an uploaded patch, fork workspace handle, or equivalent proposal artifact.
- `applied_skills`: Include `ce-frontend-design` when `dispatch.json.worker_groups[].required_skills` includes it. Otherwise use an empty array.
- `status`: `implemented` means the proposal is ready for merge. `blocked` means the worker cannot proceed.
- `changed_files`: Must reflect actual touched files.
- `requirements_covered`: Reference requirement IDs from `spec.json`.
- `frontend_design_summary`: Must be non-null when `applied_skills` includes `ce-frontend-design`. Must be `null` when no frontend-design routing applied.
- `tests_run`: Include every command attempted. Use `not_run` only when a test was intentionally skipped.
- `blockers`: Empty array when `status` is `implemented`.

---

## complexity-report.json

Produced by: **Orchestrator (post-Execution Complexity Hook)**
Consumed by: **Validation Agent**, **Review Agent**, **QA Agent**, **Doc Agent**, **Final Assessment Agent**, **Orchestrator**

```json
{
  "version": "1.0",
  "group_id": "GROUP-1",
  "iteration": 1,
  "created_at": "2026-05-28T00:00:00.000Z",
  "analyzer": {
    "name": "better_highlights_cognitive_repro",
    "path": "scripts/better_highlights_cognitive_repro.py",
    "metric": "better-highlights-like cognitive complexity approximation",
    "medium_threshold": 15,
    "high_threshold": 25
  },
  "source": {
    "proposal_path": "/tmp/worker-proposal",
    "changed_files": ["src/app.py"]
  },
  "status": "completed | skipped | error",
  "analyzed_files": [
    {
      "file": "src/app.py",
      "source_path": "src/app.py",
      "function_count": 2
    }
  ],
  "skipped_files": [
    {
      "file": "README.md",
      "reason": "not_python | invalid_path | missing_in_proposal | missing_in_repo"
    }
  ],
  "errors": [
    {
      "file": "src/app.py",
      "message": "string — analyzer error",
      "exit_code": 1,
      "stdout": "string",
      "stderr": "string"
    }
  ],
  "function_count": 2,
  "max_total_points": 18,
  "average_total_points": 9,
  "medium_complexity_functions": 1,
  "high_complexity_functions": 0,
  "readability_conclusion": "high | low",
  "complexity_conclusion": "high | low",
  "summary": "string — definite readability and complexity conclusion",
  "functions": [
    {
      "file": "src/app.py",
      "function": "Controller.handle",
      "analyzer_function": "app.py:Controller.handle",
      "loop_points": 4,
      "if_points": 8,
      "logical_points": 1,
      "other_points": 5,
      "total_points": 18,
      "level": "low | medium | high"
    }
  ]
}
```

### Field Rules

- `group_id` and `iteration`: Must match the Execution artifact that triggered the hook.
- `source.changed_files`: Copy from `execution-report.json.changed_files`.
- `status`: `completed` when at least one Python changed file was analyzed, `skipped` when no Python changed file was analyzable, and `error` when the analyzer failed for one or more Python files.
- `skipped_files`: Non-Python files must be listed with `reason = "not_python"` rather than treated as failures.
- `functions`: Sorted analyzer output for changed Python files only. Empty array is valid for `skipped` or `error`.
- `readability_conclusion`: Must be exactly `high` or `low`. Use `low` whenever analyzer errors occur or complexity is high.
- `complexity_conclusion`: Must be exactly `high` or `low`. Use `high` when any analyzed function is high complexity, the report average reaches the medium threshold, or analyzer errors prevent a reliable score.
- `summary`: Must state the readability and complexity conclusions plainly.

---

## merge-report.json

Produced by: **Orchestrator (Merge Stage)**
Consumed by: **Review Agent**, **QA Agent**, **Final Assessment Agent**, **Orchestrator**

```json
{
  "version": "1.0",
  "group_id": "GROUP-1",
  "iteration": 1,
  "base_ref": "bases/wave-1-group-1-base.json",
  "mainline_ref": "workspace://main-before-merge",
  "proposal_ref": "worker://GROUP-1/iteration-1",
  "result_ref": "workspace://main-after-merge",
  "status": "merged | conflicted | noop",
  "conflicts": [
    {
      "file": "src/app.tsx",
      "format": "text | json | yaml | binary | spreadsheet | presentation | image | other",
      "conflict_type": "same_hunk | same_key | array_conflict | binary_conflict | manual_only | other",
      "summary": "string — concise description of what collided",
      "left_ref": "string — proposal-side reference",
      "right_ref": "string — mainline-side reference",
      "base_ref": "string — conflict base reference"
    }
  ]
}
```

### Field Rules

- `status`: `merged` when three-way merge completed safely, `noop` when the proposal produced no effective change, `conflicted` when merge must pause for human resolution.
- `result_ref`: Reference to the merged mainline snapshot or conflict bundle produced by the merge stage.
- `conflicts`: Must be empty when `status` is `merged` or `noop`. Must contain at least one entry when `status` is `conflicted`.
- Re-running merge with the same `{base_ref, mainline_ref, proposal_ref}` must produce the same `status` and materially equivalent `conflicts`.

---

## conflict-resolution.json

Produced by: **Human Orchestrator Flow**
Consumed by: **Final Assessment Agent**, **Orchestrator**

```json
{
  "version": "1.0",
  "merge_report_ref": "merge/GROUP-1/iteration-1-merge-report.json",
  "resolver": "string — person, role, or automation that resolved the conflict",
  "resolution_summary": "string — what was decided and why",
  "resolved_files": ["src/app.tsx"],
  "validation_run": [
    {
      "command": "string — exact command or manual verification step",
      "status": "passed | failed | not_run",
      "details": "string — concise outcome"
    }
  ]
}
```

### Field Rules

- `merge_report_ref`: Must point to a `merge-report.json` whose `status` is `conflicted`.
- `resolved_files`: List every file touched during manual conflict resolution.
- `validation_run`: Record the checks performed before resuming from the merge point.

---

## classification.json

Produced by: **Tree Classification Agent**
Consumed by: **Tree Rubric Generation Agent**, **Tree Rubric Refinement Agent**, **Orchestrator**

```json
{
  "version": "1.0",
  "task_id": "GROUP-1-task",
  "group_id": "GROUP-1",
  "task_type": "code_implementation",
  "depth_enhancement_applicable": true,
  "recommended_branches": [
    {
      "name": "功能正确性",
      "name_en": "Correctness",
      "rationale": "Why this branch is independent and useful"
    }
  ],
  "summary": "string"
}
```

---

## tree_rubrics.json and tree_rubrics_refined.json

Produced by: **Tree Rubric Generation Agent** and **Tree Rubric Refinement Agent**
Consumed by: **Tree Rubric Verification Agent**, **Tree Grading Agent**, **Orchestrator**

```json
{
  "version": "1.0",
  "task_id": "GROUP-1-task",
  "group_id": "GROUP-1",
  "task_type": "code_implementation",
  "branches": [
    {
      "name": "分支名称",
      "name_en": "Branch Name",
      "nodes": [
        {
          "depth": 1,
          "id": "B1-D1-01",
          "content": "Node criterion decidable from final output files",
          "source": "KEEP_01 | MERGE_01_02 | ADD | DECOMPOSE_from_01 | DEEPEN",
          "requirement_ids": ["REQ-001"],
          "output_file_hints": ["src/app.js"]
        }
      ]
    }
  ]
}
```

### Field Rules

- Node IDs must match `B{branch}-D{depth}-{seq}` and branch/depth numbers must match their position and `depth`.
- Depth weights are fixed by the orchestrator: `depth=1 -> 1`, `depth=2 -> 2`, `depth>=3 -> 3`.
- Every node must be decidable from final output files only.

---

## validation_result.json

Produced by: **Tree Rubric Verification Agent**
Consumed by: **Tree Rubric Refinement Agent**, **Orchestrator**

```json
{
  "version": "1.0",
  "task_id": "GROUP-1-task",
  "group_id": "GROUP-1",
  "status": "pass | fail",
  "dimension_results": [
    {
      "dimension": "Core Criteria Preservation | Added Criteria Justification | Breadth And Depth Correctness | Depth Discrimination | Node Count And Coverage | End-To-End Compliance | Depth Enhancement Quality",
      "status": "pass | fail | warning",
      "evidence": "string",
      "suggestion": "string | null"
    }
  ],
  "required_changes": ["string"],
  "summary": "string"
}
```

---

## final-output-files.json

Produced by: **Orchestrator**
Consumed by: **Tree Grading Agent**

```json
{
  "version": "1.0",
  "group_id": "GROUP-1",
  "iteration": 1,
  "files": [
    {
      "path": "src/app.js",
      "status": "present | deleted",
      "content": "string | null"
    }
  ]
}
```

The orchestrator builds this from `execution-report.changed_files ∪ worker_group.owned_files`.

---

## tree_grading_individual_N.json

Produced by: **Each Tree Grading Agent**
Consumed by: **Orchestrator**

```json
{
  "version": "1.0",
  "group_id": "GROUP-1",
  "iteration": 1,
  "grader_id": 1,
  "task_id": "GROUP-1-task",
  "node_results": [
    {
      "node_id": "B1-D1-01",
      "raw_score": 1,
      "evidence": "src/app.js: evidence from final output file",
      "failure_reason": null,
      "suggestion": null
    }
  ]
}
```

### Field Rules

- Score every node exactly once with `raw_score` `0` or `1`.
- Evidence must cite a path from `final-output-files.json`.
- Evidence must not reference process artifacts such as execution, validation, merge, complexity reports, logs, retries, or tool traces.

---

## tree_grading_feedback.json

Produced by: **Orchestrator**
Consumed by: **Execution Agent**, **QA Agent**, **Doc Agent**, **Final Assessment Agent**

```json
{
  "version": "1.0",
  "group_id": "GROUP-1",
  "iteration": 1,
  "task_id": "GROUP-1-task",
  "threshold": 0.8,
  "require_depth_one_pass": true,
  "verdict": "pass | fail",
  "weighted_score": 0.875,
  "pass_rate": 0.8,
  "num_branches": 3,
  "max_depth": 3,
  "nodes_passed": ["B1-D1-01"],
  "nodes_failed": ["B1-D2-01"],
  "blocking_nodes": [],
  "non_blocking_nodes": ["B1-D2-01"],
  "node_results": [
    {
      "node_id": "B1-D1-01",
      "branch": "Correctness",
      "depth": 1,
      "weight": 1,
      "grader_scores": [],
      "raw_score": 1,
      "effective_score": 1,
      "dependency_blocked_by": null,
      "consensus": "unanimous | majority"
    }
  ],
  "summary": "string"
}
```

### Field Rules

- The orchestrator majority-votes each node across the three graders.
- A failed shallower node in the same branch sets deeper nodes' `effective_score` to `0`.
- `verdict` is `pass` only when `weighted_score >= 0.80` and all depth-1 nodes pass.

---

## Individual Reviewer Output: review_individual_N.json

Deprecated: kept for compatibility with older PRE/EME review tooling. The pipeline now uses Tree Rubrics artifacts instead.

Produced by: **Each Review Agent**
Consumed by: **Orchestrator**

```json
{
  "version": "1.0",
  "reviewer_id": 1,
  "applied_skills": ["ce-frontend-design"],
  "pre_results": [
    {
      "criterion": "Correctness | Security | Performance | Error Handling | Code Quality | Architecture Compliance | Test Coverage | Backward Compatibility",
      "score": "pass | fail | warning",
      "evidence": "string — specific file:line references and explanation",
      "suggestion": "string | null — fix recommendation, required for fail/warning"
    }
  ],
  "frontend_design_assessment": {
    "system_fit": "pass | fail | warning",
    "interaction_quality": "pass | fail | warning",
    "ui_accessibility": "pass | fail | warning",
    "verification_method": "string — screenshot, browser tooling, mental review, or skip reason",
    "notes": [
      "string — concrete frontend design observations"
    ]
  }
}
```

### Field Rules

- `applied_skills`: Include `ce-frontend-design` when the reviewed group required that skill. Otherwise use an empty array.
- `pre_results`: Exactly 8 entries, one per rubric dimension, in rubric order.
- `suggestion`: Required for every `fail` and `warning`. Must be `null` for `pass`.
- `frontend_design_assessment`: Must be non-null when `applied_skills` includes `ce-frontend-design`. Must be `null` otherwise.
- Frontend-design findings must also be reflected in the relevant PRE dimensions. This object supplements review evidence; it does not replace PRE scoring.

---

## review_feedback.json

Produced by: **Orchestrator**
Consumed by: **Execution Agent**, **QA Agent**, **Doc Agent**, **Final Assessment Agent**

```json
{
  "version": "1.0",
  "iteration": 1,
  "mode": "EME | PRE",
  "verdict": "pass | fail",
  "eme_votes": [
    {
      "criterion": "Correctness",
      "votes": ["pass", "pass", "fail"],
      "final_score": "pass",
      "consensus": "majority"
    }
  ],
  "merged_issues": [
    {
      "criterion": "Security",
      "evidence": "string — merged from all reviewers who flagged this",
      "suggestion": "string — combined fix recommendation",
      "flagged_by": [1, 3]
    }
  ],
  "summary": "string — overall assessment in 2-3 sentences",
  "blocking_issues_count": 0,
  "warnings": [
    "string — preserved non-blocking concerns"
  ]
}
```

### Field Rules

- `mode`: `EME` for 3-reviewer majority vote, `PRE` for a single reviewer.
- `eme_votes`: Exactly 8 entries in `EME`; in `PRE`, still emit 8 entries with a single repeated vote so downstream stages keep one shape.
- `final_score`: Determined by majority vote. `warning` counts as `pass` for voting.
- `consensus`: `"unanimous"` if all effective votes agree, otherwise `"majority"`.
- `merged_issues`: Empty array when `verdict` is `pass`.
- `verdict`: `pass` only when all 8 dimensions pass after aggregation.
- `blocking_issues_count`: Count of dimensions with `final_score = "fail"`.
- `warnings`: Preserve non-blocking review concerns even on pass.

---

## validation-report.json

Produced by: **Validation Agent**
Consumed by: **Orchestrator**, **Review Agent**, **QA Agent**, **Final Assessment Agent**

```json
{
  "version": "1.0",
  "group_id": "GROUP-1",
  "iteration": 1,
  "detected_language": "go | python | javascript | typescript | rust | java | ruby | unknown",
  "status": "passed | failed | error | skipped",
  "commands_run": [
    {
      "command": "string — exact command run",
      "type": "fix | check",
      "exit_code": 0,
      "output": "string — full stdout/stderr"
    }
  ],
  "test_summary": {
    "total": 0,
    "passed": 0,
    "failed": 0,
    "skipped": 0
  },
  "blocking_failures": [
    "string — failing test name or diagnostic, one per entry"
  ]
}
```

### Field Rules

- `group_id`: Must match one entry in `dispatch.json.worker_groups[].group_id`.
- `iteration`: Starts at 1 and matches the execution/merge/review iteration for the same worker group.
- `commands_run`: Include every command attempted, in order. Never omit a command that was run.
- `test_summary`: Aggregate counts across all test commands. Set to zeroes if no test commands were run.
- `blocking_failures`: Empty array when `status` is `passed`, `skipped`, or `error`. List individual failing test names or diagnostics when `status` is `failed`.
- `detected_language`: The language detected from repo root marker files. Set to `unknown` when no marker file is found.
- `status`: `passed` when all commands exit 0; `failed` when any check command exits non-zero; `error` when a fix command fails to run or compilation prevents test execution; `skipped` when `detected_language` is `unknown` — orchestrator treats `skipped` as a soft pass and proceeds to Tree Grading.
- `commands_run[].type`: `fix` for commands that may write files (formatters, import sorters); `check` for read-only commands (tests, type checkers, linters that only report).

---

## qa-report.json

Produced by: **QA Agent**
Consumed by: **Final Assessment Agent**, **Orchestrator**

```json
{
  "version": "1.0",
  "group_id": "GROUP-1",
  "iteration": 1,
  "status": "pass | fail",
  "test_infrastructure": "configured | missing",
  "test_results": [
    {
      "kind": "existing | new | scenario | manual",
      "requirement_ids": ["REQ-001"],
      "command": "string — exact command or 'manual scenario'",
      "status": "passed | failed | error | not_run",
      "details": "string — concise outcome and evidence"
    }
  ],
  "blocking_issues": [
    "string — concrete runtime or behavioral failures"
  ],
  "notes": [
    "string — non-blocking constraints, coverage gaps, or environment notes"
  ]
}
```

### Field Rules

- `group_id`: Must match one entry in `dispatch.json.worker_groups[].group_id`.
- `iteration`: Starts at 1 and matches the execution/review iteration for the same worker group.
- `status`: `pass` only when all executed tests and runtime validations pass. Use `fail` when any blocking QA issue is found.
- `test_infrastructure`: Use `configured` when the project has an automated test runner the QA Agent can invoke; otherwise use `missing`.
- `kind`: `existing` for pre-existing tests, `new` for tests added by Execution, `scenario` for end-to-end or user-flow validations, `manual` for non-automated validation steps.
- `requirement_ids`: Reference the `spec.json.requirements[].id` values validated by this result. Use an empty array only when a command checks shared infrastructure rather than a specific requirement.
- `test_results`: Record every attempted command or manual validation step. When no test runner exists, still include scenario or manual entries showing what was validated.
- `status` inside `test_results`: `passed` for successful validation, `failed` for assertion mismatches, `error` for infrastructure/runtime errors, `not_run` only when a planned check was intentionally skipped.
- Each `must-have` requirement covered by this worker group must have at least one `scenario` or `manual` entry in `test_results`.
- `blocking_issues`: Must be empty when top-level `status` is `pass`.
- `notes`: Use for missing infrastructure, environment limitations, deferred coverage, or other non-blocking observations.

---

## doc-report.json

Produced by: **Doc Agent**
Consumed by: **Final Assessment Agent**, **Orchestrator**

```json
{
  "version": "1.0",
  "status": "updated | no_changes_needed",
  "updated_files": ["string — repo-relative documentation paths"],
  "summary": "string — what changed for users or maintainers",
  "notes": [
    "string — rationale or follow-up documentation gaps"
  ]
}
```

### Field Rules

- `updated_files`: Empty array only when `status` is `no_changes_needed`.
- `summary`: Required even when no docs changed.
- `notes`: Use for deferred docs work or style constraints discovered during editing.

---

## final-assessment.json

Produced by: **Final Assessment Agent**
Consumed by: **Orchestrator**

```json
{
  "version": "1.0",
  "iteration": 1,
  "verdict": "accept | reject",
  "dimension_scores": [
    {
      "dimension": "Requirement Completeness | Implementation Quality | Architectural Soundness | Test Confidence | Documentation Accuracy | Overall Cohesion",
      "score": "strong | adequate | weak",
      "evidence": "string — concrete artifacts, code, tests, or docs that justify the score"
    }
  ],
  "improvement_areas": [
    {
      "dimension": "Documentation Accuracy",
      "issue": "string — current gap or weakness",
      "recommendation": "string — what should change next"
    }
  ],
  "restart_from": "spec | plan | architecture | dispatch | merge | execution | null",
  "restart_rationale": "string | null — why this restart point is correct",
  "skill_usage_summary": [
    {
      "scope": "spec | plan | GROUP-1/execution | GROUP-1/grading",
      "required_skills": ["superpowers"],
      "applied_skills": ["superpowers"],
      "issues": [
        "string — missing, extra, or misapplied skill usage"
      ]
    }
  ],
  "readability_conclusion": "high | low",
  "complexity_conclusion": "high | low",
  "complexity_summary": "string — how complexity-report.json evidence affected the final judgment",
  "summary": "string — final delivery assessment in 2-3 sentences"
}
```

### Field Rules

- `iteration`: Starts at 1 and increments for each full delivery assessment pass.
- `dimension_scores`: Exactly 6 entries in this order: Requirement Completeness, Implementation Quality, Architectural Soundness, Test Confidence, Documentation Accuracy, Overall Cohesion.
- `score`: Use `strong`, `adequate`, or `weak` exactly as defined in `agents/final-assessment.md`.
- `evidence`: Must cite concrete signals from code, tests, docs, or upstream artifacts. Do not leave this as a generic summary.
- `improvement_areas`: May be empty on a clean accept. On `accept`, keep only non-blocking recommendations. On `reject`, include every gap that materially contributed to rejection or must be addressed on restart.
- `restart_from`: Must be `null` when `verdict` is `accept`. Must be one of `spec`, `plan`, `architecture`, `dispatch`, `merge`, or `execution` when `verdict` is `reject`.
- `restart_rationale`: Must be `null` when `verdict` is `accept`. Must be non-null when `verdict` is `reject` and explain why the chosen restart stage is the earliest correct recovery point.
- `skill_usage_summary`: Include at least Spec, Plan, and every worker-group stage that required a routed skill. Use `issues = []` when usage matched the requirement.
- `readability_conclusion`: Must be exactly `high` or `low`, based on all `complexity-report.json` artifacts and final grading evidence.
- `complexity_conclusion`: Must be exactly `high` or `low`, based on all `complexity-report.json` artifacts and final grading evidence.
- `complexity_summary`: Required. Cite the strongest complexity evidence and state whether readability/complexity affects delivery confidence.
- `summary`: Required for every verdict and should stay within 2-3 sentences.

---

## .pipeline-last-run-summary.json

Produced by: **Orchestrator**
Consumed by: **Orchestrator**, **Humans**

```json
{
  "version": "1.0",
  "run_id": "RUN-20260423-001",
  "completed_at": "2026-04-23T12:34:56Z",
  "verdict": "accept | reject | pause_for_human",
  "restart_from": "spec | plan | architecture | dispatch | merge | execution | null",
  "skill_usage_summary": [
    {
      "scope": "spec | plan | GROUP-1/execution | GROUP-1/grading",
      "required_skills": ["superpowers"],
      "applied_skills": ["superpowers"],
      "issues": []
    }
  ],
  "merge_summary": {
    "merged_groups": ["GROUP-1"],
    "conflicted_groups": [],
    "noop_groups": []
  },
  "tree_grading_summary": [
    {
      "group_id": "GROUP-1",
      "verdict": "pass | fail",
      "weighted_score": 0.875,
      "nodes_failed": ["B1-D2-01"]
    }
  ],
  "qa_summary": [
    {
      "group_id": "GROUP-1",
      "status": "pass | fail"
    }
  ],
  "validation_summary": [
    {
      "group_id": "GROUP-1",
      "status": "passed | failed | error | skipped"
    }
  ],
  "complexity_summary": [
    {
      "group_id": "GROUP-1",
      "ref": "complexity/GROUP-1/iteration-1-complexity-report.json",
      "status": "completed | skipped | error",
      "readability_conclusion": "high | low",
      "complexity_conclusion": "high | low",
      "function_count": 2,
      "max_total_points": 18
    }
  ],
  "cleanup_summary": {
    "deleted_workspace": true,
    "deleted_paths": [".pipeline-workspace"],
    "retained_file": ".pipeline-last-run-summary.json"
  },
  "codex_pet_events": [
    {
      "state": "idle | running-right | running-left | waving | jumping | failed | waiting | running | review",
      "reason": "string - why this pet state was requested",
      "scope": "string - stable event scope such as pipeline.validation.group-group-1.iteration-1",
      "duration_ms": 1800,
      "created_at": "2026-04-23T12:34:56Z",
      "directive": "::codex-pet{state=\"running\" durationMs=1800 scope=\"pipeline.validation.group-group-1.iteration-1\"}"
    }
  ]
}
```

### Field Rules

- `run_id`: Stable identifier for the terminal run being summarized.
- `completed_at`: ISO-8601 timestamp for when the terminal run finished or paused.
- `verdict`: `accept` when the run completed successfully, `reject` when Final Assessment rejected the delivery, `pause_for_human` when the pipeline stopped at merge for manual resolution.
- `restart_from`: Mirrors the earliest safe restart point for rejected or paused runs. Use `null` for accepted runs.
- `skill_usage_summary`: Reuse the same shape as `final-assessment.json.skill_usage_summary`.
- `cleanup_summary.deleted_workspace`: `true` only when cleanup deleted `.pipeline-workspace/`.
- `validation_summary`: Include one entry for each worker group that reached Validation.
- `complexity_summary`: Include one entry for each worker group that completed an Execution pass and therefore produced a complexity report.
- `tree_grading_summary`: Include one entry for each worker group that reached tree grading.
- `qa_summary`: Include one entry for each worker group that reached QA.
- `cleanup_summary.deleted_paths`: Must list what was actually deleted. Use an empty array when the workspace was preserved.
- `cleanup_summary.retained_file`: Must be `.pipeline-last-run-summary.json`.
- `codex_pet_events`: Ordered event bridge for Codex Desktop or another host to consume. The orchestrator also writes the same events as JSON Lines to `.pipeline-workspace/logs/codex-pet-events.jsonl` while the workspace exists.
- `codex_pet_events[].directive`: A host-facing response directive string. Hosts that support `::codex-pet{...}` may apply it directly; hosts that do not support it should treat the event object as the durable contract.

---

## codex_pet_event

Produced by: **Orchestrator** (runtime lifecycle)
Consumed by: **Codex host UI** or any bridge that can map pipeline progress to avatar state.

```json
{
  "state": "running",
  "reason": "validation stage started.",
  "scope": "pipeline.validation.group-group-1.iteration-1",
  "duration_ms": 1800,
  "created_at": "2026-05-26T00:00:00.000Z",
  "directive": "::codex-pet{state=\"running\" durationMs=1800 scope=\"pipeline.validation.group-group-1.iteration-1\"}"
}
```

### State Mapping

| Pipeline condition | Pet state |
|---|---|
| Run, Spec, Plan, Architecture, Dispatch, Execution, Validation, QA, Doc | `running` |
| Tree Grading and Final Assessment | `review` |
| Accepted final result | `waving` |
| Validation failure, Tree Grading failure, rejected run | `failed` |
| Pause for human input or merge conflict | `waiting` |

### Field Rules

- `state`: Must be one of the Codex avatar states supported by the fixed pet atlas.
- `scope`: Must remain stable enough for a host to deduplicate repeated events.
- `duration_ms`: Advisory display duration. The host may clamp or ignore it.
- `directive`: Mirrors the structured fields for directive-capable hosts. The structured JSON remains canonical.
