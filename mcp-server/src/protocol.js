import path from "node:path";

import { getPrompt, listPrompts } from "./prompts.js";
import { listResources, listResourceTemplates, readResource } from "./resources.js";
import { RunStore } from "./run-store.js";
import { callTool, listTools } from "./tools.js";

const SERVER_VERSION = "0.1.0";

function jsonRpcError(id, code, message, data = undefined) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function jsonRpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function isNotification(message) {
  return !Object.prototype.hasOwnProperty.call(message, "id");
}

export function createMcpProtocol({
  repoRoot = process.cwd(),
  skillRoot = path.resolve(repoRoot, "skills", "multi-agent-pipeline"),
  clock = () => new Date(),
} = {}) {
  const store = new RunStore({ repoRoot, clock });
  const context = {
    repoRoot: path.resolve(repoRoot),
    skillRoot: path.resolve(skillRoot),
    store,
  };

  async function handleRequest(message) {
    if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
      return jsonRpcError(message?.id ?? null, -32600, "Invalid JSON-RPC request");
    }

    const id = message.id ?? null;
    const params = message.params ?? {};
    const notification = isNotification(message);

    try {
      if (notification) {
        switch (message.method) {
          case "notifications/initialized":
            await store.ensureInitialized();
            return null;
          default:
            return null;
        }
      }

      switch (message.method) {
        case "initialize":
          await store.ensureInitialized();
          return jsonRpcResult(id, {
            protocolVersion: params.protocolVersion ?? "2025-11-25",
            serverInfo: {
              name: "multi-agent-pipeline-mcp",
              version: SERVER_VERSION,
            },
            capabilities: {
              tools: { listChanged: false },
              resources: { listChanged: true, subscribe: false },
              prompts: { listChanged: false },
              logging: {},
              experimental: {
                durableRuns: true,
                tasksCompatible: true,
              },
            },
          });
        case "notifications/initialized":
          return null;
        case "tools/list":
          return jsonRpcResult(id, {
            resultType: "complete",
            tools: listTools(),
          });
        case "tools/call": {
          const result = await callTool(params.name, params.arguments ?? {}, context);
          return jsonRpcResult(id, result);
        }
        case "resources/list":
          return jsonRpcResult(id, {
            resultType: "complete",
            resources: await listResources(context),
          });
        case "resources/templates/list":
          return jsonRpcResult(id, {
            resultType: "complete",
            resourceTemplates: listResourceTemplates(),
          });
        case "resources/read":
          return jsonRpcResult(id, {
            resultType: "complete",
            ...(await readResource(params.uri, context)),
          });
        case "prompts/list":
          return jsonRpcResult(id, {
            resultType: "complete",
            prompts: listPrompts(),
          });
        case "prompts/get":
          return jsonRpcResult(id, await getPrompt(params.name, params.arguments ?? {}, context));
        default:
          return jsonRpcError(id, -32601, `Method not found: ${message.method}`);
      }
    } catch (error) {
      if (notification) {
        return null;
      }

      return jsonRpcError(id, -32603, error.message, {
        method: message.method,
      });
    }
  }

  async function handleMessage(message) {
    if (Array.isArray(message)) {
      const responses = [];
      for (const entry of message) {
        const response = await handleRequest(entry);
        if (response) {
          responses.push(response);
        }
      }

      return responses.length > 0 ? responses : null;
    }

    return handleRequest(message);
  }

  return {
    context,
    handleMessage,
  };
}
