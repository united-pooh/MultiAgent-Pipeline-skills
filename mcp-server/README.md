# Multi-Agent Pipeline MCP Server

Top-level MCP server package for the Multi-Agent Pipeline migration branch.

## Start

stdio:

```bash
node src/cli.js --transport stdio --repo-root /path/to/multi-agent-pipeline
```

HTTP:

```bash
node src/cli.js --transport http --host 127.0.0.1 --port 3333 --repo-root /path/to/multi-agent-pipeline
```

If `--repo-root` is omitted, the server uses the current working directory.
`MULTI_AGENT_PIPELINE_REPO_ROOT` can also provide that default. `--skill-root`
or `MULTI_AGENT_PIPELINE_SKILL_ROOT` can override the prompt, contract, and
runtime asset directory. HTTP is localhost-only by default; pass
`--host 0.0.0.0` only for an intentional network-facing deployment. Browser
CORS headers are disabled by default; use `--cors-origin <origin>` or
`MULTI_AGENT_PIPELINE_CORS_ORIGIN` only for trusted local browser clients.

## Smoke Test

```bash
curl -s http://127.0.0.1:3333/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}'
```

List tools:

```bash
curl -s http://127.0.0.1:3333/mcp \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

Start a durable run:

```bash
curl -s http://127.0.0.1:3333/mcp \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "pipeline.start_run",
      "arguments": {
        "objective": "Migrate the project to MCP",
        "idempotencyKey": "mcp-migration",
        "thresholds": {
          "maxIterations": 12,
          "maxRuntimeMs": 86400000
        }
      }
    }
  }'
```

## Test

```bash
npm test
```
