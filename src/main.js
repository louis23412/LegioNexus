import fs from 'fs';
import path from 'path';

import { startConversation } from './runAgent.js';

const main = async (userPrompt) => {
    const start = performance.now();

    const finalResponse = await startConversation(userPrompt);

    console.log('\n🏆 [FINAL TEAM ANSWER]');
    console.log('─'.repeat(90));

    if (finalResponse.explanation) {
        console.log(`📋 Consensus explanation:\n\x1b[33m${finalResponse.explanation}\x1b[0m\n`);
    }

    console.log('🤖 Final answer:')
    console.log(`\x1b[32m${finalResponse.content}\x1b[0m`);

    const duration = ((performance.now() - start) / 1000).toFixed(2);
    console.log(`\n⏳ Total time: ${duration}s`);
    console.log('─'.repeat(90) + '\n');

    const conversationId = start.toString(36);
    const logDir = path.join(import.meta.dirname, '..', 'chat_logs');
    const filePath = path.join(logDir, `${conversationId}.json`);

    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
    fs.writeFileSync(filePath, JSON.stringify(finalResponse));
};


const userPrompt = 'How many items are in the test array?';
main(userPrompt).catch(console.error);