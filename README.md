# Multi-Agent Pipeline MCP Server

This branch migrates `multi-agent-pipeline` from a skill-first workflow into a
durable MCP server product.

The primary entrypoint is now the top-level `mcp-server/` package. Codex,
OpenCode, Claude Desktop, Cursor, and other MCP clients should call the server
through MCP tools, resources, and prompts. The old skill directory remains as
the domain core: it still provides runtime contracts, stage prompts, artifact
templates, merge/validation/tree-grading logic, and tests.

## Product Shape

```text
Core Runtime + MCP Server + Thin Codex Adapter
```

| Layer | Responsibility |
|---|---|
| `mcp-server/` | MCP JSON-RPC routing, stdio transport, Streamable HTTP-style endpoint, durable run ledger, tools/resources/prompts |
| `skills/multi-agent-pipeline/src/runtime/` | Pipeline contracts, artifact store, merge engine, validation, Tree Rubrics, Tree Grading, QA, git automation |
| `skills/multi-agent-pipeline/SKILL.md` | Thin Codex adapter that points Codex at the MCP server instead of re-orchestrating the pipeline from skill text |

## Write Authority Boundary

The main agent/orchestrator must never modify code or repo files directly. It
may read code, schedule stages, write MCP run bookkeeping under `.pipeline-runs/`,
validate artifacts, aggregate feedback, and report status.

File/code mutations are only allowed in Execution-stage worker subagents.
Validation, QA, Doc, Tree Rubrics, Tree Grading, Review, Final Assessment, and
other non-Execution stages are read-only; they send failures, required changes,
and feedback back to Execution for repair.

## Run The MCP Server

### stdio

```bash
cd /path/to/multi-agent-pipeline
node mcp-server/src/cli.js --transport stdio --repo-root "$PWD"
```

The stdio transport writes JSON-RPC responses to stdout and operational logs to
stderr, so stdout remains safe for MCP protocol frames.

### Streamable HTTP-Style Endpoint

```bash
cd /path/to/multi-agent-pipeline
node mcp-server/src/cli.js --transport http --host 127.0.0.1 --port 3333 --repo-root "$PWD"
```

The HTTP server exposes:

```text
POST /mcp
GET  /healthz
```

`POST /mcp` accepts JSON-RPC requests and returns JSON responses. It is shaped
for Streamable HTTP clients while keeping request-scoped JSON responses for
deterministic local smoke tests.

### Portable Defaults

The server is safe to run from a fresh clone without machine-specific paths:

- `repoRoot` defaults to the current working directory.
- `skillRoot` resolves in this order:
  1. `--skill-root`
  2. `MULTI_AGENT_PIPELINE_SKILL_ROOT`
  3. `<repoRoot>/skills/multi-agent-pipeline`
  4. bundled repository/package resources
- `MULTI_AGENT_PIPELINE_REPO_ROOT` can set the default repo root when
  `--repo-root` is omitted.
- HTTP binds to `127.0.0.1` by default. Use `--host 0.0.0.0` only when you
  intentionally want to expose it beyond localhost.
- Browser CORS headers are disabled by default. Set
  `--cors-origin <origin>` or `MULTI_AGENT_PIPELINE_CORS_ORIGIN` only for a
  trusted local browser client.

For long-running local deployments, set `--repo-root` explicitly so reconnects
and background supervisors always write `.pipeline-runs/` to the intended
checkout.

Register the HTTP endpoint with Codex CLI:

```bash
codex mcp add multi-agent-pipeline --url http://127.0.0.1:3333/mcp
```

## MCP Surface

### Tools

| Tool | Purpose |
|---|---|
| `pipeline.start_run` | Create or return an idempotent durable run under `.pipeline-runs/` |
| `pipeline.get_run` | Read one run's state, config, and events |
| `pipeline.list_runs` | List durable runs |
| `pipeline.cancel_run` | Cooperatively cancel a run |
| `pipeline.resume_run` | Resume a cancelled or paused run |
| `pipeline.submit_human_input` | Persist user input for a run |
| `pipeline.run_stage` | Persist a stage handoff or output artifact |
| `pipeline.validate_artifact` | Validate an artifact with the existing runtime contracts |
| `pipeline.inspect_workspace` | Inspect `.pipeline-workspace/`, `.pipeline-runs/`, and installed adapter paths |
| `pipeline.export_summary` | Return a compact structured run summary |
| `pipeline.commit_checkpoint` | Record or create orchestrator-owned git checkpoints |
| `pipeline.research` | Persist structured research queries, sources, fetched excerpts, and notes |
| `pipeline.install_codex_adapter` | Report or sync the thin Codex adapter into `~/.codex/skills/multi-agent-pipeline` |

Tool calls return both `structuredContent` and a serialized JSON text block so
older and newer MCP clients can consume the same result.

### Resources

Examples:

```text
pipeline://runs
pipeline://runs/{runId}/state
pipeline://runs/{runId}/events
pipeline://runs/{runId}/artifacts/{name}
pipeline://runs/{runId}/research
pipeline://contracts/{artifactType}
pipeline://prompts/{stage}
pipeline://workspace/summary
```

### Prompts

The server exposes one prompt per pipeline stage:

```text
pipeline/spec
pipeline/plan
pipeline/architecture
pipeline/dispatch
pipeline/execution
pipeline/validation
pipeline/tree-classification
pipeline/tree-rubric-generation
pipeline/tree-rubric-verification
pipeline/tree-rubric-refinement
pipeline/tree-grading
pipeline/qa
pipeline/doc
pipeline/final-assessment
```

Prompt text comes from `skills/multi-agent-pipeline/agents/*.md`, so the MCP
server can give clients the same stage instructions without loading the entire
skill into model context.

## Durable Run Ledger

Each run is stored under `.pipeline-runs/`:

```text
.pipeline-runs/
  index.json
  RUN-ID/
    run.json
    config.json
    state.json
    events.jsonl
    artifacts/
    checkpoints/
    research/
```

This ledger is designed for long-running and reconnectable operation. A client
can disconnect, reconnect, call `pipeline.get_run`, inspect resources, and
continue orchestration without replaying the full conversation context.

`pipeline.start_run` supports idempotency. If an `idempotencyKey` or equivalent
normalized config already exists, the server returns the existing run rather
than creating duplicate state.

## Git Checkpoints

Git remains orchestrator-owned. `pipeline.commit_checkpoint` defaults to
`dryRun: true`, which records checkpoint metadata without mutating git. Passing
`dryRun: false` allows the MCP server to create a real commit for explicitly
selected paths or the current tree.

Subagents and stage prompts still must not commit or push.

## Research Records

`pipeline.research` stores structured research requests under the run ledger.
When `fetchSources: true`, it fetches source URLs and stores short excerpts,
HTTP status, timestamps, and notes. This lets the pipeline keep current
engineering and paper research as durable context rather than carrying it all
inside the chat transcript.

## Verification

Run MCP server tests:

```bash
cd mcp-server
npm test
```

Run existing runtime tests:

```bash
cd skills/multi-agent-pipeline
npm test
```

Check whitespace:

```bash
git diff --check
```

Sync the thin Codex adapter after repo changes:

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

rsync -a --delete \
  "$PWD/skills/multi-agent-pipeline/" \
  "$CODEX_HOME/skills/multi-agent-pipeline/"

diff -qr \
  "$CODEX_HOME/skills/multi-agent-pipeline" \
  "$PWD/skills/multi-agent-pipeline"
```
