# JSON Contract Schemas

All canonical pipeline artifacts are written by the orchestrator into `.pipeline-workspace/`. Subagents return JSON matching these contracts; the orchestrator validates and persists them.

## spec.json

Produced by: **Spec Agent**  
Consumed by: **Plan Agent**, **Architecture Agent**, **Execution Agent**, **Review Agent**, **Doc Agent**

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
Consumed by: **Architecture Agent**, **Execution Agent**

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
Consumed by: **Execution Agent**, **Review Agent**, **Doc Agent**

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
  "rollback_notes": "string | null — required if infeasible",
  "recommended_next_stage": "execution | plan | null",
  "rework_reason": "string | null"
}
```

### Field Rules

- `decision`: Choose based on analysis — `incremental` for small changes that fit current structure, `refactor` for structural changes, `hybrid` for mixed cases.
- `feasibility`: Set to `infeasible` only when delivery would violate stated constraints or require unreasonable restructuring.
- `infeasibility_reason` and `rollback_notes`: Must be non-null when `feasibility` is `infeasible`. Must be `null` when `feasible`.
- `dependency_changes`: Empty array if no dependency changes are needed.
- `recommended_next_stage`: Use `execution` when the architecture is ready to implement, `plan` when the plan must be redone before execution, and `null` when the architecture is infeasible and the pipeline must stop for user intervention.
- `rework_reason`: Required when `recommended_next_stage = "plan"`. Must be `null` when `recommended_next_stage = "execution"` unless the Architecture Agent is documenting non-blocking follow-up notes.

---

## execution-report.json

Produced by: **Execution Agent**  
Consumed by: **Review Agent**, **Doc Agent**, **Orchestrator**

```json
{
  "version": "1.0",
  "iteration": 1,
  "status": "implemented | blocked",
  "recommended_next_stage": "review | architecture | plan",
  "rework_reason": "string | null",
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

- `iteration`: Starts at 1 and matches the current execution/review loop.
- `status`: `implemented` when code is ready for review; `blocked` when the worker cannot proceed.
- `recommended_next_stage`: `review` when `status = "implemented"`. When `status = "blocked"`, must be `architecture` or `plan`.
- `rework_reason`: Required when `status = "blocked"`. Must be `null` when `status = "implemented"`.
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
  "recommended_next_stage": "execution | architecture | plan | null",
  "rework_reason": "string | null",
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
- `recommended_next_stage`: `null` when the reviewer sees no blocking issue. On a blocking review, use `execution` for implementation mistakes, `architecture` for architecture-level issues, and `plan` for planning/phase/ownership issues.
- `rework_reason`: Required when `recommended_next_stage` is not `null`. Must be `null` when `recommended_next_stage = null`.
- `suggestion`: Required for every `fail` and `warning`. Must be `null` for `pass`.

---

## review_feedback.json

Produced by: **Orchestrator**  
Consumed by: **Execution Agent**, **Doc Agent**

```json
{
  "version": "1.0",
  "iteration": 1,
  "mode": "EME | PRE",
  "verdict": "pass | fail",
  "recommended_next_stage": "execution | architecture | plan | null",
  "rework_reason": "string | null",
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
- `recommended_next_stage`: `null` when `verdict = "pass"`. When `verdict = "fail"`, use `execution`, `architecture`, or `plan` based on the dominant root cause after review aggregation.
- `rework_reason`: Required when `verdict = "fail"`. Must be `null` when `verdict = "pass"`.
- `eme_votes`: Exactly 8 entries in `EME`; in `PRE`, still emit 8 entries with a single repeated vote so downstream stages keep one shape.
- `final_score`: Determined by majority vote. `warning` counts as `pass` for voting.
- `consensus`: `"unanimous"` if all effective votes agree, otherwise `"majority"`.
- `merged_issues`: Empty array when `verdict` is `pass`.
- `verdict`: `pass` only when all 8 dimensions pass after aggregation.
- `blocking_issues_count`: Count of dimensions with `final_score = "fail"`.
- `warnings`: Preserve non-blocking review concerns even on pass.

---

## doc-report.json

Produced by: **Doc Agent**  
Consumed by: **Orchestrator**

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
