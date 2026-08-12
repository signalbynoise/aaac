#!/usr/bin/env node
/**
 * Record a retrieval_miss so the index layer can expand / repair / authorize.
 *
 * Usage:
 *   node record-retrieval-miss.mjs --run-id <id> --sought "<term>" [--reason not_in_focus] [--notes "..."]
 *   echo '{"sought":"...","reason":"not_in_focus"}' | node record-retrieval-miss.mjs --run-id <id>
 */
import { recordRetrievalMiss, processRetrievalMisses } from "./retrieval-miss.mjs";

function parseArgs(argv) {
  const out = {
    runId: null,
    sought: null,
    reason: "other",
    notes: "",
    confidence: "low",
    process: false,
    authorize: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--run-id") out.runId = argv[++i];
    else if (a === "--sought") out.sought = argv[++i];
    else if (a === "--reason") out.reason = argv[++i];
    else if (a === "--notes") out.notes = argv[++i];
    else if (a === "--confidence") out.confidence = argv[++i];
    else if (a === "--process") out.process = true;
    else if (a === "--authorize") out.authorize = true;
  }
  return out;
}

async function readStdinJson() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.runId) {
  console.error("Usage: record-retrieval-miss.mjs --run-id <id> --sought <term>");
  process.exit(1);
}

const stdin = await readStdinJson();
const raw = {
  sought: args.sought ?? stdin?.sought,
  reason: args.reason ?? stdin?.reason ?? "other",
  notes: args.notes || stdin?.notes || "",
  confidence: args.confidence ?? stdin?.confidence ?? "low",
  packet_ids_tried: stdin?.packet_ids_tried,
  agent_id: stdin?.agent_id,
  phase: stdin?.phase,
};

const recorded = recordRetrievalMiss(args.runId, raw);
let processed = null;
if (args.process || args.authorize) {
  processed = processRetrievalMisses(args.runId, { authorize: args.authorize });
}

console.log(JSON.stringify({ ok: true, recorded, processed }, null, 2));
