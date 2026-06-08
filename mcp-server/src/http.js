import http from "node:http";

import { createMcpProtocol } from "./protocol.js";

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function responseHeaders(corsOrigin) {
  return {
    "Content-Type": "application/json; charset=utf-8",
    ...(corsOrigin
      ? {
          "Access-Control-Allow-Origin": corsOrigin,
          "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Method, Mcp-Name",
          "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
        }
      : {}),
  };
}

function writeJson(response, statusCode, value, corsOrigin) {
  response.writeHead(statusCode, responseHeaders(corsOrigin));
  response.end(JSON.stringify(value));
}

export function createHttpServer({ repoRoot, skillRoot, clock, corsOrigin } = {}) {
  const protocol = createMcpProtocol({ repoRoot, skillRoot, clock });
  const server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, responseHeaders(corsOrigin));
      response.end();
      return;
    }

    if (request.method === "GET" && request.url === "/healthz") {
      writeJson(response, 200, {
        status: "ok",
        server: "multi-agent-pipeline-mcp",
      }, corsOrigin);
      return;
    }

    if (request.method !== "POST" || request.url !== "/mcp") {
      writeJson(response, 404, {
        error: "not_found",
      }, corsOrigin);
      return;
    }

    try {
      const body = await readBody(request);
      const message = JSON.parse(body);
      const result = await protocol.handleMessage(message);
      if (result === null) {
        writeJson(response, 202, {}, corsOrigin);
        return;
      }

      writeJson(response, 200, result, corsOrigin);
    } catch (error) {
      writeJson(response, 400, {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: error.message,
        },
      }, corsOrigin);
    }
  });

  return {
    server,
    protocol,
  };
}
