import fs from 'fs';
import path from 'path';

import { startConversation } from './agents/runAgent.js';

const main = async (userPrompt) => {
    const start = performance.now();

    const finalResponse = await startConversation(userPrompt);

    console.log('\n🏆 [FINAL TEAM ANSWER]');
    console.log('─'.repeat(90));

    if (finalResponse.leaderResult.explanation) {
        console.log(`📋 Consensus explanation:\n\x1b[33m${finalResponse.leaderResult.explanation}\x1b[0m\n`);
    }

    console.log('🤖 Final answer:')
    console.log(`\x1b[32m${finalResponse.leaderResult.content}\x1b[0m`);

    const conversationId = (Math.random() * start).toString(36);
    const logDir = path.join(import.meta.dirname, '..', 'chat_logs');
    const filePath = path.join(logDir, `${conversationId}.json`);

    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
    fs.writeFileSync(filePath, JSON.stringify({
        thought_chains : finalResponse.teamThoughtChains,
        team_chat : finalResponse.chatHistory
    }));

    const duration = ((performance.now() - start) / 1000).toFixed(2);
    console.log(`\n⏳ Total time: ${duration}s | 💾 Full team thoughts: /chat_logs/${conversationId}.json`);
    console.log('─'.repeat(90) + '\n');
};


const userPrompt = 'How many items are in the test array?';
main(userPrompt).catch(console.error);