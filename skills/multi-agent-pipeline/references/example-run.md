# Example Run

This example shows one end-to-end run for a frontend-facing feature after the Hybrid v1 updates. It is illustrative, not normative. The contracts in `references/contracts.md` remain the source of truth.

The JSON blocks below are abbreviated excerpts. Repeated array items may be omitted when they do not change the point of the example.

## Scenario

User request:

> Update the dashboard shell to add a responsive left navigation, refresh the page header hierarchy, and keep analytics widgets functionally unchanged.

## Example Artifact Flow

### `spec.json`

```json
{
  "version": "1.0",
  "applied_skills": [],
  "feature_name": "Responsive dashboard shell refresh",
  "objective": "Improve dashboard navigation and visual hierarchy without changing analytics behavior.",
  "requirements": [
    {
      "id": "REQ-001",
      "description": "Add a responsive left navigation for desktop and mobile layouts.",
      "priority": "must-have",
      "acceptance_criteria": [
        "Desktop shows persistent left navigation.",
        "Mobile exposes equivalent navigation behind a clear toggle."
      ]
    },
    {
      "id": "REQ-002",
      "description": "Refresh header hierarchy while preserving analytics widget behavior.",
      "priority": "must-have",
      "acceptance_criteria": [
        "Header typography and spacing improve scannability.",
        "Existing analytics widget actions still behave the same."
      ]
    }
  ],
  "constraints": [
    "Do not change analytics API contracts."
  ],
  "out_of_scope": [
    "New analytics features"
  ],
  "assumptions": [
    "The existing design system remains the default visual language."
  ],
  "input_type": "natural_language",
  "original_input_summary": "Refresh the dashboard shell and header without changing analytics behavior."
}
```

### `plan.json`

```json
{
  "version": "1.0",
  "applied_skills": [],
  "spec_ref": "spec.json",
  "phases": [
    {
      "id": "PHASE-1",
      "name": "Layout and navigation updates",
      "tasks": [
        {
          "id": "TASK-001",
          "description": "Add responsive navigation shell and mobile toggle.",
          "depends_on": [],
          "estimated_complexity": "medium",
          "target_files": ["src/layout/DashboardShell.tsx", "src/layout/DashboardShell.test.tsx"]
        },
        {
          "id": "TASK-002",
          "description": "Refresh dashboard header hierarchy and spacing.",
          "depends_on": ["TASK-001"],
          "estimated_complexity": "low",
          "target_files": ["src/pages/DashboardPage.tsx", "src/pages/DashboardPage.test.tsx"]
        }
      ]
    }
  ],
  "execution_order": ["TASK-001", "TASK-002"],
  "risk_items": [
    "Responsive layout changes may regress keyboard navigation if focus order is not preserved."
  ]
}
```

### `architecture.json`

```json
{
  "version": "1.0",
  "spec_ref": "spec.json",
  "plan_ref": "plan.json",
  "codebase_analysis": {
    "relevant_modules": ["src/layout", "src/pages"],
    "current_patterns": ["Tailwind utility styling", "shared shell layout component"],
    "tech_debt": ["Header spacing is duplicated across dashboard pages"]
  },
  "decision": "incremental",
  "decision_rationale": "The requested change fits the existing shell and page structure.",
  "proposed_changes": [
    {
      "target": "src/layout/DashboardShell.tsx",
      "change_type": "modify",
      "description": "Add responsive left navigation and mobile toggle behavior.",
      "concerns": ["frontend_design"]
    },
    {
      "target": "src/pages/DashboardPage.tsx",
      "change_type": "modify",
      "description": "Refresh header hierarchy and spacing within the existing dashboard page.",
      "concerns": ["frontend_design"]
    }
  ],
  "dependency_changes": [],
  "feasibility": "feasible",
  "infeasibility_reason": null,
  "rollback_notes": null
}
```

### `dispatch.json`

```json
{
  "version": "1.0",
  "spec_ref": "spec.json",
  "plan_ref": "plan.json",
  "architecture_ref": "architecture.json",
  "worker_groups": [
    {
      "group_id": "GROUP-1",
      "tasks": ["TASK-001", "TASK-002"],
      "owned_files": [
        "src/layout/DashboardShell.tsx",
        "src/layout/DashboardShell.test.tsx",
        "src/pages/DashboardPage.tsx",
        "src/pages/DashboardPage.test.tsx"
      ],
      "depends_on_groups": [],
      "required_skills": ["ce-frontend-design"]
    }
  ],
  "execution_waves": [
    {
      "wave": 1,
      "groups": ["GROUP-1"]
    }
  ],
  "integration_strategy": {
    "merge_mode": "three_way",
    "conflict_policy": "pause_for_human",
    "base_strategy": "wave_start_snapshot"
  },
  "rationale": "Both tasks touch the same dashboard shell and page hierarchy, so they remain in one group."
}
```

### `execution-report.json`

```json
{
  "version": "1.0",
  "group_id": "GROUP-1",
  "iteration": 1,
  "base_ref": "bases/wave-1-group-1-base.json",
  "proposal_ref": "worker://GROUP-1/iteration-1",
  "applied_skills": ["ce-frontend-design"],
  "status": "implemented",
  "changed_files": [
    "src/layout/DashboardShell.tsx",
    "src/layout/DashboardShell.test.tsx",
    "src/pages/DashboardPage.tsx",
    "src/pages/DashboardPage.test.tsx"
  ],
  "requirements_covered": ["REQ-001", "REQ-002"],
  "frontend_design_summary": {
    "system_mode": "partial_system",
    "visual_thesis": "Extend the existing dashboard with calmer header hierarchy and clearer responsive navigation.",
    "content_plan": "Persistent desktop nav, mobile nav toggle, then header and widgets in a single vertical reading path.",
    "interaction_plan": [
      "Slide mobile nav in from the left with existing transition tokens.",
      "Use a subtle hover state for desktop nav items.",
      "Animate header actions only on focus and hover."
    ],
    "visual_verification_method": "Playwright screenshot",
    "visual_verification_result": "Desktop and mobile shell screenshots checked for layout regressions and hierarchy."
  },
  "tests_run": [
    {
      "command": "pnpm test DashboardShell DashboardPage",
      "status": "passed",
      "details": "Shell and page tests passed after responsive layout updates."
    }
  ],
  "follow_up_notes": [
    "Navigation spacing follows the existing Tailwind token scale."
  ],
  "blockers": []
}
```

### `complexity-report.json`

```json
{
  "version": "1.0",
  "group_id": "GROUP-1",
  "iteration": 1,
  "created_at": "2026-04-23T12:20:00Z",
  "analyzer": {
    "name": "better_highlights_cognitive_repro",
    "path": "scripts/better_highlights_cognitive_repro.py",
    "metric": "better-highlights-like cognitive complexity approximation",
    "medium_threshold": 15,
    "high_threshold": 25
  },
  "source": {
    "proposal_path": "/tmp/dashboard-shell-proposal",
    "changed_files": ["src/layout/DashboardShell.tsx", "src/pages/DashboardPage.tsx"]
  },
  "status": "skipped",
  "analyzed_files": [],
  "skipped_files": [
    {
      "file": "src/layout/DashboardShell.tsx",
      "reason": "not_python"
    },
    {
      "file": "src/pages/DashboardPage.tsx",
      "reason": "not_python"
    }
  ],
  "errors": [],
  "function_count": 0,
  "max_total_points": 0,
  "average_total_points": 0,
  "medium_complexity_functions": 0,
  "high_complexity_functions": 0,
  "readability_conclusion": "high",
  "complexity_conclusion": "low",
  "summary": "Readability high; complexity low. No changed Python files were available for cognitive complexity analysis.",
  "functions": []
}
```

### `merge-report.json`

```json
{
  "version": "1.0",
  "group_id": "GROUP-1",
  "iteration": 1,
  "base_ref": "bases/wave-1-group-1-base.json",
  "mainline_ref": "workspace://main-before-merge",
  "proposal_ref": "worker://GROUP-1/iteration-1",
  "result_ref": "workspace://main-after-merge",
  "status": "merged",
  "conflicts": []
}
```

### `tree_grading_feedback.json`

```json
{
  "version": "1.0",
  "group_id": "GROUP-1",
  "iteration": 1,
  "task_id": "GROUP-1-task",
  "threshold": 0.8,
  "require_depth_one_pass": true,
  "verdict": "pass",
  "weighted_score": 0.875,
  "pass_rate": 0.8,
  "num_branches": 3,
  "max_depth": 3,
  "nodes_passed": ["B1-D1-01", "B1-D2-01"],
  "nodes_failed": ["B2-D3-01"],
  "blocking_nodes": [],
  "non_blocking_nodes": ["B2-D3-01"],
  "node_results": [],
  "summary": "Tree grading passed with weighted_score 0.875."
}
```

### `qa-report.json`

```json
{
  "version": "1.0",
  "group_id": "GROUP-1",
  "iteration": 1,
  "status": "pass",
  "test_infrastructure": "configured",
  "test_results": [
    {
      "kind": "existing",
      "requirement_ids": ["REQ-001", "REQ-002"],
      "command": "pnpm test DashboardShell DashboardPage",
      "status": "passed",
      "details": "All targeted component tests passed."
    },
    {
      "kind": "scenario",
      "requirement_ids": ["REQ-001"],
      "command": "manual scenario",
      "status": "passed",
      "details": "Desktop nav remains visible; mobile nav toggle opens and closes correctly."
    }
  ],
  "blocking_issues": [],
  "notes": [
    "Temporary mobile viewport script removed before returning."
  ]
}
```

### `final-assessment.json`

```json
{
  "version": "1.0",
  "iteration": 1,
  "verdict": "accept",
  "dimension_scores": [
    {
      "dimension": "Requirement Completeness",
      "score": "strong",
      "evidence": "REQ-001 and REQ-002 are implemented, reviewed, and exercised in QA."
    }
  ],
  "improvement_areas": [
    {
      "dimension": "Overall Cohesion",
      "issue": "Mobile nav toggle focus state could be slightly stronger.",
      "recommendation": "Promote the focus ring token in the next dashboard polish pass."
    }
  ],
  "restart_from": null,
  "restart_rationale": null,
  "skill_usage_summary": [
    {
      "scope": "spec",
      "required_skills": [],
      "applied_skills": [],
      "issues": []
    },
    {
      "scope": "plan",
      "required_skills": [],
      "applied_skills": [],
      "issues": []
    },
    {
      "scope": "GROUP-1/execution",
      "required_skills": ["ce-frontend-design"],
      "applied_skills": ["ce-frontend-design"],
      "issues": []
    }
  ],
  "readability_conclusion": "high",
  "complexity_conclusion": "low",
  "complexity_summary": "Complexity reporting skipped the TypeScript-only changes as non-Python, so no high-complexity Python functions were introduced.",
  "summary": "The dashboard shell refresh satisfies the requested scope and remains aligned with the existing design system."
}
```

### `.pipeline-last-run-summary.json`

```json
{
  "version": "1.0",
  "run_id": "RUN-20260423-001",
  "completed_at": "2026-04-23T12:34:56Z",
  "verdict": "accept",
  "restart_from": null,
  "skill_usage_summary": [
    {
      "scope": "spec",
      "required_skills": [],
      "applied_skills": [],
      "issues": []
    },
    {
      "scope": "plan",
      "required_skills": [],
      "applied_skills": [],
      "issues": []
    },
    {
      "scope": "GROUP-1/execution",
      "required_skills": ["ce-frontend-design"],
      "applied_skills": ["ce-frontend-design"],
      "issues": []
    }
  ],
  "merge_summary": {
    "merged_groups": ["GROUP-1"],
    "conflicted_groups": [],
    "noop_groups": []
  },
  "qa_summary": [
    {
      "group_id": "GROUP-1",
      "status": "pass"
    }
  ],
  "validation_summary": [
    {
      "group_id": "GROUP-1",
      "status": "passed"
    }
  ],
  "complexity_summary": [
    {
      "group_id": "GROUP-1",
      "ref": "complexity/GROUP-1/iteration-1-complexity-report.json",
      "status": "skipped",
      "readability_conclusion": "high",
      "complexity_conclusion": "low",
      "function_count": 0,
      "max_total_points": 0
    }
  ],
  "tree_grading_summary": [
    {
      "group_id": "GROUP-1",
      "verdict": "pass",
      "weighted_score": 0.875,
      "nodes_failed": ["B2-D3-01"]
    }
  ],
  "cleanup_summary": {
    "deleted_workspace": true,
    "deleted_paths": [".pipeline-workspace"],
    "retained_file": ".pipeline-last-run-summary.json"
  }
}
```

## Notes

- A real run may contain multiple grader outputs, multiple merge iterations, or a `pause_for_human` branch with `conflict-resolution.json`.
- When merge pauses, `.pipeline-last-run-summary.json` may still be written, but `.pipeline-workspace/` must stay intact until the run is resolved or rejected.
