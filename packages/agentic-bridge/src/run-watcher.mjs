import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import { createLogger } from "./logger.mjs";
import { resolveWorkspacePaths } from "./paths.mjs";
import { diffLogPhaseEvents } from "./phase-log-stream.mjs";
import { normalizeRunManifestReadModel } from "./run-manifest-read-model.mjs";

const log = createLogger("agentic-bridge:watcher");

/**
 * @typedef {Object} RunEvent
 * @property {string} type
 * @property {string} runId
 * @property {object} [manifest]
 * @property {object} [payload]
 * @property {string} at
 */

export class RunWatcher extends EventEmitter {
  /** @param {string} workspaceRoot */
  constructor(workspaceRoot) {
    super();
    this.workspaceRoot = workspaceRoot;
    this.paths = resolveWorkspacePaths(workspaceRoot);
    this.watchers = new Map();
    this.manifestCache = new Map();
    this.logLengthCache = new Map();
    this.debounceTimers = new Map();
    this.subscribedRuns = new Set();
  }

  /** @param {string} [runId] */
  watchRun(runId) {
    if (runId) {
      this.subscribedRuns.add(runId);
      this._attachRunWatcher(runId);
      return;
    }

    if (!fs.existsSync(this.paths.runsRoot)) {
      fs.mkdirSync(this.paths.runsRoot, { recursive: true });
    }

    const rootWatcher = fs.watch(this.paths.runsRoot, (_, filename) => {
      if (!filename) return;
      const id = filename.replace(/[/\\].*$/, "");
      if (id && id.startsWith("run_")) {
        this.subscribedRuns.add(id);
        this._attachRunWatcher(id);
      }
    });

    this.watchers.set("__root__", rootWatcher);
    log.debug("watch", "Watching runs root", { path: this.paths.runsRoot });
  }

  /** @param {string} runId */
  _attachRunWatcher(runId) {
    if (this.watchers.has(runId)) return;

    const runPath = path.join(this.paths.runsRoot, runId);
    const manifestPath = path.join(runPath, "run.json");

    if (!fs.existsSync(manifestPath)) return;

    const handler = () => {
      const key = `debounce:${runId}`;
      if (this.debounceTimers.has(key)) {
        clearTimeout(this.debounceTimers.get(key));
      }
      this.debounceTimers.set(
        key,
        setTimeout(() => this._emitManifestDiff(runId), 100),
      );
    };

    try {
      const watcher = fs.watch(runPath, handler);
      this.watchers.set(runId, watcher);
      this._emitManifestDiff(runId);
    } catch (err) {
      log.warn("watch", "Failed to watch run", { runId, error: String(err) });
    }
  }

  /** @param {string} runId */
  _readManifest(runId) {
    const manifestPath = path.join(this.paths.runsRoot, runId, "run.json");
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      return normalizeRunManifestReadModel(this.workspaceRoot, manifest);
    } catch {
      return null;
    }
  }

  /** @param {string} runId */
  _emitManifestDiff(runId) {
    const manifest = this._readManifest(runId);
    if (!manifest) return;

    const prev = this.manifestCache.get(runId);
    const at = new Date().toISOString();

    if (!prev) {
      this.manifestCache.set(runId, manifest);
      this.logLengthCache.set(runId, manifest.log?.length ?? 0);
      this.emit("event", {
        type: "run.created",
        runId,
        manifest,
        at,
      });
      this._emitLogPhaseEvents(runId, [], manifest.log ?? []);
      return;
    }

    const prevLog = prev.log ?? [];
    const nextLog = manifest.log ?? [];
    this._emitLogPhaseEvents(runId, prevLog, nextLog);

    this.manifestCache.set(runId, manifest);
    this.logLengthCache.set(runId, nextLog.length);

    if (prev.phase !== manifest.phase) {
      if (prev.phase) {
        this.emit("event", {
          type: "phase.completed",
          runId,
          manifest,
          payload: { phase: prev.phase },
          at,
        });
      }
      this.emit("event", {
        type: "phase.started",
        runId,
        manifest,
        payload: { phase: manifest.phase },
        at,
      });
    }

    if (
      !prev.awaiting_approval &&
      manifest.awaiting_approval &&
      manifest.status === "blocked"
    ) {
      this.emit("event", {
        type: "gate.blocked",
        runId,
        manifest,
        payload: { reason: manifest.blocked_reason },
        at,
      });
    }

    if (JSON.stringify(prev.confidence) !== JSON.stringify(manifest.confidence)) {
      this.emit("event", {
        type: "confidence.updated",
        runId,
        manifest,
        payload: { confidence: manifest.confidence },
        at,
      });
    }

    if (prev.status !== manifest.status) {
      if (manifest.status === "completed") {
        this.emit("event", { type: "run.completed", runId, manifest, at });
      } else if (manifest.status === "failed") {
        this.emit("event", { type: "run.failed", runId, manifest, at });
      }
    }

    const swarmPrev = prev.swarm?.task_launches_this_phase ?? 0;
    const swarmNow = manifest.swarm?.task_launches_this_phase ?? 0;
    if (swarmNow > swarmPrev) {
      this.emit("event", {
        type: "swarm.agent.completed",
        runId,
        manifest,
        payload: { count: swarmNow },
        at,
      });
    }

    this.emit("event", { type: "run.updated", runId, manifest, at });
  }

  /** @param {string} runId */
  _emitLogPhaseEvents(runId, prevLog, nextLog) {
    const events = diffLogPhaseEvents(runId, prevLog, nextLog);
    for (const event of events) {
      this.emit("phase-event", event);
    }
  }

  close() {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}
