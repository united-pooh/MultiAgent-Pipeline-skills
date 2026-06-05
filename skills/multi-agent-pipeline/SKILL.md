---
name: multi-agent-pipeline
description: >
  Run a Codex-compatible production pipeline for non-trivial implementation work:
  Brainstorming, Spec, Plan, Architecture, Dispatch, Execution, Complexity,
  Merge, Validation, Tree Rubrics, Tree Grading, QA, Documentation, Final
  Assessment, and Cleanup. Use when the user asks for multi-agent, pipeline,
  staged delivery, full implementation, substantial refactor, or strict
  validation/grading. The entrypoint is OpenCode-compatible and progressively
  discloses detailed rules through agents/, references/, scripts/, src/, and
  test/ files.
compatibility: codex, opencode
metadata:
  audience: orchestrators
  disclosure: progressive
  opencode_agent: multi-agent-pipeline-expert
---

# Multi-Agent Production Pipeline

Use this skill when the task is large enough to benefit from explicit staging
instead of ad hoc implementation.

The local agent is the orchestrator. It owns user communication, artifact
persistence, tree-grading aggregation, merge decisions, and final integration.
Subagents own bounded stage work.

## Progressive Disclosure

This file is the routing layer. Keep it short enough for OpenCode and Codex to
load cheaply, then read only the files needed for the current stage.

- First read this file to decide whether the pipeline applies.
- For Codex execution rules, read `references/codex-execution-model.md`.
- For OpenCode expert-mode setup, read `references/opencode-expert-mode.md`.
- For the phase-by-phase pipeline, read `references/pipeline-stages.md`.
- For workspace layout and pet events, read `references/workspace-and-events.md`.
- For orchestration, artifact, grading, merge, and cleanup rules, read
  `references/orchestration-rules.md`.
- For subagent prompts, read only the current `agents/<stage>.md`.
- For artifact shapes, read `references/contracts.md`.
- For nearby JSON skeletons, read only the current
  `templates/artifacts/<artifact>.json`.
- For legacy PRE review scoring, read `references/pre-rubric.md` only when
  explicitly using the deprecated Review stage.
- For runnable prompt scaffolds, read `references/orchestrator-prompts.md`.
- For a full example, read `references/example-run.md` only when debugging or
  explaining a complete run.

Do not preload every reference file just because this skill was selected.

## When To Use

Use this pipeline for:

- New features spanning multiple files or subsystems
- Refactors with meaningful behavior, API, runtime, or documentation impact
- Tasks that need explicit implementation, validation, tree grading, QA, and
  docs
- User requests mentioning `multi-agent`, `pipeline`, `production workflow`,
  `full implementation`, staged delivery, or strict grading

Skip this pipeline for:

- Tiny one-file edits
- Pure Q&A or design discussion
- Tasks where the user explicitly wants a quick direct patch

If the user explicitly invokes this skill, treat that as authorization for
subagent delegation and safe parallel work within the current host constraints.
Ask only for blocking ambiguities.

## Pipeline Map

```text
Brainstorming -> Spec -> Plan -> Architecture -> Dispatch
-> Execution -> Complexity Hook -> Merge -> Validation
-> Tree Classification -> Tree Rubric Generation -> Tree Rubric Verification
-> Tree Rubric Refinement -> Tree Grading -> QA
-> Documentation -> Final Assessment -> Cleanup
```

Local-only stages:

- Brainstorming
- Merge
- Final output file collection for grading
- Tree grading aggregation
- Cleanup

Subagent stages:

- Spec
- Plan
- Architecture
- Dispatch
- Execution
- Validation
- Tree Classification
- Tree Rubric Generation
- Tree Rubric Verification
- Tree Rubric Refinement
- Tree Grading
- QA
- Documentation
- Final Assessment

The legacy `Review` stage and PRE rubric remain as compatibility artifacts, but
the active quality gate is Tree Rubrics plus Tree Grading.

## Non-Negotiable Rules

- The orchestrator is the source of truth for `.pipeline-workspace/` artifacts.
- Merge, final output collection, grading aggregation, and Cleanup are
  orchestrator-local.
- Use conservative three-way merge semantics and pause for human resolution when
  automatic merge safety is ambiguous.
- Do not revert user edits or unrelated worktree changes.
- Dispatch owns skill routing. Later stages must not re-infer required skills.
- Spec and Plan must attach `superpowers` and restrict it to planning
  discipline only.
- Execution must attach `ce-frontend-design` when Dispatch routes it.
- Validation must run before Tree Rubrics for every merged worker group unless
  it is explicitly skipped with evidence.
- Tree Grading uses 3 independent graders by default. Do not downgrade the
  grader count unless the user explicitly asks for a cheaper/faster pass.
- Tree Grading must judge only `spec`, `tree_rubrics_refined.json`, and
  `final-output-files.json`; do not grade process logs or agent behavior.
- QA must pass before Documentation and Final Assessment.
- Accepted runs write `.pipeline-last-run-summary.json` and remove
  `.pipeline-workspace/`; rejected or paused runs keep the workspace.
- Git publication is opt-in and orchestrator-local; subagents must not commit
  or push.

## Stage Files

Read the current stage prompt just before spawning or running that stage:

| Stage | File | Required extra reference | Template |
|---|---|---|---|
| Spec | `agents/spec.md` | `references/contracts.md` | `templates/artifacts/spec.json` |
| Plan | `agents/plan.md` | `references/contracts.md` | `templates/artifacts/plan.json` |
| Architecture | `agents/architecture.md` | `references/contracts.md` | `templates/artifacts/architecture.json` |
| Dispatch | `agents/dispatch.md` | `references/contracts.md` | `templates/artifacts/dispatch.json` |
| Execution | `agents/execution.md` | `references/contracts.md` | `templates/artifacts/execution-report.json` |
| Validation | `agents/validation.md` | `references/contracts.md` | `templates/artifacts/validation-report.json` |
| Tree Classification | `agents/tree-classification.md` | `references/contracts.md` | `templates/artifacts/tree-classification.json` |
| Tree Rubric Generation | `agents/tree-rubric-generation.md` | `references/contracts.md` | `templates/artifacts/tree-rubrics.json` |
| Tree Rubric Verification | `agents/tree-rubric-verification.md` | `references/contracts.md` | `templates/artifacts/tree-rubric-verification.json` |
| Tree Rubric Refinement | `agents/tree-rubric-refinement.md` | `references/contracts.md` | `templates/artifacts/tree-rubrics-refined.json` |
| Tree Grading | `agents/tree-grading.md` | `references/contracts.md` | `templates/artifacts/tree-grading-individual.json` |
| QA | `agents/qa.md` | `references/contracts.md` | `templates/artifacts/qa-report.json` |
| Documentation | `agents/doc.md` | `references/contracts.md` | `templates/artifacts/doc-report.json` |
| Final Assessment | `agents/final-assessment.md` | `references/contracts.md` | `templates/artifacts/final-assessment.json` |
| Legacy Review | `agents/review.md` | `references/contracts.md`, `references/pre-rubric.md` | `templates/artifacts/review-individual.json` |

## Host Notes

### Codex

Codex can use the runtime and stage catalog in `src/` plus the prompt templates
in `references/orchestrator-prompts.md`. Keep detailed Codex tool behavior in
`references/codex-execution-model.md`.

### OpenCode

OpenCode discovers `name` and `description` first, then loads this file through
the native `skill` tool only when needed. This entrypoint is intentionally short
and points to references on demand.

Install the skill into one of OpenCode's skill search paths, for example:

```text
.opencode/skills/multi-agent-pipeline/SKILL.md
~/.config/opencode/skills/multi-agent-pipeline/SKILL.md
```

For a copy-ready expert primary agent, use
`templates/opencode-expert-agent.md` with the guidance in
`references/opencode-expert-mode.md`.

## Runtime

The Node runtime under `src/runtime/` implements the documented contracts for
artifact storage, stage catalogs, merge, complexity analysis, validation flow,
Tree Rubrics, Tree Grading, final assessment, cleanup summaries, and Codex pet
events. Optional Git publication uses gitmoji plus Conventional Commits style
Chinese messages. Run tests from the skill package root with:

```text
npm test
```
