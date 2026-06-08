import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";

import { createHttpServer } from "../src/http.js";
import { createTempRepo, fixedClock, repoRoot, skillRoot } from "./helpers.js";

function readLine(stream) {
  return new Promise((resolve) => {
    let buffer = "";
    stream.on("data", function onData(chunk) {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex !== -1) {
        stream.off("data", onData);
        resolve(buffer.slice(0, newlineIndex));
      }
    });
  });
}

test("stdio transport responds to initialize", async () => {
  const tempRepo = await createTempRepo();
  const child = spawn(
    process.execPath,
    [
      path.join(repoRoot, "mcp-server", "src", "cli.js"),
      "--transport",
      "stdio",
      "--repo-root",
      tempRepo,
      "--skill-root",
      skillRoot,
    ],
    {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-11-25" },
  })}\n`);
  const response = JSON.parse(await readLine(child.stdout));
  child.kill();

  assert.equal(response.result.serverInfo.name, "multi-agent-pipeline-mcp");
});

test("stdio transport uses cwd as repo root when no root arguments are passed", async () => {
  const tempRepo = await createTempRepo();
  const child = spawn(process.execPath, [path.join(repoRoot, "mcp-server", "src", "cli.js")], {
    cwd: tempRepo,
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stdin.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "prompts/get",
    params: { name: "pipeline/spec" },
  })}\n`);
  const response = JSON.parse(await readLine(child.stdout));
  child.kill();

  assert.equal(response.result.description, "Multi-Agent Pipeline Spec prompt.");
});

test("HTTP transport responds to initialize and tools/list", async () => {
  const tempRepo = await createTempRepo();
  const { server } = createHttpServer({
    repoRoot: tempRepo,
    skillRoot,
    clock: fixedClock,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  const initialize = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25" },
    }),
  }).then((response) => response.json());
  const tools = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    }),
  }).then((response) => response.json());
  await new Promise((resolve) => server.close(resolve));

  assert.equal(initialize.result.serverInfo.version, "0.1.0");
  assert.ok(tools.result.tools.some((tool) => tool.name === "pipeline.research"));
});

test("HTTP transport disables browser CORS by default and enables it explicitly", async () => {
  const tempRepo = await createTempRepo();
  const defaultServer = createHttpServer({
    repoRoot: tempRepo,
    skillRoot,
    clock: fixedClock,
  }).server;
  await new Promise((resolve) => defaultServer.listen(0, "127.0.0.1", resolve));
  const defaultPort = defaultServer.address().port;
  const defaultHealth = await fetch(`http://127.0.0.1:${defaultPort}/healthz`);
  await new Promise((resolve) => defaultServer.close(resolve));

  const corsServer = createHttpServer({
    repoRoot: tempRepo,
    skillRoot,
    clock: fixedClock,
    corsOrigin: "http://localhost:5173",
  }).server;
  await new Promise((resolve) => corsServer.listen(0, "127.0.0.1", resolve));
  const corsPort = corsServer.address().port;
  const corsHealth = await fetch(`http://127.0.0.1:${corsPort}/healthz`);
  await new Promise((resolve) => corsServer.close(resolve));

  assert.equal(defaultHealth.headers.get("access-control-allow-origin"), null);
  assert.equal(corsHealth.headers.get("access-control-allow-origin"), "http://localhost:5173");
});
