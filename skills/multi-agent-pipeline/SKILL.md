---
name: multi-agent-pipeline
description: >
  Thin Codex adapter for the Multi-Agent Pipeline MCP server. On this branch the
  durable MCP server is the primary entrypoint; use it for tools, resources,
  prompts, run state, research records, git checkpoints, and long-running
  orchestration instead of running the full pipeline from the skill body.
compatibility: codex, opencode
metadata:
  audience: orchestrators
  disclosure: thin-adapter
  mcp_server: multi-agent-pipeline-mcp
---

# Multi-Agent Pipeline MCP Adapter

This branch is MCP-first.

Do not treat this skill as the full pipeline orchestrator entrypoint. The
primary product is the repo-level MCP server in:

```text
mcp-server/
```

The MCP server exposes:

- Tools for durable runs, stage handoffs, artifact validation, workspace
  inspection, research records, git checkpoints, resume/cancel, and adapter
  installation.
- Resources for run state, events, artifacts, contracts, prompts, research, and
  workspace summaries.
- Prompts for every pipeline stage.

## How Codex Should Use This Adapter

When the user asks to run or continue the multi-agent pipeline on this branch:

1. Prefer connecting to the MCP server and using its `pipeline.*` tools.
2. Use `pipeline://...` resources to recover state instead of asking the user to
   paste old context.
3. Use `pipeline/*` prompts for stage-specific instructions.
4. Keep the main agent/orchestrator read-only with respect to code and repo
   files. It may read, dispatch, write MCP run bookkeeping, validate, and
   report.
5. Reserve all file/code mutations for Execution-stage worker subagents.
   Validation, QA, Doc, Tree Grading, Review, and other non-Execution stages
   send failures or feedback back to Execution for repair.
6. Persist long-running work in `.pipeline-runs/`.
7. Keep git checkpoints orchestrator-owned and explicit.

## Launch Commands

From the repository root:

```bash
node mcp-server/src/cli.js --transport stdio --repo-root "$PWD"
```

or:

```bash
node mcp-server/src/cli.js --transport http --host 127.0.0.1 --port 3333 --repo-root "$PWD"
```

The HTTP endpoint is:

```text
POST http://127.0.0.1:3333/mcp
```

Public-safe defaults:

- `repoRoot` defaults to the current working directory unless `--repo-root` or
  `MULTI_AGENT_PIPELINE_REPO_ROOT` is set.
- `skillRoot` can be overridden with `--skill-root` or
  `MULTI_AGENT_PIPELINE_SKILL_ROOT`.
- HTTP binds to `127.0.0.1` and browser CORS headers are disabled by default.

## Runtime Assets

The existing files under this skill directory are still important, but they are
now assets consumed by the MCP server:

- `agents/*.md` become MCP prompts.
- `references/contracts.md` becomes an MCP resource and validator reference.
- `templates/artifacts/*.json` remain artifact skeletons.
- `src/runtime/` remains the pipeline domain runtime.
- `test/` remains the runtime regression suite.

## Verification

Run:

```bash
cd mcp-server && npm test
cd ../skills/multi-agent-pipeline && npm test
git diff --check
```

Sync this adapter into the local Codex skill directory when requested:

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"

rsync -a --delete \
  "$PWD/skills/multi-agent-pipeline/" \
  "$CODEX_HOME/skills/multi-agent-pipeline/"
```
