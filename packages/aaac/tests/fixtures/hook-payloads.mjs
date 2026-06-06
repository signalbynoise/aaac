/** Sample Cursor hook JSON payloads for run-engine scripts. */

let convCounter = 0;

export function uniqueConversationId(label = 'test') {
  convCounter += 1;
  return `test-conv-${label}-${Date.now()}-${convCounter}`;
}

export const CONVERSATION_ID = 'test-chat-aaa-111';

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
