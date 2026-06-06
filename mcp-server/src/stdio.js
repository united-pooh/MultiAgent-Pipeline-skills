import readline from "node:readline";

import { createMcpProtocol } from "./protocol.js";

export function startStdioServer({
  input = process.stdin,
  output = process.stdout,
  errorOutput = process.stderr,
  repoRoot = process.cwd(),
  skillRoot,
  clock,
} = {}) {
  const protocol = createMcpProtocol({ repoRoot, skillRoot, clock });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });

  rl.on("line", async (line) => {
    if (line.trim() === "") {
      return;
    }

    try {
      const message = JSON.parse(line);
      const response = await protocol.handleMessage(message);
      if (response) {
        output.write(`${JSON.stringify(response)}\n`);
      }
    } catch (error) {
      output.write(`${JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: error.message,
        },
      })}\n`);
    }
  });

  rl.on("close", () => {
    errorOutput.write("multi-agent-pipeline MCP stdio transport closed\n");
  });

  return {
    protocol,
    close: () => rl.close(),
  };
}
