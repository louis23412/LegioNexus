import ollama from 'ollama';
import { Chatroom } from './chat.js';
import { createToolRegistry } from './tools.js';
import { createAgentsConfig } from './agents.js';
import { dataObj, userPrompt } from './inputs.js';

const agentsConfig = createAgentsConfig();
const chatroom = new Chatroom(200);

let toolRegistry;

function getToolHandler(toolName, registry) {
    return registry[toolName]?.handler || null;
}

function parseToolArguments(rawArgs) {
    let args = {};
    if (rawArgs == null) return args;
    if (typeof rawArgs === 'string') {
        const trimmed = rawArgs.trim();
        if (trimmed && trimmed !== 'null') {
            try { args = JSON.parse(trimmed); } catch (e) {}
        }
    } else if (typeof rawArgs === 'object') {
        args = rawArgs;
    }
    return args;
}

async function withRetry(fn, retries = 2) {
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === retries) throw err;
            console.log(`\x1b[33m[RETRY ${i+1}/${retries}] Ollama call failed, retrying...\x1b[0m`);
            await new Promise(r => setTimeout(r, 500 * (i + 1)));
        }
    }
}

async function runAgent(agentName, initialMessages, agentTools) {
    let messages = [...initialMessages];
    let iteration = 0;

    while (iteration < agentsConfig[`${agentName}`].maxIterations) {
        iteration++;

        const result = await withRetry(async () => ollama.chat({
            model : agentsConfig[`${agentName}`].model,
            options: agentsConfig[`${agentName}`].options,
            messages,
            tools: agentTools,
            keep_alive: 0,
            think: true,
            stream: true
        }));

        const assistantMessage = {
            role: 'assistant',
            content: '',
            thinking: '',
            tool_calls: []
        };

        let inThinking = false;
        let inContent = false;

        for await (const chunk of result) {
            const msg = chunk.message || {};

            if (msg.thinking) {
                if (!inThinking) {
                    inThinking = true;
                    console.log(`\n🧠 [${agentName} THINKING TRACE]`);
                    console.log('─'.repeat(90));
                }
                process.stdout.write('\x1b[34m' + msg.thinking + '\x1b[0m');
                assistantMessage.thinking += msg.thinking;
            }

            if (msg.content) {
                if (!inContent) {
                    inContent = true;
                    console.log('\n' + '─'.repeat(90));
                    console.log(`\n💬 [${agentName} FINAL RESPONSE]`);
                    console.log('─'.repeat(90));
                }
                process.stdout.write('\x1b[36m' + msg.content + '\x1b[0m');
                assistantMessage.content += msg.content;
            }

            if (msg.tool_calls?.length > 0) {
                assistantMessage.tool_calls = msg.tool_calls;
            }
        }

        console.log('\n' + '─'.repeat(90));

        messages.push(assistantMessage);

        if (assistantMessage.tool_calls?.length > 0) {
            for (const toolCall of assistantMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const args = parseToolArguments(toolCall.function.arguments);

                if (functionName === 'finalize_answer') {
                    return {
                        content: args.final_answer || '[No answer provided]',
                        explanation: args.consensus_explanation || '',
                        finalized: true,
                        messages
                    };
                }

                const handler = getToolHandler(functionName, toolRegistry);
                if (handler) {
                    const toolResult = await handler(args, { agentName, chatroom });
                    messages.push({
                        role: 'tool',
                        name: functionName,
                        content: JSON.stringify(toolResult),
                    });
                } else {
                    console.warn(`⚠️  No handler for tool: ${functionName} (agent: ${agentName})`);
                }
            }
            continue;
        }

        if (assistantMessage.content?.trim()) {
            return {
                content: assistantMessage.content.trim(),
                messages
            };
        }

        break;
    }

    return {
        content: `[${agentName}] Max iterations reached without final answer.`,
        messages
    };
}

const main = async (userPrompt, dataObj) => {
    toolRegistry = createToolRegistry(runAgent, agentsConfig, dataObj);

    const start = performance.now();

    console.log('\n💡 [USER QUESTION:]');
    console.log('─'.repeat(90));
    console.log(`\x1b[35m${userPrompt}\x1b[0m`);
    console.log('─'.repeat(90));

    const leaderConfig = agentsConfig.TeamLeader;

    const leaderMessages = [
        { role: 'system', content: leaderConfig.system },
        { role: 'user', content: userPrompt }
    ];

    const leaderTools = leaderConfig.tools
        .map(toolName => toolRegistry[toolName]?.definition)
        .filter(Boolean);

    try {
        const leaderResult = await runAgent(
            leaderConfig.name,
            leaderMessages,
            leaderTools
        );

        console.log('\n🏆 [FINAL TEAM ANSWER]');
        console.log('─'.repeat(90));

        if (leaderResult.explanation) {
            console.log(`📋 Consensus explanation:\n\x1b[33m${leaderResult.explanation}\x1b[0m\n`);
        }

        console.log('🤖 Final answer:')
        console.log(`\x1b[32m${leaderResult.content}\x1b[0m`);

        const duration = ((performance.now() - start) / 1000).toFixed(2);
        console.log(`\n⏱️ Total time: ${duration}s | 💬 Chatroom final size: ${chatroom.log.length} messages`);
        console.log('─'.repeat(90) + '\n');
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

main(userPrompt, dataObj).catch(console.error);