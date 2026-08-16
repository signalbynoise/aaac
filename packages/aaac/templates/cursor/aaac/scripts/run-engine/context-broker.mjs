/**
 * Host-side HTTP/MCP broker for capsule workers.
 * Runs outside the sandbox; workers reach it on 127.0.0.1 only.
 */
import http from "http";
import fs from "fs";
import path from "path";
import { normalizeRepoPath } from "./evaluate-finding-tools.mjs";
import { CONTEXT_EVENTS } from "./context-taxonomy.mjs";
import {
  readGrantedContext,
  resolveContextRequest,
} from "./request-context.mjs";
import { markGrantConsumed } from "./worker-capsule.mjs";

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1_000_000) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function appendTaxonomy(workspaceRoot, runId, event) {
  if (!workspaceRoot || !runId) return;
  const p = path.join(
    workspaceRoot,
    ".cursor/aaac/state/runs",
    String(runId),
    "artifacts",
    "context_taxonomy.jsonl",
  );
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
  } catch {
    // telemetry optional
  }
}

const TOOLS = [
  {
    name: "request_context",
    description:
      "Ask the run engine for more SOURCE context. Describe the need; do not guess ungranted paths.",
    inputSchema: {
      type: "object",
      properties: {
        need: { type: "string" },
        because: { type: "string" },
        anchor: {
          type: "object",
          properties: {
            path: { type: "string" },
            symbol: { type: "string" },
          },
        },
      },
      required: ["need"],
    },
  },
  {
    name: "read_context",
    description: "Read a granted path from the packet cache. NOT_GRANTED reveals nothing about existence.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start: { type: "number" },
        end: { type: "number" },
      },
      required: ["path"],
    },
  },
];

export function createContextBroker({
  workspaceRoot,
  runId,
  manifest,
  capsuleDir,
  agentIndex = 0,
} = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, { ok: true, run_id: runId });
        return;
      }

      if (req.method !== "POST") {
        json(res, 405, { error: "method_not_allowed" });
        return;
      }

      const raw = await readBody(req);
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        json(res, 400, { error: "invalid_json" });
        return;
      }

      if (url.pathname === "/request_context") {
        const result = await resolveContextRequest({
          workspaceRoot,
          runId,
          manifest,
          capsuleDir,
          need: body.need,
          because: body.because,
          anchor: body.anchor,
        });
        appendTaxonomy(workspaceRoot, runId, {
          event: result.taxonomy ?? CONTEXT_EVENTS.NOT_GRANTED,
          tool: "request_context",
          agent_index: agentIndex,
          need: String(body.need ?? "").slice(0, 200),
          paths: result.packet_delta?.paths ?? [],
        });
        json(res, 200, result);
        return;
      }

      if (url.pathname === "/read_context") {
        const result = readGrantedContext({
          capsuleDir,
          relPath: body.path,
          start: body.start,
          end: body.end,
        });
        if (result.status === "IN_PACKET") {
          markGrantConsumed(capsuleDir, body.path);
        }
        appendTaxonomy(workspaceRoot, runId, {
          event: result.taxonomy,
          tool: "read_context",
          agent_index: agentIndex,
          path: normalizeRepoPath(body.path),
        });
        json(res, 200, result);
        return;
      }

      if (url.pathname === "/mcp") {
        const rpc = await handleMcpRpc(body, {
          workspaceRoot,
          runId,
          manifest,
          capsuleDir,
          agentIndex,
        });
        json(res, 200, rpc);
        return;
      }

      json(res, 404, { error: "not_found" });
    } catch (err) {
      json(res, 500, { error: String(err?.message ?? err) });
    }
  });

  return {
    server,
    async listen() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      return { url: `http://127.0.0.1:${port}`, port };
    },
    async close() {
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

async function handleMcpRpc(body, ctx) {
  const id = body.id ?? 1;
  const method = body.method;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "aaac-context", version: "1.0.0" },
      },
    };
  }
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }
  if (method === "notifications/initialized") {
    return { jsonrpc: "2.0", id, result: {} };
  }
  if (method === "tools/call") {
    const name = body.params?.name;
    const args = body.params?.arguments ?? {};
    if (name === "request_context") {
      const result = await resolveContextRequest({
        workspaceRoot: ctx.workspaceRoot,
        runId: ctx.runId,
        manifest: ctx.manifest,
        capsuleDir: ctx.capsuleDir,
        need: args.need,
        because: args.because,
        anchor: args.anchor,
      });
      appendTaxonomy(ctx.workspaceRoot, ctx.runId, {
        event: result.taxonomy,
        tool: "request_context",
        agent_index: ctx.agentIndex,
        need: String(args.need ?? "").slice(0, 200),
        paths: result.packet_delta?.paths ?? [],
      });
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      };
    }
    if (name === "read_context") {
      const result = readGrantedContext({
        capsuleDir: ctx.capsuleDir,
        relPath: args.path,
        start: args.start,
        end: args.end,
      });
      if (result.status === "IN_PACKET") {
        markGrantConsumed(ctx.capsuleDir, args.path);
      }
      appendTaxonomy(ctx.workspaceRoot, ctx.runId, {
        event: result.taxonomy,
        tool: "read_context",
        agent_index: ctx.agentIndex,
        path: normalizeRepoPath(args.path),
      });
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      };
    }
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Unknown tool ${name}` },
    };
  }
  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Unknown method ${method}` },
  };
}
