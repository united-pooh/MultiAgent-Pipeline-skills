# Codex Execution Model

This file contains Codex-specific orchestration rules. The main `SKILL.md`
points here so OpenCode and other hosts do not load Codex tool details unless
they need them.

## Orchestrator Responsibilities

The local Codex agent is the orchestrator. It owns:

- User communication
- `.pipeline-workspace/` artifact persistence
- Stage prompt construction
- Tree Rubrics and Tree Grading aggregation
- Merge and conflict decisions
- Final integration decisions and cleanup bookkeeping

Subagents own bounded stage work and return structured artifacts or proposal
metadata. The orchestrator validates and writes canonical artifacts locally,
limited to pipeline state such as `.pipeline-workspace/` and `.pipeline-runs/`.

## Write Authority

- The orchestrator/main agent must never modify code or repo files directly.
- The orchestrator may read code, dispatch stages, write pipeline workspace bookkeeping,
  validate artifacts, aggregate feedback, and report status.
- File/code mutations are only allowed in Execution-stage worker subagents.
- Validation, QA, Doc, Tree Rubrics, Tree Grading, Review, Final Assessment,
  and every other non-Execution stage are read-only. They send failures,
  required changes, and quality feedback back to Execution for repair.

## Subagent Delegation

- Use `spawn_agent` for delegated stages.
- Default to `fork_context: true` only when the subagent genuinely needs the
  current conversation history.
- Prefer `fork_context: false` with explicit artifacts and file paths when a
  pinned profile, tool role, or bounded write scope matters.
- When using a full-history fork, omit `agent_type`, `model`,
  `reasoning_effort`, and `service_tier`; put the intended stage role in the
  prompt text.
- Keep orchestration local. Subagents produce artifacts or proposals; the
  orchestrator decides the next step.
- Close completed agents after their outputs are integrated.
- Before Tree Grading, close finished stage agents so the three-grader fan-out
  does not fail on thread limits.

When the user explicitly invokes this skill, treat that as authorization for
subagent delegation and safe parallel work required by host policy. Do not ask
again unless a separate blocker remains.

## Parallelism Policy

- Maximize safe concurrency subject to disjoint ownership, dependencies, merge
  safety, and actual thread capacity.
- Plan should expose implementation-sized tasks that preserve future worker
  independence when the codebase permits it.
- Architecture should prefer equally-correct designs that reduce shared-file
  contention.
- Dispatch should treat a single-group result as a last resort caused by real
  dependency or ownership constraints.
- Same-wave Execution workers should start together when ownership is disjoint.
- Validation and QA for multiple eligible groups in the same wave may run
  concurrently when host capacity allows.
- If thread pressure forces a reduction, shrink only the contended fan-out and
  retry. Preserve staged delegation whenever safe.

## Recommended Agent Roles

| Stage | Role target |
|---|---|
| Spec | `default` |
| Plan | `default` |
| Architecture | `default` |
| Dispatch | `default` |
| Execution | `worker` |
| Validation | `worker` |
| Tree Classification | `default` |
| Tree Rubric Generation | `default` |
| Tree Rubric Verification | `default` |
| Tree Rubric Refinement | `default` |
| Tree Grading | `default` |
| QA | `worker` |
| Documentation | `worker` |
| Final Assessment | `default` |
| Merge | orchestrator-local |
| Cleanup | orchestrator-local |

Use `explorer` only for narrow side questions during architecture or grading,
not for the main pipeline stages.

## Model And Wait Policy

Default Codex stage profiles are pinned in `src/runtime/constants.js`:

- `model: "gpt-5.5"`
- `reasoningEffort: "xhigh"`
- `serviceTier: "priority"`
- `waitTimeoutMs: 600000`

Treat that as the standard "gpt5.5 xhigh fast" setting for this skill. The
current Codex `spawn_agent` schema exposes `priority` as the service tier for
`gpt-5.5`.

Use an explicit long `wait_agent` timeout whenever the next pipeline step is
blocked on a subagent:

```json
{
  "targets": ["<agent_id>"],
  "timeout_ms": 600000
}
```

If a wait returns empty or timed out, treat the agent as still running. Wait
again with the same long timeout unless a real blocker appears.

While a blocking stage runs, continue non-overlapping local work: initialize the
workspace, preload upcoming prompts, validate completed artifacts, prepare
merge/grading bookkeeping, and close finished agents.
