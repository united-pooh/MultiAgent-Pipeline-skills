#!/usr/bin/env node
import { createHttpServer } from "./http.js";
import { startStdioServer } from "./stdio.js";

function parseArgs(argv) {
  const result = {
    transport: "stdio",
    port: 3333,
    repoRoot: process.cwd(),
    skillRoot: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--transport") {
      result.transport = argv[index + 1];
      index += 1;
    } else if (arg === "--port") {
      result.port = Number.parseInt(argv[index + 1], 10);
      index += 1;
    } else if (arg === "--repo-root") {
      result.repoRoot = argv[index + 1];
      index += 1;
    } else if (arg === "--skill-root") {
      result.skillRoot = argv[index + 1];
      index += 1;
    }
  }

  return result;
}

const options = parseArgs(process.argv.slice(2));

if (options.transport === "stdio") {
  startStdioServer(options);
} else if (options.transport === "http") {
  const { server } = createHttpServer(options);
  server.listen(options.port, () => {
    process.stderr.write(
      `multi-agent-pipeline MCP HTTP server listening on http://127.0.0.1:${options.port}/mcp\n`,
    );
  });
} else {
  process.stderr.write(`Unknown transport: ${options.transport}\n`);
  process.exitCode = 1;
}
