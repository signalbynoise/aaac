import { CONVERSATION_ID, uniqueConversationId } from './hook-payloads.mjs';
import { nextRunId } from './run-state.mjs';

const CREATE_PENDING = [
  'discover',
  'investigate_lite',
  'plan',
  'validate',
  'impact_analysis',
  'dependency_graph',
  'fitness_functions',
  'rollback',
  'execute',
  'verify',
  'report',
];

const UPDATE_PENDING = [...CREATE_PENDING];

const FIX_PENDING = [
  'discover',
  'investigate_swarm',
  'root_cause',
  'plan',
  'validate',
  'impact_analysis',
  'dependency_graph',
  'fitness_functions',
  'rollback',
  'execute',
  'verify',
  'report',
];

const CHECK_PENDING = [
  'discover',
  'validate',
  'impact_analysis',
  'dependency_graph',
  'fitness_functions',
  'report',
];

function baseManifest({ command, verb, object, pending, phase, runId, conversationId }) {
  const now = '2026-06-06T12:00:00.000Z';
  const rest = pending.slice(pending.indexOf(phase) + 1);
  return {
    run_id: runId,
    conversation_id: conversationId ?? CONVERSATION_ID,
    command,
    verb,
    object,
    domain: null,
    intent: 'test intent',
    orchestrator: null,
    status: 'running',
    phase,
    phase_kind: phase === 'validate' ? 'gate' : 'work',
    awaiting_approval: false,
    blocked_reason: null,
    completed: pending.slice(0, pending.indexOf(phase)),
    pending: rest,
    decisions: [],
    artifacts: {},
    checkpoints: [],
    log: [],
    capabilities_resolved: {},
    confidence: { architecture: null, requirements: null, scope: null },
    gates: { stack: 'pre_execute', results: {} },
    swarm: { task_launches_this_phase: 0, phase },
    enforcement: { edit_allowed: phase === 'execute', hook_version: 2 },
    created_at: now,
    updated_at: now,
  };
}

export function createModuleManifest(phase = 'discover', runId = nextRunId('create-module'), conversationId) {
  return baseManifest({
    command: 'create-module',
    verb: 'create',
    object: 'module',
    pending: CREATE_PENDING,
    phase,
    runId,
    conversationId,
  });
}

export function updateModuleManifest(phase = 'discover', runId = nextRunId('update-module'), conversationId) {
  return baseManifest({
    command: 'update-module',
    verb: 'update',
    object: 'module',
    pending: UPDATE_PENDING,
    phase,
    runId,
    conversationId,
  });
}

export function fixModuleManifest(phase = 'discover', runId = nextRunId('fix-module'), conversationId) {
  return baseManifest({
    command: 'fix-module',
    verb: 'fix',
    object: 'module',
    pending: FIX_PENDING,
    phase,
    runId,
    conversationId,
  });
}

export function checkModuleManifest(phase = 'discover', runId = nextRunId('check-module'), conversationId) {
  return baseManifest({
    command: 'check-module',
    verb: 'check',
    object: 'module',
    pending: CHECK_PENDING,
    phase,
    runId,
    conversationId,
  });
}

export { CREATE_PENDING, UPDATE_PENDING, FIX_PENDING, CHECK_PENDING };
