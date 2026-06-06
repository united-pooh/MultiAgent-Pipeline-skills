import http from "node:http";

import { createMcpProtocol } from "./protocol.js";

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Method, Mcp-Name",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
  });
  response.end(JSON.stringify(value));
}

export function createHttpServer({ repoRoot = process.cwd(), skillRoot, clock } = {}) {
  const protocol = createMcpProtocol({ repoRoot, skillRoot, clock });
  const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Method, Mcp-Name",
        "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      });
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === "/healthz") {
      writeJson(response, 200, {
        status: "ok",
        server: "multi-agent-pipeline-mcp",
      });
      return;
    }

    if (request.method !== "POST" || request.url !== "/mcp") {
      writeJson(response, 404, {
        error: "not_found",
      });
      return;
    }

    try {
      const body = await readBody(request);
      const message = JSON.parse(body);
      const result = await protocol.handleMessage(message);
      if (result === null) {
        writeJson(response, 202, {});
        return;
      }

      writeJson(response, 200, result);
    } catch (error) {
      writeJson(response, 400, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: error.message,
        },
      });
    }
  });

  return {
    server,
    protocol,
  };
}
