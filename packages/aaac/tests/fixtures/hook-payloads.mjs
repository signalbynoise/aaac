/** Sample Cursor hook JSON payloads for run-engine scripts. */

import { randomUUID } from 'node:crypto';

export function uniqueConversationId(label = 'test') {
  return `test-conv-${label}-${randomUUID()}`;
}

export const CONVERSATION_ID = uniqueConversationId('default');

export function beforeSubmitPromptHook(prompt, conversationId = uniqueConversationId('hook')) {
  return {
    conversation_id: conversationId,
    prompt,
  };
}

export function preToolUseHook(
  toolName,
  filePath,
  conversationId = uniqueConversationId('tool'),
) {
  return {
    conversation_id: conversationId,
    tool_name: toolName,
    tool_input: { path: filePath },
  };
}

export function subagentStartHook(conversationId = CONVERSATION_ID) {
  return {
    conversation_id: conversationId,
    subagent_type: 'explore',
  };
}
