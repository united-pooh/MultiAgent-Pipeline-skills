# MCP Migration Design

## Goal

Move this branch from a Codex/OpenCode skill-first package to a durable MCP
server product that external MCP clients and Codex can both call. The existing
pipeline runtime, contracts, prompts, artifacts, and grading rules remain the
domain core, but the primary entrypoint on this branch becomes a top-level MCP
server package.

## Acceptance Standard

- A top-level `mcp-server/` package exposes a Multi-Agent Pipeline MCP server.
- The server supports both newline-delimited stdio JSON-RPC and Streamable
  HTTP-style JSON-RPC over a single `/mcp` endpoint.
- MCP clients can discover deterministic `tools`, `resources`, and `prompts`.
- The server stores structured run inputs, configuration, state, events,
  artifacts, research notes, and git checkpoint metadata under `.pipeline-runs/`.
- Long-running work is represented by durable run IDs and can be queried,
  resumed, cancelled, and exported after client disconnects.
- Runtime thresholds are explicit: maximum runtime, maximum iteration count,
  and optional budget metadata are persisted with each run.
- Git checkpoints are orchestrator-owned and opt-in; every checkpoint is logged
  in run state even when the actual git commit is a dry run.
- The current six-slot worker pool, three-slot Tree Grading reservation,
  early review flow, QA retry flow, and `REPLAN_REQUIRED:` restart contract
  remain part of the pipeline runtime and are not weakened by the MCP layer.
- The old `skills/multi-agent-pipeline/SKILL.md` no longer acts as the primary
  pipeline orchestrator entrypoint. It becomes a thin Codex adapter that points
  clients at the MCP server.

## Architecture

The migration uses three layers:

1. `skills/multi-agent-pipeline/src/runtime/` remains the core pipeline
   runtime library. It owns contracts, artifact storage, merge semantics,
   validation, Tree Rubrics, Tree Grading, QA, and optional git automation.
2. `mcp-server/` is a top-level independent package. It owns MCP JSON-RPC
   protocol routing, stdio and HTTP transports, durable run ledger management,
   MCP tool/resource/prompt registration, and smoke-testable client behavior.
3. `skills/multi-agent-pipeline/SKILL.md` becomes a thin adapter. Codex should
   use the MCP server rather than re-implementing the orchestrator in the skill
   entrypoint.

This design intentionally keeps the first MCP server implementation protocol
native instead of deeply binding to a specific SDK API surface. The MCP boundary
uses standard JSON-RPC shapes and is small enough to swap to an SDK transport
adapter later.

## MCP Surface

### Tools

- `pipeline.start_run`: create or return an idempotent durable run.
- `pipeline.get_run`: read durable state for one run.
- `pipeline.list_runs`: list known runs in deterministic order.
- `pipeline.cancel_run`: cooperatively cancel a run.
- `pipeline.resume_run`: transition a paused/cancelled run back to working.
- `pipeline.submit_human_input`: persist human input for paused runs.
- `pipeline.run_stage`: persist one stage request/output handoff.
- `pipeline.validate_artifact`: validate any known pipeline artifact contract.
- `pipeline.inspect_workspace`: inspect `.pipeline-workspace/`,
  `.pipeline-runs/`, and last summary state.
- `pipeline.export_summary`: produce a compact structured run summary.
- `pipeline.commit_checkpoint`: optionally create a git checkpoint and always
  record checkpoint metadata.
- `pipeline.research`: save structured research queries, source URLs, fetched
  excerpts when requested, and citation metadata.
- `pipeline.install_codex_adapter`: report or perform local adapter sync.

All tool results return both `structuredContent` and a serialized JSON text
block for broad client compatibility.

### Resources

- `pipeline://runs`
- `pipeline://runs/{runId}/state`
- `pipeline://runs/{runId}/events`
- `pipeline://runs/{runId}/artifacts/{name}`
- `pipeline://runs/{runId}/research`
- `pipeline://contracts/{artifactType}`
- `pipeline://prompts/{stage}`
- `pipeline://workspace/summary`

### Prompts

The server exposes one prompt per pipeline stage, using the existing agent
prompt files as source material:

- `pipeline/spec`
- `pipeline/plan`
- `pipeline/architecture`
- `pipeline/dispatch`
- `pipeline/execution`
- `pipeline/validation`
- `pipeline/tree-classification`
- `pipeline/tree-rubric-generation`
- `pipeline/tree-rubric-verification`
- `pipeline/tree-rubric-refinement`
- `pipeline/tree-grading`
- `pipeline/qa`
- `pipeline/doc`
- `pipeline/final-assessment`

## Durable State

Each run is stored under:

```text
.pipeline-runs/
  RUN-ID/
    run.json
    config.json
    state.json
    events.jsonl
    artifacts/
    checkpoints/
    research/
```

The run ledger is append-friendly and safe for long-running operation. A run
can be reconstructed from `run.json`, `state.json`, and `events.jsonl` without
the original client context.

## Idempotency

`pipeline.start_run` accepts an optional `idempotencyKey`. If absent, the server
derives an idempotency hash from the normalized objective, repo root,
thresholds, and structured input. Starting the same run again returns the
existing run instead of duplicating state. Destructive operations such as git
checkpoints require explicit tool parameters.

## Research

The MCP server may fetch current URLs only when the tool call requests source
fetching. Research records store query text, source URLs, fetch timestamps,
HTTP status, content excerpts, and notes. The pipeline can later cite these
research resources without keeping full source text in model context.

## Error Handling

MCP protocol errors use JSON-RPC error responses. Pipeline-domain terminal
conditions preserve structured `restartFrom` semantics such as `dispatch`,
`execution`, or `merge`. `REPLAN_REQUIRED:` remains a first-blocker contract
owned by Execution.

## Verification

- `npm test` in `skills/multi-agent-pipeline` stays green.
- `npm test` in `mcp-server` covers protocol routing, durable run state,
  resources, prompts, tools, stdio smoke, and HTTP smoke.
- `git diff --check` remains clean.
- Installed Codex adapter parity can be verified with `diff -qr` after sync.
