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
  "applied_skills": [],
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

- `applied_skills`: Must be an empty array. Spec uses skill-internal
  methodology references, not external skill packages.
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
  "applied_skills": [],
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

- `applied_skills`: Must be an empty array. Plan uses skill-internal
  methodology references, not external skill packages.
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
- `required_skills`: Deterministic union of pipeline-internal capability labels
  for the files owned by that group. Map `frontend_design` to
  `ce-frontend-design`. Use an empty array when no routed capability is
  required. These labels do not imply external skill packages.
- `execution_waves`: Groups with no unresolved `depends_on_groups` launch Execution in the same wave. Execution launch waves are sequential, but downstream Validation, Tree Rubrics, Tree Grading, and QA are per-group and may start early as each group finishes Execution. At least one wave must be produced, and each wave must list 1 to 6 groups.
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
- `applied_skills`: Include `ce-frontend-design` when
  `dispatch.json.worker_groups[].required_skills` includes it and the internal
  frontend-design capability guidance was applied. Otherwise use an empty
  array.
- `status`: `implemented` means the proposal is ready for merge. `blocked` means the worker cannot proceed.
- `changed_files`: Must reflect actual touched files.
- `requirements_covered`: Reference requirement IDs from `spec.json`.
- `frontend_design_summary`: Must be non-null when `applied_skills` includes `ce-frontend-design`. Must be `null` when no frontend-design routing applied.
- `tests_run`: Include every command attempted. Use `not_run` only when a test was intentionally skipped.
- `blockers`: Empty array when `status` is `implemented`. When `status` is `blocked` because the retry requires unowned files, cross-group ownership changes, or a different worker split, start the first blocker with `REPLAN_REQUIRED:` so the orchestrator can restart from Dispatch.

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

- `applied_skills`: Include `ce-frontend-design` when the reviewed group
  required that internal capability label. Otherwise use an empty array.
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
      "type": "check",
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
- `status`: `passed` when all commands exit 0; `failed` when any check command exits non-zero; `error` when a check command cannot run or compilation prevents test execution; `skipped` when `detected_language` is `unknown` — orchestrator treats `skipped` as a soft pass and proceeds to Tree Grading.
- `commands_run[].type`: Must be `check`. Validation is read-only; formatting, import sorting, auto-fix, and other repo-file mutations belong to an Execution retry.

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
  "status": "updated | no_changes_needed | changes_required",
  "updated_files": ["string — repo-relative documentation paths updated by a legacy proposal or requiring Execution repair"],
  "summary": "string — what changed or what documentation repair is required",
  "notes": [
    "string — rationale or follow-up documentation gaps"
  ]
}
```

### Field Rules

- `updated` is a legacy compatibility status for older doc-worker proposal runs.
  Current Doc agents are read-only and should use `changes_required` when docs
  need file edits.
- `updated_files`: Empty array only when `status` is `no_changes_needed`. When
  `status` is `changes_required`, list the documentation files Execution should
  repair.
- `summary`: Required even when no docs changed.
- `notes`: Use for deferred docs work, style constraints discovered during
  auditing, or precise Execution repair guidance.

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
      "required_skills": [],
      "applied_skills": [],
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
- `skill_usage_summary`: Include at least Spec, Plan, and every worker-group
  stage that required a routed capability label. Use `issues = []` when usage
  matched the requirement.
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
      "required_skills": [],
      "applied_skills": [],
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

---

## research-harness-state.json

Produced by: **Research Harness**
Consumed by: **Planning, Execution, Validation, Review, Final Assessment**

Tracks the generated research report, source inventory, candidate decisions,
evidence links, scoring rubric, and output checks for an agent engineering
research pass.

```json
{
  "version": "1.0",
  "report_path": "research-reports/2026-W23/agent-engineering-landing.md",
  "generated_for_date": "2026-06-08",
  "sources_seen": [
    {
      "source_id": "SRC-001",
      "source_type": "paper",
      "title": "Agent engineering benchmark notes",
      "locator": "https://example.com/agent-engineering"
    }
  ],
  "candidate_index": [
    {
      "candidate_id": "CAND-001",
      "title": "Runtime artifact validation",
      "status": "selected"
    }
  ],
  "evidence_map": [
    {
      "candidate_id": "CAND-001",
      "source_ids": ["SRC-001"],
      "summary": "The landing plan needs artifact contracts before orchestration can replay runs."
    }
  ],
  "rubric": {
    "criteria": ["contract coverage", "fixture quality"],
    "minimum_evidence_count": 1
  },
  "output_validation": {
    "status": "passed",
    "checks": ["all selected candidates have evidence"]
  }
}
```

### Field Rules

- `version`, `report_path`, and `generated_for_date` are required strings.
- `sources_seen`: Non-empty array; each item requires `source_id`, `source_type`, `title`, and `locator` strings.
- `candidate_index`: Non-empty array; each item requires `candidate_id`, `title`, and `status`.
- `candidate_index[].status`: Must be `selected`, `queued`, or `rejected`.
- `evidence_map`: Non-empty array; each item requires `candidate_id`, non-empty `source_ids`, and `summary`.
- `rubric.criteria`: Non-empty string array.
- `rubric.minimum_evidence_count`: Integer greater than or equal to 0.
- `output_validation.status`: Must be `passed`, `warning`, or `failed`.
- `output_validation.checks`: Non-empty string array.

---

## context-manifest.json

Produced by: **Context Assembly Agent**
Consumed by: **Execution, Review, QA, Governance**

Declares the context blocks supplied to an agent, their cache and approval
behavior, and a compact prompt diff.

```json
{
  "version": "1.0",
  "task_id": "TASK-agent-engineering-001",
  "compiled_at": "2026-06-08T08:00:00Z",
  "blocks": [
    {
      "id": "system-contracts",
      "version": "1.0.0",
      "source": "references/contracts.md",
      "priority": 10,
      "tenant_scope": "local",
      "cacheable": true,
      "evictable": false,
      "requires_approval": false,
      "hash": "sha256:context-contracts"
    }
  ],
  "prompt_diff": {
    "summary": "Added runtime artifact validators for the landing plan.",
    "added_blocks": ["system-contracts"],
    "removed_blocks": []
  }
}
```

### Field Rules

- `version`, `task_id`, and `compiled_at` are required strings.
- `blocks`: Non-empty array.
- `blocks[].id`, `blocks[].version`, `blocks[].source`, `blocks[].tenant_scope`, and `blocks[].hash`: Required strings.
- `blocks[].priority`: Integer greater than or equal to 0.
- `blocks[].cacheable`, `blocks[].evictable`, and `blocks[].requires_approval`: Required booleans.
- `prompt_diff.summary`: Required string.
- `prompt_diff.added_blocks` and `prompt_diff.removed_blocks`: Required string arrays.

---

## agent-trace.json

Produced by: **Any Agent**
Consumed by: **Review, Governance, Final Assessment**

Records a compact, auditable trace of visible agent events and the stage
outcome.

```json
{
  "version": "1.0",
  "task_id": "TASK-agent-engineering-001",
  "started_at": "2026-06-08T00:00:00.000Z",
  "events": [
    {
      "type": "message",
      "at": "2026-06-08T00:00:10.000Z",
      "summary": "Execution worker received the runtime artifact validation task."
    }
  ],
  "summary": {
    "status": "completed",
    "outcome": "All requested artifact types were validated with fixture coverage."
  }
}
```

### Field Rules

- `version`, `task_id`, and `started_at` are required strings.
- `events`: Non-empty array.
- `events[].type`: Must be `message`, `tool_call`, `tool_result`, `file_diff`, `validation`, `retry`, `failure`, or `cost`.
- `events[].at` and `events[].summary`: Required strings.
- `summary.status`: Must be `completed`, `blocked`, or `failed`.
- `summary.outcome`: Required string.

---

## state-store-snapshot.json

Produced by: **State Store**
Consumed by: **Resume, Validation, Governance**

Captures the active path, candidate pool, evidence links, rollback boundaries,
and memory channel checks needed for deterministic resume and audit.

```json
{
  "version": "1.0",
  "task_id": "TASK-agent-engineering-001",
  "active_path": {
    "path_id": "PATH-main",
    "current_stage": "execution"
  },
  "candidate_pool": [
    {
      "candidate_id": "CAND-001",
      "status": "active"
    }
  ],
  "evidence_links": [
    {
      "evidence_id": "EVID-001",
      "source": "SRC-001",
      "target": "CAND-001"
    }
  ],
  "failed_branches": [],
  "rollback_boundaries": [
    {
      "boundary_id": "RB-001",
      "restore_ref": "git:HEAD"
    }
  ],
  "memory_channel_checks": [
    {
      "channel": "local-artifacts",
      "status": "passed"
    }
  ]
}
```

### Field Rules

- `version` and `task_id` are required strings.
- `active_path.path_id` and `active_path.current_stage`: Required strings.
- `candidate_pool`: Non-empty array.
- `candidate_pool[].candidate_id`: Required string.
- `candidate_pool[].status`: Must be `active`, `parked`, or `rejected`.
- `evidence_links`: Required array; each item requires `evidence_id`, `source`, and `target` strings.
- `failed_branches`: Required array; each item requires `branch_id` and `reason` strings.
- `rollback_boundaries`: Non-empty array; each item requires `boundary_id` and `restore_ref` strings.
- `memory_channel_checks`: Non-empty array.
- `memory_channel_checks[].status`: Must be `passed`, `warning`, or `failed`.

---

## cache-observability-report.json

Produced by: **Cache Observer**
Consumed by: **Performance Review, Governance, Final Assessment**

Summarizes prompt component cache policy, stable prefix metrics, provider token
metrics, and cache findings for one task.

```json
{
  "version": "1.0",
  "task_id": "TASK-agent-engineering-001",
  "generated_at": "2026-06-08T08:00:00Z",
  "prompt_components": [
    {
      "component_id": "stable-contract-prefix",
      "role": "system",
      "hash": "sha256:stable-prefix",
      "cache_policy": "stable"
    }
  ],
  "stable_prefix": {
    "hash": "sha256:stable-prefix",
    "token_count": 1200
  },
  "provider_metrics": {
    "provider": "openai",
    "prompt_tokens": 1800,
    "cached_tokens": 1200
  },
  "findings": [
    {
      "severity": "info",
      "summary": "Stable prompt prefix was reused for the execution stage."
    }
  ]
}
```

### Field Rules

- `version`, `task_id`, and `generated_at` are required strings.
- `prompt_components`: Non-empty array.
- `prompt_components[].component_id`, `prompt_components[].role`, and `prompt_components[].hash`: Required strings.
- `prompt_components[].cache_policy`: Must be `stable`, `volatile`, or `bypass`.
- `stable_prefix.hash`: Required string.
- `stable_prefix.token_count`: Integer greater than or equal to 0.
- `provider_metrics.provider`: Required string.
- `provider_metrics.prompt_tokens` and `provider_metrics.cached_tokens`: Integers greater than or equal to 0.
- `findings`: Required array.
- `findings[].severity`: Must be `info`, `warning`, or `error`.
- `findings[].summary`: Required string.

---

## governance-report.json

Produced by: **Governance Agent**
Consumed by: **Orchestrator, Final Assessment, Human Reviewer**

Audits source trust, quarantined context, approval gates, tenant scope, memory
injection checks, and conclusions for a task.

```json
{
  "version": "1.0",
  "task_id": "TASK-agent-engineering-001",
  "source_graph": [
    {
      "node_id": "SRC-001",
      "source": "references/contracts.md",
      "trust_level": "trusted"
    }
  ],
  "quarantined_items": [],
  "approval_gates": [
    {
      "gate_id": "GATE-runtime-artifacts",
      "status": "approved"
    }
  ],
  "tenant_scope": "local",
  "memory_injection_checks": [
    {
      "check_id": "MEM-001",
      "status": "passed"
    }
  ],
  "conclusions": ["No quarantined context was injected into the runtime artifact fixtures."]
}
```

### Field Rules

- `version` and `task_id` are required strings.
- `source_graph`: Non-empty array.
- `source_graph[].node_id` and `source_graph[].source`: Required strings.
- `source_graph[].trust_level`: Must be `trusted`, `untrusted`, or `quarantined`.
- `quarantined_items`: Required array; each item requires `item_id` and `reason` strings.
- `approval_gates`: Non-empty array.
- `approval_gates[].gate_id`: Required string.
- `approval_gates[].status`: Must be `approved`, `pending`, or `rejected`.
- `tenant_scope`: Required string.
- `memory_injection_checks`: Non-empty array.
- `memory_injection_checks[].check_id`: Required string.
- `memory_injection_checks[].status`: Must be `passed`, `warning`, or `failed`.
- `conclusions`: Non-empty string array.

---

## protocol-dag.json

Produced by: **Protocol Planner**
Consumed by: **Dispatch, Execution, Validation, Governance**

Defines the protocol nodes and edges, a single-agent orchestration anchor,
state machine metadata, and acceptance criteria.

```json
{
  "version": "1.0",
  "task_id": "TASK-agent-engineering-001",
  "single_agent_anchor": {
    "role": "orchestrator",
    "responsibilities": ["own stage ordering", "record durable artifacts"]
  },
  "nodes": [
    {
      "id": "research",
      "type": "stage",
      "label": "Research harness"
    },
    {
      "id": "execution",
      "type": "stage",
      "label": "Execution worker"
    }
  ],
  "edges": [
    {
      "from": "research",
      "to": "execution"
    }
  ],
  "state_machine": {
    "states": ["research", "execution", "validation"],
    "initial_state": "research"
  },
  "acceptance": {
    "criteria": ["every edge references known nodes", "initial state is declared"]
  }
}
```

### Field Rules

- `version` and `task_id` are required strings.
- `single_agent_anchor.role`: Required string.
- `single_agent_anchor.responsibilities`: Non-empty string array.
- `nodes`: Non-empty array.
- `nodes[].id`, `nodes[].type`, and `nodes[].label`: Required strings.
- `nodes[].id`: Must be unique.
- `edges`: Required array.
- `edges[].from` and `edges[].to`: Required strings and must reference known node ids.
- `state_machine.states`: Non-empty string array.
- `state_machine.initial_state`: Required string and must be listed in `state_machine.states`.
- `acceptance.criteria`: Non-empty string array.

---

## serving-profile.json

Produced by: **Serving or Runtime Adapter**
Consumed by: **Execution, Validation, QA, Observability**

Describes backend calls, capacity assumptions, replay results, and tradeoffs for
the serving or runtime adapter path.

```json
{
  "version": "1.0",
  "task_id": "TASK-agent-engineering-001",
  "backend": "local-node-runtime",
  "calls": [
    {
      "call_id": "CALL-001",
      "operation": "validateArtifact",
      "latency_ms": 4,
      "status": "succeeded"
    }
  ],
  "capacity_model": {
    "max_concurrency": 4,
    "throughput_per_minute": 120
  },
  "replay_summary": {
    "status": "passed",
    "sample_count": 9
  },
  "tradeoffs": ["local validation is deterministic but does not measure remote provider latency"]
}
```

### Field Rules

- `version`, `task_id`, and `backend` are required strings.
- `calls`: Non-empty array.
- `calls[].call_id` and `calls[].operation`: Required strings.
- `calls[].latency_ms`: Integer greater than or equal to 0.
- `calls[].status`: Must be `succeeded`, `failed`, or `skipped`.
- `capacity_model.max_concurrency`: Integer greater than or equal to 1.
- `capacity_model.throughput_per_minute`: Integer greater than or equal to 0.
- `replay_summary.status`: Must be `passed`, `warning`, or `failed`.
- `replay_summary.sample_count`: Integer greater than or equal to 0.
- `tradeoffs`: Non-empty string array.

---

## latent-communication-experiment.json

Produced by: **Research or Evaluation Agent**
Consumed by: **Governance, Review, Final Assessment**

Documents baselines, explicit experiments, compatibility, safety checks, and a
conclusion for latent communication evaluation.

```json
{
  "version": "1.0",
  "task_id": "TASK-agent-engineering-001",
  "baselines": [
    {
      "baseline_id": "BASE-001",
      "description": "Single visible artifact contract per stage",
      "metric": "replay correctness"
    }
  ],
  "experiments": [
    {
      "experiment_id": "EXP-001",
      "description": "Compare compact trace hints against explicit state snapshots",
      "result": "Explicit state snapshots preserved replayability better than implicit hints."
    }
  ],
  "compatibility": {
    "status": "compatible",
    "notes": "Experiment metadata can be stored without changing existing stage artifacts."
  },
  "safety": {
    "status": "passed",
    "checks": ["no hidden coordination channel is required for acceptance"]
  },
  "conclusion": "Latent communication experiments must remain observable through explicit artifacts."
}
```

### Field Rules

- `version` and `task_id` are required strings.
- `baselines`: Non-empty array.
- `baselines[].baseline_id`, `baselines[].description`, and `baselines[].metric`: Required strings.
- `experiments`: Non-empty array.
- `experiments[].experiment_id`, `experiments[].description`, and `experiments[].result`: Required strings.
- `compatibility.status`: Must be `compatible`, `limited`, or `incompatible`.
- `compatibility.notes`: Required string.
- `safety.status`: Must be `passed`, `warning`, or `failed`.
- `safety.checks`: Non-empty string array.
- `conclusion`: Required string.
