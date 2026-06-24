# Workspace And Event Layout

This file records the durable runtime layout and optional Codex pet state event
bridge. Read it when initializing, validating, debugging, or explaining runtime
artifacts.

## Run Workspace

Create `.pipeline-workspace/` before the first stage:

```text
.pipeline-workspace/
├── design.md
├── spec.md
├── spec.json
├── plan.json
├── architecture.json
├── dispatch.json
├── doc-report.json
├── final-assessment.json
├── bases/
├── execution/
├── complexity/
├── merge/
├── validation/
├── conflict_resolutions/
├── tree_rubrics/
│   └── GROUP-1/
│       ├── iteration-1-classification.json
│       ├── iteration-1-tree-rubrics.json
│       ├── iteration-1-validation-result.json
│       └── iteration-1-tree-rubrics-refined.json
├── final_outputs/
│   └── GROUP-1/
│       └── iteration-1-final-output-files.json
├── grading_history/
│   └── GROUP-1/
│       ├── iteration-1-grader-1.json
│       ├── iteration-1-grader-2.json
│       ├── iteration-1-grader-3.json
│       └── iteration-1-tree-grading-feedback.json
├── qa/
├── assessment_history/
└── logs/
    └── pipeline.log
```

The orchestrator writes these files locally after each stage.
`references/contracts.md` defines payload shape only; this layout is the
orchestrator storage convention for per-group and per-iteration artifacts.

Do not rely on subagents to persist canonical artifacts in the main workspace.

## Terminal Summary

On terminal runs, the orchestrator may write `.pipeline-last-run-summary.json`
at the repository root.

- Accepted runs keep `.pipeline-last-run-summary.json` and remove
  `.pipeline-workspace/`.
- Rejected or paused runs may still write `.pipeline-last-run-summary.json`, but
  must preserve `.pipeline-workspace/`.

## Codex Pet State Events

The runtime emits Codex pet state events as an optional host-facing bridge. The
events do not assume live avatar support; they provide durable JSON and a
directive string a compatible Codex Desktop build can consume.

Locations:

- During a run, append JSON Lines to
  `.pipeline-workspace/logs/codex-pet-events.jsonl`.
- At terminal completion or pause, include the ordered list in
  `.pipeline-last-run-summary.json` under `codex_pet_events`.

Event shape:

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

State mapping:

- `running`: Spec, Plan, Execution, Validation, QA, Doc, and other active
  pipeline stages
- `review`: Tree Rubrics, Tree Grading, and Final Assessment
- `failed`: Validation failure, Tree Grading failure, or rejected run
- `waiting`: pause for human input, including merge conflicts
- `waving`: accepted final result

Use `::codex-pet{...}` only as a host directive. The structured event object is
canonical and must remain valid even when the host ignores the directive string.
