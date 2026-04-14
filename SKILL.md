---
name: multi-agent-pipeline
description: >
  Multi-agent production pipeline for implementing features end-to-end. Orchestrates 6 specialized agents
  (Spec, Plan, Architecture, Execution, Review, Doc) in a structured pipeline with feedback loops.
  Use this skill whenever the user wants to implement a feature, build a new module, refactor a subsystem,
  or make any non-trivial code change that benefits from systematic planning, architecture analysis,
  and quality review. Also trigger when the user mentions "pipeline", "multi-agent", "production workflow",
  "full implementation", or wants a feature built with proper spec/plan/review process.
  Works in both Claude Code (parallel agents) and Codex (sequential fallback).
---

# Multi-Agent Production Pipeline

A 6-agent pipeline that takes a feature request from spec to delivery, following production-grade software engineering practices.

## Pipeline Overview

```
User Input (feature / doc)
        │
        ▼
  ┌───────────┐
  │ Spec Agent │◄──────────────────────┐
  └─────┬─────┘                        │
        │ spec.json                    │ Infeasible
        ▼                             │ (user intervenes)
  ┌───────────┐                        │
  │ Plan Agent │                       │
  └─────┬─────┘                        │
        │ plan.json                    │
        ▼                             │
  ┌────────────────┐                   │
  │ Architecture   │───────────────────┘
  │ Agent          │
  └─────┬──────────┘
        │ architecture.json
        ▼
  ┌────────────────┐◄─── review_feedback.json
  │ Execution Agent│         │
  └─────┬──────────┘         │
        │ changes done        │
        ▼                    │
  ┌────────────┐             │
  │ Review Agent│─── fail ───┘
  └─────┬──────┘
        │ pass
        ▼
  ┌───────────┐
  │ Doc Agent  │
  └─────┬─────┘
        │
        ▼
  Final Delivery (code + docs)
```

## Orchestration Logic

### Step 0: Pipeline Configuration

Before starting the pipeline, ask the user one configuration question:

> **Review mode**: EME (3 independent reviewers with majority vote) or PRE (single reviewer)? Default: **EME**

If the user doesn't have a preference, use EME. Store the choice and use it in Step 5.

- **EME**: Spawn 3 Review Agents in parallel, aggregate via majority vote. More robust, catches more issues, but costs 3x review tokens.
- **PRE**: Spawn 1 Review Agent. Faster and cheaper, suitable for smaller changes or when token budget is tight.

### Step 1: Spec

Spawn the Spec Agent. It reads the user's input (natural language or document), asks 2-3 clarifying questions to align intent, then produces `spec.json`. Once the user confirms the spec, the pipeline becomes fully automatic (except for Architecture rollback).

Read `agents/spec.md` for the full agent instructions.

### Step 2: Plan

Spawn the Plan Agent with `spec.json` as input. It breaks down the feature into phases, tasks, dependencies, and risk items. Outputs `plan.json`.

Read `agents/plan.md` for the full agent instructions.

### Step 3: Architecture Analysis

Spawn the Architecture Agent with `spec.json` + `plan.json`. It:
- Scans the codebase to understand current architecture
- Evaluates whether the existing architecture supports the planned changes
- Decides: **refactor**, **incremental change**, or **hybrid**
- Designs the implementation approach
- Outputs `architecture.json`

**Rollback gate**: If `feasibility` is `"infeasible"`, STOP the pipeline. Present `infeasibility_reason` and `rollback_notes` to the user. The user must adjust requirements, then restart from Step 1 (Spec).

Read `agents/architecture.md` for the full agent instructions.

### Step 4: Execution

Spawn the Execution Agent with `spec.json` + `plan.json` + `architecture.json`. It implements all changes according to the plan and architecture decision.

If this is a retry (Review failed), it also receives `review_feedback.json` and must address every issue marked `critical` or `major` before resubmitting.

Read `agents/execution.md` for the full agent instructions.

### Step 5: Review

The review mode depends on the user's choice in Step 0.

**If EME (default):** Spawn **3 independent Review Agents** in parallel. Each performs a full **Pointwise Rubric Evaluation (PRE)** — evaluating the implementation against 8 dimensions independently, scored as pass/fail/warning with evidence. The 3 reviewers do not see each other's results.

**If PRE:** Spawn **1 Review Agent** that performs the same 8-dimension evaluation. Output goes directly to `review_feedback.json` (no EME voting layer).

The 8 PRE dimensions:
1. **Correctness** — Does it meet spec requirements and acceptance criteria?
2. **Security** — Any injection, privilege escalation, data leak risks?
3. **Performance** — N+1 queries, unnecessary allocations, blocking calls?
4. **Error Handling** — Edge cases and error paths covered?
5. **Code Quality** — Naming, structure, readability, project style consistency?
6. **Architecture Compliance** — Does it follow the architecture.json design?
7. **Test Coverage** — Critical paths have tests?
8. **Backward Compatibility** — Existing APIs/interfaces preserved?

**EME voting rules:**
After all 3 reviewers complete, aggregate results per dimension using majority vote:
- 2/3 or 3/3 score `pass` → dimension passes
- 2/3 or 3/3 score `fail` → dimension fails
- Ties are impossible with 3 voters
- `warning` counts as `pass` for voting purposes, but all warnings are preserved in the final report

**Verdict rules:**
- All 8 dimensions pass after voting → `verdict: "pass"` → proceed to Doc
- Any dimension fails after voting → `verdict: "fail"` → merge all `fail` issues from all 3 reviewers into `review_feedback.json` → send back to Execution Agent

Each reviewer is strict and critical. There is no retry limit — the loop continues until the implementation meets best practices with no remaining optimization opportunities.

**Codex fallback:** When subagents are unavailable, run 3 sequential review passes with explicit instruction to evaluate independently (reset context between passes).

Read `agents/review.md` and `references/pre-rubric.md` for the full rubric.

### Step 6: Documentation

Only runs after Review passes. Spawn the Doc Agent. It analyzes the changes and automatically determines which documents to update:
- `README.md` — if user-facing behavior changed
- API documentation — if endpoints/interfaces changed
- `CHANGELOG.md` — always, summarizing what was added/changed/fixed

Read `agents/doc.md` for the full agent instructions.

## Inter-Agent Communication

All agents communicate through JSON files with strict schemas. This ensures unambiguous, verifiable data transfer. See `references/contracts.md` for the complete schemas.

**Artifact files** (stored in a workspace directory):
- `spec.json` — Feature specification
- `plan.json` — Implementation plan
- `architecture.json` — Architecture analysis and decision
- `review_feedback.json` — PRE evaluation results (per review iteration)

## Environment Compatibility

### Claude Code (subagent support)
- Agents run as subagents via the Agent tool
- Full parallel capability available (though this pipeline is mostly sequential by design)

### Codex (no subagent support)
- All agents run sequentially in the same context
- Same JSON contracts, same PRE rubric
- The orchestrator executes each agent's instructions inline, one at a time
- Write each JSON artifact to disk between steps so state is preserved

### Detection Logic
At skill start, check for subagent availability:
- If Agent tool is available → use subagent mode
- Otherwise → use sequential inline mode

## Workspace Setup

Create a workspace directory for the pipeline run:
```
.pipeline-workspace/
├── spec.json
├── plan.json
├── architecture.json
├── review_feedback.json      (latest)
├── review_history/
│   ├── iteration-1.json
│   ├── iteration-2.json
│   └── ...
└── logs/
    └── pipeline.log
```

## Error Handling

| Scenario | Action |
|---|---|
| Spec Agent can't clarify intent | Ask user for more detail |
| Architecture infeasible | Halt pipeline, present to user, restart from Spec |
| Execution fails (runtime error) | Execution Agent self-diagnoses and retries |
| Review finds critical issues | Send feedback to Execution, loop |
| Doc Agent can't determine what to update | Update CHANGELOG only as minimum |
