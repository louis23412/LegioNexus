import ollama from 'ollama';

import { Chatroom } from './chat/chat.js';
import { inputStore } from './inputs/inputs.js';
import { createToolRegistry } from './tools/tools.js';
import { createAgentsConfig } from './agents/agents.js';

let toolRegistry;
const teamThoughtChains = {};

const chatroom = new Chatroom(200);
const agentsConfig = createAgentsConfig();

const getToolHandler = (toolName, registry) => {
    return registry[toolName]?.handler || null;
};

const parseToolArguments = (rawArgs) => {
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
};

const withRetry = async (fn, retries = 2) => {
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === retries) throw err;
            console.log(`\x1b[33m[RETRY ${i+1}/${retries}] Ollama call failed, retrying...\x1b[0m`);
            await new Promise(r => setTimeout(r, 500 * (i + 1)));
        }
    }
};

const captureThoughtChain = (messages, agentName) => {
    const agentExist = teamThoughtChains[agentName];
    if (!agentExist) teamThoughtChains[agentName] = [];

    const chainId = teamThoughtChains[agentName].length;

    teamThoughtChains[agentName].push({
        chainId,
        thoughts : messages
    });
};

const runAgent = async (agentName, initialMessages, agentTools) => {
    let messages = [...initialMessages];
    let iteration = 0;

    while (iteration < agentsConfig[`${agentName}`].maxIterations) {
        iteration++;

        const result = await withRetry(async () => ollama.chat({
            model : agentsConfig[`${agentName}`].model,
            options : agentsConfig[`${agentName}`].options,
            messages,
            tools : agentTools,
            keep_alive : 0,
            think : true,
            stream : true
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
                assistantMessage.tool_calls.push(...msg.tool_calls);
            }
        }

        console.log('\n' + '─'.repeat(90));

        messages.push(assistantMessage);

        if (assistantMessage.tool_calls?.length > 0) {
            for (const toolCall of assistantMessage.tool_calls) {
                const functionName = toolCall.function.name;

                console.log(`\n🔧 [${agentName} USE TOOL (${functionName})]`);
                console.log('─'.repeat(90));

                const args = parseToolArguments(toolCall.function.arguments);

                if (functionName === 'finalize_answer') {
                    captureThoughtChain(messages, agentName);

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
                    console.warn(`⚠️ No handler for tool: ${functionName} (agent: ${agentName})`);
                }
            }

            console.log(`\n📝 [${agentName} SUMMARIZE CONTEXT]`);
            console.log('─'.repeat(90));

            const contextSummarization = await ollama.chat({
                model : agentsConfig[`${agentName}`].model,
                messages : [
                    { role : 'system', content : 'provide a clean quick summary that captures all current information completely.' },

                    {
                        role : 'user',
                        content : `
                            You are ${agentName}.
                            Compress the following messages into a quick summary that acts as a mental note for your next step: 
                            ${JSON.stringify(messages)}
                        ` 
                    }
                ],
                keep_alive : 0,
                think : false
            });

            messages.push({
                role : 'tool',
                content : contextSummarization.message.content
            });

            continue;
        }

        if (assistantMessage.content?.trim()) {
            captureThoughtChain(messages, agentName);

            return {
                content: assistantMessage.content.trim(),
                messages
            };
        }

        break;
    }

    captureThoughtChain(messages, agentName);

    return {
        content: `[${agentName}] Max iterations reached without final answer.`,
        messages
    };
};

export const startConversation = async (userPrompt) => {
    toolRegistry = await createToolRegistry(runAgent, agentsConfig, inputStore);

    chatroom.sendMessage('User', userPrompt, {
        topic: 'general',
        metadata: { type: 'user_query', source: 'human' }
    });

    const totalLeaders = Object.entries(agentsConfig).filter(agent => agent[1].isLeader);
    if (totalLeaders.length !== 1) {
        console.log(`Only one agent can be set as team leader. Total current leaders: ${totalLeaders.length}`);
        process.exit();
    }

    const leaderConfig = agentsConfig[totalLeaders[0][0]];

    const leaderMessages = [
        { role: 'system', content: leaderConfig.system },
        { role: 'user', content: userPrompt }
    ];

    const leaderTools = leaderConfig.tools
        .map(toolName => toolRegistry[toolName]?.definition)
        .filter(Boolean);

    try {
        console.log('\n💡 [USER QUESTION]');
        console.log('─'.repeat(90));
        console.log(`\x1b[35m${userPrompt}\x1b[0m`);
        console.log('─'.repeat(90));

        const leaderResult = await runAgent(
            leaderConfig.name,
            leaderMessages,
            leaderTools
        );

        const groupChatHistory = chatroom.dump();

        return { leaderResult, teamThoughtChains, chatHistory : groupChatHistory };
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};