---
name: multi-agent-pipeline
description: >
  Run a Codex-compatible production pipeline for non-trivial implementation work:
  Brainstorming, Spec, Plan, Architecture, Dispatch, Execution, Complexity,
  Merge, Validation, Review, QA, Documentation, Final Assessment, and Cleanup.
  Use when the user asks for multi-agent, pipeline, staged delivery, full
  implementation, substantial refactor, or strict review/QA. The entrypoint is
  OpenCode-compatible and progressively discloses detailed rules through
  agents/, references/, scripts/, src/, and test/ files.
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
persistence, review aggregation, merge decisions, and final integration.
Subagents own bounded stage work.

## Progressive Disclosure

This file is the routing layer. Keep it short enough for OpenCode and Codex to
load cheaply, then read only the files needed for the current stage.

- First read this file to decide whether the pipeline applies.
- For Codex execution rules, read `references/codex-execution-model.md`.
- For OpenCode expert-mode setup, read `references/opencode-expert-mode.md`.
- For the phase-by-phase pipeline, read `references/pipeline-stages.md`.
- For workspace layout and pet events, read `references/workspace-and-events.md`.
- For orchestration, artifact, review, merge, and cleanup rules, read
  `references/orchestration-rules.md`.
- For subagent prompts, read only the current `agents/<stage>.md`.
- For artifact shapes, read `references/contracts.md`.
- For review scoring, read `references/pre-rubric.md` only when entering Review.
- For runnable prompt scaffolds, read `references/orchestrator-prompts.md`.
- For a full example, read `references/example-run.md` only when debugging or
  explaining a complete run.

Do not preload every reference file just because this skill was selected.

## When To Use

Use this pipeline for:

- New features spanning multiple files or subsystems
- Refactors with meaningful behavior, API, runtime, or documentation impact
- Tasks that need explicit implementation, validation, review, QA, and docs
- User requests mentioning `multi-agent`, `pipeline`, `production workflow`,
  `full implementation`, staged delivery, or strict review

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
-> Execution -> Complexity Hook -> Merge -> Validation -> Review
-> QA -> Documentation -> Final Assessment -> Cleanup
```

Local-only stages:

- Brainstorming
- Merge
- Cleanup

Subagent stages:

- Spec
- Plan
- Architecture
- Dispatch
- Execution
- Validation
- Review
- QA
- Documentation
- Final Assessment

## Non-Negotiable Rules

- The orchestrator is the source of truth for `.pipeline-workspace/` artifacts.
- Merge and Cleanup are orchestrator-local. Do not spawn subagents for them.
- Use conservative three-way merge semantics and pause for human resolution when
  automatic merge safety is ambiguous.
- Do not revert user edits or unrelated worktree changes.
- Dispatch owns skill routing. Later stages must not re-infer required skills.
- Spec and Plan must attach `superpowers` and restrict it to planning
  discipline only.
- Execution and Review must attach `ce-frontend-design` when Dispatch routes it.
- Validation must run before Review for every merged worker group unless it is
  explicitly skipped with evidence.
- Review defaults to `EME`; use `PRE` only for clearly small changes or when the
  user asks for a cheaper/faster pass.
- QA must pass before Documentation and Final Assessment.
- Accepted runs write `.pipeline-last-run-summary.json` and remove
  `.pipeline-workspace/`; rejected or paused runs keep the workspace.

## Stage Files

Read the current stage prompt just before spawning or running that stage:

| Stage | File | Required extra reference |
|---|---|---|
| Spec | `agents/spec.md` | `references/contracts.md` |
| Plan | `agents/plan.md` | `references/contracts.md` |
| Architecture | `agents/architecture.md` | `references/contracts.md` |
| Dispatch | `agents/dispatch.md` | `references/contracts.md` |
| Execution | `agents/execution.md` | `references/contracts.md` |
| Validation | `agents/validation.md` | `references/contracts.md` |
| Review | `agents/review.md` | `references/contracts.md`, `references/pre-rubric.md` |
| QA | `agents/qa.md` | `references/contracts.md` |
| Documentation | `agents/doc.md` | `references/contracts.md` |
| Final Assessment | `agents/final-assessment.md` | `references/contracts.md` |

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
review aggregation, final assessment, cleanup summaries, and Codex pet events.
Run tests from the skill package root with:

```text
npm test
```
