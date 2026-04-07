import { startConversation } from './agents/runAgent.js';

const main = async (userPrompt, userAlias) => {
    const result = await startConversation(userPrompt, userAlias);
    if (!result.success) console.log(result.error);
};

const userPrompt = 'How many items are in the test array?';
const userAlias = 'test-user1';

main(userPrompt, userAlias).catch(console.error);