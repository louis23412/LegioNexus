import { userPrompt } from './inputs/inputs.js';
import { startConversation } from './runAgent.js';

const main = async () => {
    const start = performance.now();

    console.log('\n💡 [USER QUESTION]');
    console.log('─'.repeat(90));
    console.log(`\x1b[35m${userPrompt}\x1b[0m`);
    console.log('─'.repeat(90));

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
};

main().catch(console.error);