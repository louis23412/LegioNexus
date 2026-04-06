import ollama from 'ollama';

import { Chatroom } from '../chat/chatroom.js';
import { InputStore } from '../inputs/inputStore.js';
import { createAgentsConfig } from '../agents/agents.js';
import { createToolRegistry } from '../tools/toolRegistry.js';
import { ContextManager } from '../context/contextManager.js';

let toolRegistry;
const teamThoughtChains = {};

const chatroom = new Chatroom(200);
const inputStore = new InputStore();
const agentsConfig = createAgentsConfig();

const getToolHandler = (toolName, registry) => registry[toolName]?.handler || null;

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
        try { return await fn(); } catch (err) {
            if (i === retries) throw err;
            console.log(`\x1b[33m[RETRY ${i+1}/${retries}] Ollama call failed\x1b[0m`);
            await new Promise(r => setTimeout(r, 400 * (i + 1)));
        }
    }
};

const captureThoughtChain = (messages, agentName) => {
    if (!teamThoughtChains[agentName]) teamThoughtChains[agentName] = [];
    teamThoughtChains[agentName].push({ chainId: teamThoughtChains[agentName].length, thoughts: [...messages] });
};

const streamMultiLayerVerifiedContextUpdate = async (agentName, messages, ctxManager) => {
    const summaryContext = ctxManager.getFocusedSummaryContext(messages);

    console.log(`\n🧐 [${agentName} MULTI-LAYER SANITY CHECK]`);
    console.log('─'.repeat(110));

    console.log(`\x1b[90m[FOCUSED CONTEXT]\x1b[0m ${summaryContext.length} msgs (~${ctxManager.estimateTokens(summaryContext)} tokens)`);

    const denseSummaryStream = await withRetry(async () => ollama.chat({
        model: agentsConfig[agentName].model,
        messages: [
            { 
                role: 'system', 
                content: `
                    PROTOCOL: createDenseSummary(conversation: string): string
                    MODE: FAST-SUMMARY-ONLY /no_think

                    You are a hyper-dense mental notepad following Chain-of-Density 2026.
                    Output ONLY 3-5 bullet points.
                    Rules:
                    - Maximize entity density and information per token
                    - No fluff, no repetition, no meta-commentary
                    - Return ONLY the bullets

                    /no_think
                `
            },
            { role: 'user', content: `You are ${agentName}. Execute createDenseSummary on the full conversation:\n${JSON.stringify(summaryContext)}` }
        ],
        think: false,
        stream: true,
        options: { temperature: 0.0, top_p: 0.8, num_predict: 512 }
    }));

    let denseSummary = '';

    console.log('\n\x1b[90m[DENSE CoD LAYER] \x1b[0m');
    for await (const chunk of denseSummaryStream) {
        const content = chunk.message?.content || '';
        if (content) {
            process.stdout.write(content);
            denseSummary += content;
        }
    }

    const trajectorySummaryStream = await withRetry(async () => ollama.chat({
        model: agentsConfig[agentName].model,
        messages: [
            { 
                role: 'system', 
                content: `
                    PROTOCOL: createTrajectorySummary(conversation: string): object
                    MODE: FAST-SUMMARY-ONLY /no_think

                    Output ONLY in this exact structure (3 sections max):
                    • KEY_EVENTS_AND_DECISIONS:
                    • CRITICAL_OPEN_QUESTIONS_NEXT_FOCUS:
                    • GOALS_PLAYBOOK_STATE:
                    No extra text.

                    /no_think
                `
            },
            { role: 'user', content: `You are ${agentName}. Execute createTrajectorySummary on the full conversation:\n${JSON.stringify(summaryContext)}` }
        ],
        think: false,
        stream: true,
        options: { temperature: 0.0, top_p: 0.8, num_predict: 512 }
    }));

    let trajectorySummary = '';

    console.log('\n\n\x1b[90m[TRAJECTORY LAYER] \x1b[0m');
    for await (const chunk of trajectorySummaryStream) {
        const content = chunk.message?.content || '';
        if (content) {
            process.stdout.write(content);
            trajectorySummary += content;
        }
    }

    const verificationStream = await withRetry(async () => ollama.chat({
        model: agentsConfig[agentName].model,
        messages: [
            { 
                role: 'system', 
                content: `
                    PROTOCOL: verifyAndConsolidate(denseSummary: string, trajectorySummary: string, conversation: string): JSON
                    MODE: FAST-SUMMARY-ONLY /no_think

                    You are the agent's ruthless inner critic.
                    Output ONLY valid JSON matching this exact schema. No extra text.
                    {
                        "trust_score": integer 0-100,
                        "consistency_between_summaries": integer 0-100,
                        "notes": array of max 3 ultra-short strings,
                        "final_recommended_anchor": string (one-sentence consolidated playbook or empty)
                    }

                    /no_think
                `
            },
            {
                role: 'user',
                content: `You are ${agentName}.
                    Execute verifyAndConsolidate with:
                    Dense CoD: ${denseSummary}
                    Trajectory Layer: ${trajectorySummary}
                    Full Conversation: ${JSON.stringify(summaryContext)}
                `
            }
        ],
        think: false,
        stream: true,
        format: 'json',
        options: { temperature: 0.0, top_p: 0.8, num_predict: 512 }
    }));

    let verificationJson = '';

    console.log('\n\n\x1b[90m[VERIFICATION LAYER] \x1b[0m');
    for await (const chunk of verificationStream) {
        const content = chunk.message?.content || '';
        if (content) {
            process.stdout.write(content);
            verificationJson += content;
        }
    }

    let trustScore = 88, consistency = 90, notes = ['Multi-layer anchor captured'], finalRecommended = '';
    try {
        const parsed = JSON.parse(verificationJson);
        trustScore = Math.max(0, Math.min(100, parsed.trust_score || 88));
        consistency = Math.max(0, Math.min(100, parsed.consistency_between_summaries || 90));
        notes = Array.isArray(parsed.notes) ? parsed.notes.slice(0, 3) : notes;
        finalRecommended = parsed.final_recommended_anchor || '';
    } catch (e) {
        console.warn('\x1b[33m[VERIFICATION PARSE FALLBACK]\x1b[0m');
    }

    const finalInjection = `✅ MULTI-LAYER VERIFIED PLAYBOOK (trust ${trustScore}/100 | consistency ${consistency}/100) • ${notes.join(' • ')} ${finalRecommended ? `• ${finalRecommended}` : ''}`;

    ctxManager.addAnchor(denseSummary, trustScore, 'ultra-dense');
    ctxManager.addAnchor(trajectorySummary, Math.min(trustScore, consistency), 'trajectory');

    const prunedMessages = ctxManager.pruneAndCompact([...messages]);
    console.log(`\n\n\x1b[90m[CONTEXT HEALTH]\x1b[0m ${agentName} → ~${ctxManager.estimateTokens(prunedMessages)} tokens (H-MEM indexed + code-directive)`);
    console.log('─'.repeat(110));

    return {
        summary: denseSummary.trim(),
        verified: trustScore >= 75 && consistency >= 80,
        finalTrustScore: trustScore,
        consistencyScore: consistency,
        injection: finalInjection,
        messagesForNextTurn: prunedMessages
    };
};

const runAgent = async (agentName, initialMessages, agentTools) => {
    const ctxManager = new ContextManager(agentName);

    let messages = [...initialMessages];
    let iteration = 0;

    while (iteration < agentsConfig[agentName].maxIterations) {
        iteration++;
        const result = await withRetry(async () => ollama.chat({
            model: agentsConfig[agentName].model,
            options: { ...agentsConfig[agentName].options, temperature: 0.7, top_p: 0.8 },
            messages,
            tools: agentTools,
            think: true,
            stream: true
        }));

        const assistantMessage = { role: 'assistant', content: '', thinking: '', tool_calls: [] };
        let inThinking = false, inContent = false;

        for await (const chunk of result) {
            const msg = chunk.message || {};
            if (msg.thinking) {
                if (!inThinking) { inThinking = true; console.log(`\n🧠 [${agentName} THINKING TRACE]`); console.log('─'.repeat(110)); }
                process.stdout.write('\x1b[34m' + msg.thinking + '\x1b[0m');
                assistantMessage.thinking += msg.thinking;
            }
            if (msg.content) {
                if (!inContent) { inContent = true; console.log('\n' + '─'.repeat(110)); console.log(`\n💬 [${agentName} FINAL RESPONSE]`); console.log('─'.repeat(110)); }
                process.stdout.write('\x1b[36m' + msg.content + '\x1b[0m');
                assistantMessage.content += msg.content;
            }
            if (msg.tool_calls?.length > 0) assistantMessage.tool_calls.push(...msg.tool_calls);
        }
        console.log('\n' + '─'.repeat(110));

        messages.push(assistantMessage);

        if (assistantMessage.tool_calls?.length > 0) {
            for (const toolCall of assistantMessage.tool_calls) {
                const functionName = toolCall.function.name;
                console.log(`\n🔧 [${agentName} USE TOOL (${functionName})]`);
                console.log('─'.repeat(110));
                const args = parseToolArguments(toolCall.function.arguments);

                if (functionName === 'finalize_answer') {
                    captureThoughtChain(messages, agentName);
                    return { content: args.final_answer || '[No answer]', explanation: args.consensus_explanation || '', finalized: true, messages };
                }

                const handler = getToolHandler(functionName, toolRegistry);
                if (handler) {
                    const toolResult = await handler(args, { agentName, chatroom });
                    messages.push({ role: 'tool', name: functionName, content: JSON.stringify(toolResult) });
                } else {
                    console.warn(`⚠️ No handler for tool: ${functionName}`);
                }
            }

            const contextUpdate = await streamMultiLayerVerifiedContextUpdate(agentName, messages, ctxManager);
            messages = contextUpdate.messagesForNextTurn;

            if (contextUpdate.verified) {
                messages.push({
                    role: 'tool',
                    name: 'context_anchor_multi_layer',
                    content: contextUpdate.injection
                });
            }
            continue;
        }

        if (assistantMessage.content?.trim()) {
            captureThoughtChain(messages, agentName);
            return { content: assistantMessage.content.trim(), messages };
        }
        break;
    }

    captureThoughtChain(messages, agentName);
    return { content: `[${agentName}] Max iterations reached.`, messages };
};

export const startConversation = async (userPrompt) => {
    toolRegistry = await createToolRegistry(runAgent, agentsConfig, inputStore);
    chatroom.sendMessage('User', userPrompt, { topic: 'general', metadata: { type: 'user_query', source: 'human' } });

    const totalLeaders = Object.entries(agentsConfig).filter(([_, cfg]) => cfg.isLeader);
    if (totalLeaders.length !== 1) {
        console.log(`❌ Only one leader allowed. Found: ${totalLeaders.length}`);
        process.exit(1);
    }

    const leaderConfig = agentsConfig[totalLeaders[0][0]];
    const leaderMessages = [
        { role: 'system', content: leaderConfig.system },
        { role: 'user', content: userPrompt }
    ];

    const leaderTools = leaderConfig.tools
        .map(name => toolRegistry[name]?.definition)
        .filter(Boolean);

    console.log('\n💡 [USER QUESTION]');
    console.log('─'.repeat(110));
    console.log(`\x1b[35m${userPrompt}\x1b[0m`);
    console.log('─'.repeat(110));

    try {
        const leaderResult = await runAgent(leaderConfig.name, leaderMessages, leaderTools);
        return {
            leaderResult,
            teamThoughtChains,
            chatHistory: chatroom.dump()
        };
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};