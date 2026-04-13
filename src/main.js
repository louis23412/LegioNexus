import { startConversation } from './agents/runAgent.js';

const main = async (conversationId, userPrompt, userAlias) => {
    const result = await startConversation(conversationId, userPrompt, userAlias);
    if (!result.success) console.log(result.error);
};

const conversationId = 'test_conversation_1'
const userPrompt = 'How many items are in the test array?';
const userAlias = 'test-user1';

main(conversationId, userPrompt, userAlias).catch(console.error);