/**
 * Execution adapter contract for Agentic OS phase runner.
 * @typedef {'cursor-local' | 'cursor-cloud'} AdapterId
 *
 * @typedef {Object} PhaseContext
 * @property {string} workspaceRoot
 * @property {string} runId
 * @property {string} phase
 * @property {object} manifest
 * @property {string} prompt
 *
 * @typedef {Object} PhaseEvent
 * @property {'started' | 'progress' | 'completed' | 'failed'} type
 * @property {string} phase
 * @property {string} [detail]
 * @property {string} [cursorRunId]
 */

export const ADAPTER_IDS = ["cursor-local", "cursor-cloud"];

/**
 * @typedef {Object} ExecutionAdapter
 * @property {AdapterId} id
 * @property {(ctx: PhaseContext) => AsyncGenerator<PhaseEvent>} runPhase
 * @property {(runId: string) => Promise<void>} cancel
 */

export {};
