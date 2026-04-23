# JSON Contract Schemas

All canonical pipeline artifacts are written by the orchestrator into `.pipeline-workspace/`. Subagents return JSON matching these contracts; the orchestrator validates and persists them.

## spec.json

Produced by: **Spec Agent**  
Consumed by: **Plan Agent**, **Architecture Agent**, **Dispatch Agent**, **Execution Agent**, **Review Agent**, **QA Agent**, **Doc Agent**, **Final Assessment Agent**

```json
{
  "version": "1.0",
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

- `id`: Sequential, prefixed with `REQ-`. Start from `REQ-001`.
- `priority`: Every requirement must have one. Default to `must-have` if unclear.
- `acceptance_criteria`: At least one per requirement. Must be objectively verifiable.
- `constraints`: Include backward compatibility, performance budgets, or API contracts that must not break.
- `out_of_scope`: Helps downstream agents avoid scope creep.
- `assumptions`: Use for low-risk inferences that the orchestrator can surface if needed. Empty array when not needed.

---

## plan.json

Produced by: **Plan Agent**  
Consumed by: **Architecture Agent**, **Dispatch Agent**, **Execution Agent**, **Final Assessment Agent**

```json
{
  "version": "1.0",
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
      "description": "string — what changes and why"
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
      "depends_on_groups": []
    }
  ],
  "execution_waves": [
    {
      "wave": 1,
      "groups": ["GROUP-1", "GROUP-2"]
    }
  ],
  "rationale": "string — explanation of grouping decisions and any tradeoffs"
}
```

### Field Rules

- `worker_groups`: Each group contains one or more tasks from `plan.json` and the files those tasks own, derived from `architecture.json.proposed_changes`. No file may appear in more than one group's `owned_files` within the same execution wave.
- `depends_on_groups`: References other group IDs. A group can only begin execution after all groups it depends on have completed. Empty array when no inter-group dependency exists.
- `execution_waves`: Groups with no unresolved `depends_on_groups` run in the same wave. Waves execute sequentially; groups within a wave execute concurrently. At least one wave must be produced.
- `rationale`: A plain-language explanation of why the tasks were grouped this way and what tradeoffs were made.

---

## execution-report.json

Produced by: **Execution Agent**  
Consumed by: **Review Agent**, **QA Agent**, **Doc Agent**, **Final Assessment Agent**, **Orchestrator**

```json
{
  "version": "1.0",
  "group_id": "GROUP-1",
  "iteration": 1,
  "status": "implemented | blocked",
  "changed_files": ["string — repo-relative file paths"],
  "requirements_covered": ["REQ-001"],
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
- `iteration`: Starts at 1 and matches the current execution/review loop.
- `status`: `implemented` when code is ready for review; `blocked` when the worker cannot proceed.
- `changed_files`: Must reflect actual touched files.
- `requirements_covered`: Reference requirement IDs from `spec.json`.
- `tests_run`: Include every command attempted. Use `not_run` only when a test was intentionally skipped.
- `blockers`: Empty array when `status` is `implemented`.

---

## Individual Reviewer Output: review_individual_N.json

Produced by: **Each Review Agent**  
Consumed by: **Orchestrator**

```json
{
  "version": "1.0",
  "reviewer_id": 1,
  "pre_results": [
    {
      "criterion": "Correctness | Security | Performance | Error Handling | Code Quality | Architecture Compliance | Test Coverage | Backward Compatibility",
      "score": "pass | fail | warning",
      "evidence": "string — specific file:line references and explanation",
      "suggestion": "string | null — fix recommendation, required for fail/warning"
    }
  ]
}
```

### Field Rules

- `pre_results`: Exactly 8 entries, one per rubric dimension, in rubric order.
- `suggestion`: Required for every `fail` and `warning`. Must be `null` for `pass`.

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
  "restart_from": "spec | plan | architecture | dispatch | execution | null",
  "restart_rationale": "string | null — why this restart point is correct",
  "summary": "string — final delivery assessment in 2-3 sentences"
}
```

### Field Rules

- `iteration`: Starts at 1 and increments for each full delivery assessment pass.
- `dimension_scores`: Exactly 6 entries in this order: Requirement Completeness, Implementation Quality, Architectural Soundness, Test Confidence, Documentation Accuracy, Overall Cohesion.
- `score`: Use `strong`, `adequate`, or `weak` exactly as defined in `agents/final-assessment.md`.
- `evidence`: Must cite concrete signals from code, tests, docs, or upstream artifacts. Do not leave this as a generic summary.
- `improvement_areas`: May be empty on a clean accept. On `accept`, keep only non-blocking recommendations. On `reject`, include every gap that materially contributed to rejection or must be addressed on restart.
- `restart_from`: Must be `null` when `verdict` is `accept`. Must be one of `spec`, `plan`, `architecture`, `dispatch`, or `execution` when `verdict` is `reject`.
- `restart_rationale`: Must be `null` when `verdict` is `accept`. Must be non-null when `verdict` is `reject` and explain why the chosen restart stage is the earliest correct recovery point.
- `summary`: Required for every verdict and should stay within 2-3 sentences.
