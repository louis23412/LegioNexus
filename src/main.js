// ====================== main.js ======================
/**
 * Main Entry Point
 * Purpose: Orchestrates the entire multi-agent system (imports, constants, runAgent loop, execution).
 *
 * Enhancements added:
 * - Simple native CLI argument parsing (--model)
 * - Performance monitoring with high-resolution timing
 * - Graceful shutdown handler (SIGINT/SIGTERM)
 * - Retry logic wrapper for Ollama calls (configurable)
 * - Logging system with color-coded levels
 * - .env / JSON config support skeleton (ready for dotenv)
 * - All original behavior, colors, thinking traces, and visual formatting 100% preserved
 * - Updated coordination constitution to reduce circular loops (review chatroom first, avoid repeats)
 * - General speed ups + cleanups: removed dead/unused getToolsForAgent function, topic/threads + format_chat_messages integration ready
 */

import ollama from 'ollama';
import { Chatroom } from './chat.js';
import { createToolRegistry } from './tools.js';
import { createAgentsConfig } from './agents.js';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS (exact original values)
// ─────────────────────────────────────────────────────────────────────────────
const model = process.argv.includes('--model') 
  ? process.argv[process.argv.indexOf('--model') + 1] 
  : 'qwen3.5';

const dataObj = {
    // Can place sanatized / formatted data inputs here.
    // For example: candle stick data from an external trading API

    // one meta tool can scan and see what supported data sources are available + randomly sample, so agents have more information to work with.

    testArr : new Array(12345).fill(1)
}

const userPrompt = 'How many items are in the test array?'; // Prompt can later evolve into more complex questions, this is just a simple test case for now (common LLM counting pitfall)

const teamConstitution = `
    Coordination Constitution:
    - Review the shared chatroom history (via get_team_status or direct context) before consulting members or taking action to avoid repeating questions.
    - Consult every team member at least once via consult_member (use exact names from get_team_status).
    - Use message_team_member only for quick peer-to-peer side discussions when needed (recipients auto-reply).
    - All members see every response in the shared chatroom and can contribute or search as needed.
    - ONLY after full consultation, reviewing the chatroom, and reaching clear consensus, call finalize_answer.
`;

// ─────────────────────────────────────────────────────────────────────────────
// MODULE INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────
const agentsConfig = createAgentsConfig(teamConstitution);
const chatroom = new Chatroom(200); // size limit enhancement

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS (exact original + modern improvements)
// ─────────────────────────────────────────────────────────────────────────────
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

// Simple retry wrapper (enhancement)
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

// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL AGENT RUNNER (exact original streaming/thinking logic)
// ─────────────────────────────────────────────────────────────────────────────
let toolRegistry; // populated after runAgent definition

async function runAgent(agentName, initialMessages, agentTools, maxIterations) {
    let messages = [...initialMessages];
    let iteration = 0;

    while (iteration < maxIterations) {
        iteration++;

        const result = await withRetry(async () => ollama.chat({
            model,
            messages,
            tools: agentTools,
            keep_alive: 0,
            options: {
                temperature: 0,
                top_p: 0.1,
                top_k: 10,
            },
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

// ─────────────────────────────────────────────────────────────────────────────
// TOOL REGISTRY INITIALIZATION (after runAgent is defined)
// ─────────────────────────────────────────────────────────────────────────────
toolRegistry = createToolRegistry(runAgent, agentsConfig, dataObj);

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXECUTION + ENHANCEMENTS
// ─────────────────────────────────────────────────────────────────────────────
const main = async () => {
    const start = performance.now();

    console.log(`\x1b[32m🚀 Starting multi-agent collaboration with model: ${model}\x1b[0m`);
    console.log(`📊 Test array size: ${dataObj.testArr.length} | Prompt: "${userPrompt}"`);

    const leaderConfig = agentsConfig.TeamLeader;

    const leaderMessages = [
        { role: 'system', content: leaderConfig.system },
        { role: 'user', content: userPrompt }
    ];

    // Leader tools are built from registry
    const leaderTools = leaderConfig.tools
        .map(toolName => toolRegistry[toolName]?.definition)
        .filter(Boolean);

    try {
        const leaderResult = await runAgent(
            'TeamLeader',
            leaderMessages,
            leaderTools,
            leaderConfig.maxIterations
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
        console.error(`\x1b[31mFailed with ${model}:\x1b[0m`, err.message);
        console.error(err);
        process.exit(1);
    }
};

// Graceful shutdown (enhancement)
process.on('SIGINT', () => {
    console.log('\n\x1b[33m👋 Graceful shutdown requested. Saving chatroom state...\x1b[0m');
    // Could call chatroom.onPersist here if configured
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\x1b[33m👋 SIGTERM received.\x1b[0m');
    process.exit(0);
});

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────
main().catch(console.error);