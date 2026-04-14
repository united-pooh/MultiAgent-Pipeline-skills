# JSON Contract Schemas

All inter-agent communication uses these strict JSON schemas. Every agent must validate its input and produce output that conforms exactly to these schemas.

## spec.json

Produced by: **Spec Agent**
Consumed by: **Plan Agent**, **Architecture Agent**, **Execution Agent**, **Review Agent**

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
- `risk_items`: At least one entry. If no risks identified, state "No significant risks identified" with rationale.

---

## architecture.json

Produced by: **Architecture Agent**
Consumed by: **Execution Agent**, **Review Agent**

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
  "rollback_notes": "string | null — what the user needs to reconsider if infeasible"
}
```

### Field Rules
- `decision`: Choose based on analysis — `incremental` for small changes that fit current architecture, `refactor` for structural changes needed, `hybrid` for targeted refactoring combined with incremental additions.
- `feasibility`: Set to `infeasible` only when the current architecture fundamentally cannot support the feature without changes that would violate stated constraints.
- `infeasibility_reason` and `rollback_notes`: Must be non-null when `feasibility` is `infeasible`. Must be `null` when `feasible`.
- `dependency_changes`: Empty array if no dependency changes needed.

---

## Individual Reviewer Output: `review_individual_N.json`

Produced by: **Each of the 3 Review Agents**
Consumed by: **Orchestrator** (for EME aggregation)

Each reviewer independently produces this structure:

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

---

## review_feedback.json (EME Aggregated)

Produced by: **Orchestrator** (after merging 3 reviewer outputs via majority vote)
Consumed by: **Execution Agent** (on fail)

```json
{
  "version": "1.0",
  "iteration": 1,
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
  "blocking_issues_count": 0
}
```

### Field Rules
- `eme_votes`: Exactly 8 entries, one per PRE dimension. Shows all 3 votes and the majority result.
- `final_score`: Determined by majority vote. `warning` counts as `pass` for voting. 2/3 or 3/3 in the same direction wins.
- `consensus`: `"unanimous"` if 3/3 agree, `"majority"` if 2/3.
- `merged_issues`: Only present when `verdict` is `"fail"`. Contains all issues from all reviewers that contributed to failing dimensions. Deduplicate overlapping issues but preserve unique findings.
- `flagged_by`: Array of `reviewer_id`s that identified this issue.
- `verdict`: `"pass"` only when all 8 dimensions pass after voting.
- `iteration`: Increments with each review cycle. Starts at 1.
- `blocking_issues_count`: Count of dimensions with `final_score: "fail"`. Must be 0 for `verdict: "pass"`.
