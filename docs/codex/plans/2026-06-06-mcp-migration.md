# MCP Migration Implementation Plan

> **For Codex workers:** Implement task-by-task. Use `update_plan` to track progress, keep only one step in progress at a time, edit files with the repo's established tools and `apply_patch` for manual changes, and run the exact verification commands listed below. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a top-level durable MCP server for the Multi-Agent Pipeline and turn the existing skill entrypoint into a thin MCP adapter.

**Architecture:** Keep the existing pipeline runtime as the domain core. Add a top-level `mcp-server/` package with protocol-native JSON-RPC routing, stdio and HTTP transports, durable `.pipeline-runs/` state, and MCP tools/resources/prompts backed by existing contracts and prompt files.

**Tech Stack:** Node.js ESM, built-in `node:http`, built-in `node:test`, existing `skills/multi-agent-pipeline/src/index.js` exports, JSON-RPC 2.0 compatible MCP message shapes.

---

### Task 1: Durable Run Store

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/src/run-store.js`
- Create: `mcp-server/test/run-store.test.js`

- [ ] **Step 1: Create package metadata**

Create `mcp-server/package.json` with `type: "module"`, `bin` pointing at `src/cli.js`, and scripts:

```json
{
  "name": "multi-agent-pipeline-mcp-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "multi-agent-pipeline-mcp": "./src/cli.js"
  },
  "scripts": {
    "test": "node --test",
    "start:stdio": "node ./src/cli.js --transport stdio",
    "start:http": "node ./src/cli.js --transport http"
  }
}
```

- [ ] **Step 2: Implement `RunStore`**

`RunStore` must create `.pipeline-runs/RUN-ID/`, persist `run.json`,
`config.json`, `state.json`, append `events.jsonl`, list runs, read runs,
cancel runs, resume runs, record human input, record stage handoffs, record
research, export summaries, and inspect workspace state.

- [ ] **Step 3: Test idempotent run creation**

Run: `npm test` from `mcp-server`

Expected: a second `createRun()` with the same idempotency key returns the
original run ID and does not create a second run directory.

### Task 2: MCP Protocol Router

**Files:**
- Create: `mcp-server/src/protocol.js`
- Create: `mcp-server/src/tools.js`
- Create: `mcp-server/src/resources.js`
- Create: `mcp-server/src/prompts.js`
- Create: `mcp-server/test/protocol.test.js`

- [ ] **Step 1: Implement JSON-RPC routing**

The protocol router must handle `initialize`, `notifications/initialized`,
`tools/list`, `tools/call`, `resources/list`, `resources/read`,
`resources/templates/list`, `prompts/list`, and `prompts/get`.

- [ ] **Step 2: Implement tools**

Expose deterministic tool definitions for all accepted tools. Each tool result
must include both `structuredContent` and a JSON text block.

- [ ] **Step 3: Implement resources and prompts**

Resources read durable run files, existing contract docs, existing prompt files,
and workspace summaries. Prompts wrap stage prompt files into MCP prompt
messages.

- [ ] **Step 4: Test list and call behavior**

Run: `npm test` from `mcp-server`

Expected: initialize returns tools/resources/prompts capabilities; list methods
return deterministic names; `pipeline.start_run` and `pipeline.get_run` round
trip structured content.

### Task 3: Stdio and Streamable HTTP Transports

**Files:**
- Create: `mcp-server/src/stdio.js`
- Create: `mcp-server/src/http.js`
- Create: `mcp-server/src/cli.js`
- Create: `mcp-server/test/transport.test.js`

- [ ] **Step 1: Implement stdio transport**

Read newline-delimited JSON-RPC from stdin and write JSON-RPC responses to
stdout. Send operational logs to stderr only.

- [ ] **Step 2: Implement HTTP transport**

Expose `POST /mcp` for JSON-RPC messages, `GET /healthz` for health checks,
and JSON responses compatible with Streamable HTTP clients.

- [ ] **Step 3: Test both transports**

Run: `npm test` from `mcp-server`

Expected: spawned stdio process responds to `initialize`; in-process HTTP server
responds to `initialize` and `tools/list`.

### Task 4: Thin Codex Adapter and Documentation

**Files:**
- Modify: `skills/multi-agent-pipeline/SKILL.md`
- Modify: `README.md`
- Create: `mcp-server/README.md`

- [ ] **Step 1: Replace skill entrypoint role**

`SKILL.md` must state that this branch uses the MCP server as the primary
entrypoint and that Codex should call the MCP tools/resources/prompts rather
than orchestrating the full pipeline from the skill body.

- [ ] **Step 2: Update README**

README must document the MCP migration branch, package layout, stdio launch,
HTTP launch, run ledger, tools/resources/prompts, and verification commands.

- [ ] **Step 3: Add MCP server README**

`mcp-server/README.md` must include client-facing launch examples and smoke
test commands.

### Task 5: Verification and Sync

**Files:**
- No new source files.

- [ ] **Step 1: Run MCP tests**

Run: `npm test` from `mcp-server`

Expected: all MCP tests pass.

- [ ] **Step 2: Run pipeline package tests**

Run: `npm test` from `skills/multi-agent-pipeline`

Expected: all existing pipeline tests pass.

- [ ] **Step 3: Check whitespace**

Run: `git diff --check`

Expected: no output and exit code 0.

- [ ] **Step 4: Sync installed adapter**

Run:

```bash
rsync -a --delete /Users/united_pooh/Downloads/multi-agent-pipeline/skills/multi-agent-pipeline/ /Users/united_pooh/.codex/skills/multi-agent-pipeline/
diff -qr /Users/united_pooh/.codex/skills/multi-agent-pipeline /Users/united_pooh/Downloads/multi-agent-pipeline/skills/multi-agent-pipeline
```

Expected: `diff -qr` emits no differences.
