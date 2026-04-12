import fs from 'fs';
import path from 'path';
import ollama from 'ollama';
import crypto from 'crypto';

import { Chatroom } from '../chat/chatroom.js';
import { InputStore } from '../inputs/inputStore.js';
import { createAgentsConfig } from '../agents/agents.js';
import { createToolRegistry } from '../tools/toolRegistry.js';
import { ContextManager } from '../context/contextManager.js';

let toolRegistry;

const stateFolder = path.join(import.meta.dirname, '..', '..', 'state_data');
if (!fs.existsSync(stateFolder)) fs.mkdirSync(stateFolder);

const chatroom = new Chatroom(200);
const inputStore = new InputStore();
const agentsConfig = createAgentsConfig();

const EMBED_MAX_TOKENS = 35000;
const embedModel = 'qwen3-embedding';

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

const cosineSimilarity = (a, b) => {
    if (!a || !a.length || !b || !b.length || a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
};

const extractKeywords = (text) => {
    return (text.toLowerCase().match(/\b[a-z]{4,}\b/g) || [])
        .filter(w => !/^\d+$/.test(w));
};

const jaccardSimilarity = (setA, setB) => {
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
};

const extractProtocolParts = (text) => {
    if (!text || typeof text !== 'string' || text.trim() === '') {
        console.warn('\x1b[33m[PROTOCOL PARSER] Empty or invalid text\x1b[0m');
        return { U: '—', S: '—', P: '—', T: '—', valid: false };
    }

    const memRegex = /\[?MEM:([A-Z]):\s*([^\]]+?)\]?(?=\s*\[?MEM:|$)/gi;

    const parts = { U: '—', S: '—', P: '—', T: '—' };

    let match;
    while ((match = memRegex.exec(text)) !== null) {
        const key = match[1];
        const value = match[2].trim();
        if (key in parts) {
            parts[key] = value || '—';
        }
    }

    if (Object.values(parts).every(v => v === '—')) {
        const fallbackRegex = /MEM:([A-Z]):\s*([^\n]+)/gi;
        while ((match = fallbackRegex.exec(text)) !== null) {
            const key = match[1];
            const value = match[2].trim();
            if (key in parts) parts[key] = value || '—';
        }
    }

    const valid = !Object.values(parts).some(v => v === '—');

    return { ...parts, valid };
};

const truncateForEmbedding = (messagesArray) => {
    let truncated = [...messagesArray];
    while (true) {
        const estTokens = Math.ceil(truncated.reduce((acc, msg) => {
            let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || {});
            return acc + (content.length / 3.7);
        }, 0));

        if (estTokens <= EMBED_MAX_TOKENS) break;

        if (truncated.length <= 5) {
            const last = truncated[truncated.length - 1];
            if (last && last.content) {
                const str = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
                last.content = str.substring(0, Math.floor(EMBED_MAX_TOKENS * 3.7 * 0.85));
            }
            break;
        }
        truncated.shift();
    }
    return JSON.stringify(truncated);
};

const stripEventIds = (messagesArray) => {
    return messagesArray.map(msg => {
        if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
            const { eventId, ...cleanMsg } = msg;
            return cleanMsg;
        }
        return msg;
    });
};

const streamMultiLayerVerifiedContextUpdate = async (agentName, messages, ctxManager) => {
    const summaryContext = ctxManager.getContextMessages(messages);
    const modelSummaryContext = stripEventIds(summaryContext);

    console.log(`\n🧐 [${agentName} MULTI-LAYER SANITY CHECK]`);
    console.log('─'.repeat(110));
    console.log(`\x1b[90m[CTX HEALTH]\x1b[0m ${modelSummaryContext.length} msgs (~${ctxManager.estimateTokens(modelSummaryContext)}t)`);

    const denseConfig = {
        model: agentsConfig[agentName].model,
        messages: [
            {
                role: 'system',
                content: `
                    /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture

                    PROTOCOL: create_compact_past_summary → ONLY summarize past events. MAX density.
                    - Maximize information density per token
                    - Use shortest possible phrases and atomic facts
                    - Prioritize critical state changes, entities, and recency
                    - Eliminate all redundancy and narrative fluff

                    Format: [MEM:U: <user intent>][MEM:S: <system state>][MEM:P: <key events>][MEM:T: <key topics + entities>]
                    Output: EXACTLY in protocol format. Max 1.

                    No extra text, no newlines, no artifacts.
                    /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture
                `
            },
            
            {
                role: 'user',
                content: `
                    You are ${agentName}.
                    
                    Strictly follow create_compact_past_summary protocol and summarize this:
                    ${JSON.stringify(modelSummaryContext)}
                `
            }
        ],
        think: false,
        stream: true,
        options: { ...agentsConfig[agentName].options, num_predict: 256 }
    };

    const trajectoryConfig = {
        model: agentsConfig[agentName].model,
        messages: [
            {
                role: 'system',
                content: `
                    /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture

                    PROTOCOL: create_compact_past_summary → ONLY summarize past events. MAX density.
                    - Capture the causal chain and narrative flow
                    - Highlight sequence of events, evolving intent, and decision points
                    - Show how user intent and system state changed over time
                    - Keep chronological coherence while staying ultra-compact

                    Format: [MEM:U: <user intent>][MEM:S: <system state>][MEM:P: <key events>][MEM:T: <key topics + entities>]
                    Output: EXACTLY in protocol format. Max 1.

                    No extra text, no newlines, no artifacts.
                    /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture
                `
            },
            
            {
                role: 'user',
                content: `
                    You are ${agentName}.
                    
                    Strictly follow create_compact_past_summary protocol and summarize this:
                    ${JSON.stringify(modelSummaryContext)}
                `
            }
        ],
        think: false,
        stream: true,
        options: { ...agentsConfig[agentName].options, num_predict: 256 }
    };

    const [denseSummaryStream, trajectorySummaryStream] = await Promise.all([
        withRetry(async () => ollama.chat(denseConfig)),
        withRetry(async () => ollama.chat(trajectoryConfig))
    ]);

    let denseSummary = '';
    console.log('\n\x1b[90m[DENSE LAYER — STYLE 1]\x1b[0m');
    for await (const chunk of denseSummaryStream) {
        const content = chunk.message?.content || '';
        if (content) { process.stdout.write(content); denseSummary += content; }
    }

    let trajectorySummary = '';
    console.log('\n\n\x1b[90m[TRAJECTORY LAYER — STYLE 2]\x1b[0m');
    for await (const chunk of trajectorySummaryStream) {
        const content = chunk.message?.content || '';
        if (content) { process.stdout.write(content); trajectorySummary += content; }
    }

    console.log('\n\n\x1b[90m[EMBEDDING + REGEX RELIABILITY GATE]\x1b[0m');

    let convText = JSON.stringify(modelSummaryContext);
    const estTokens = Math.ceil(modelSummaryContext.reduce((acc, msg) => {
        let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || {});
        return acc + (content.length / 3.7);
    }, 0));

    if (estTokens > EMBED_MAX_TOKENS) {
        console.log(`\x1b[33m[EMBED TRUNCATION]\x1b[0m Full context ~${estTokens}t > ${EMBED_MAX_TOKENS}. Using LAST PART only.`);
        convText = truncateForEmbedding(modelSummaryContext);
    }

    const [convEmbedding, denseEmbedding, trajEmbedding] = await Promise.all([
        withRetry(async () => (await ollama.embeddings({ model: embedModel, prompt: convText })).embedding, 1),
        withRetry(async () => (await ollama.embeddings({ model: embedModel, prompt: denseSummary })).embedding, 1),
        withRetry(async () => (await ollama.embeddings({ model: embedModel, prompt: trajectorySummary })).embedding, 1)
    ]).catch(() => [[], [], []]);

    let simDense = 0, simTraj = 0, simSelf = 0;
    if (convEmbedding.length) {
        simDense = cosineSimilarity(denseEmbedding, convEmbedding);
        simTraj = cosineSimilarity(trajEmbedding, convEmbedding);
        simSelf = cosineSimilarity(denseEmbedding, trajEmbedding);
    }

    const kwConv = new Set(extractKeywords(convText));
    const kwDense = new Set(extractKeywords(denseSummary));
    const kwTraj = new Set(extractKeywords(trajectorySummary));

    const jaccDense = jaccardSimilarity(kwConv, kwDense);
    const jaccTraj = jaccardSimilarity(kwConv, kwTraj);

    const reliabilityDense = Math.round((simDense * 0.7 + jaccDense * 0.3) * 100);
    const reliabilityTraj = Math.round((simTraj * 0.7 + jaccTraj * 0.3) * 100);

    console.log(`Semantic Sim → Dense: ${(simDense*100).toFixed(1)}% | Traj: ${(simTraj*100).toFixed(1)}% | Self: ${(simSelf*100).toFixed(1)}%`);
    console.log(`Keyword Jaccard → Dense: ${(jaccDense*100).toFixed(1)}% | Traj: ${(jaccTraj*100).toFixed(1)}%`);
    console.log(`→ Reliability Scores: Dense ${reliabilityDense}% | Traj ${reliabilityTraj}%`);

    const bestSummary = reliabilityDense >= reliabilityTraj ? denseSummary : trajectorySummary;
    const bestType = reliabilityDense >= reliabilityTraj ? 'dense' : 'trajectory';
    const bestReliability = Math.max(reliabilityDense, reliabilityTraj);

    console.log(`\n\x1b[90m[OBJECTIVE WINNER]\x1b[0m ${bestType.toUpperCase()} (${bestReliability}%) will be used for final anchor content`);

    const verificationStream = await withRetry(async () => ollama.chat({
        model: agentsConfig[agentName].model,
        messages: [
            {
                role: 'system',
                content: `
                    /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture

                    PROTOCOL: verify_and_consolidate → ONLY JSON.
                    Format: {"trust_score":0-100,"consistency_between_summaries":0-100}
                    Output: EXACTLY in protocol format. Max 1.

                    No extra text, no newlines, no artifacts.
                    /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture
                `
            }, 
            
            {
                role: 'user',
                content: `
                    Strictly follow verify_and_consolidate protocol and evaluate both summaries against the main conversation:

                    1. Dense style summary:
                    ${denseSummary}

                    2. Trajectory style summary:
                    ${trajectorySummary}

                    Semantic similarity:
                    - Dense vs Full conversation : ${simDense.toFixed(3)} 
                    - Trajectory vs Full conversation : ${simTraj.toFixed(3)} 
                    - Dense vs Trajectory : ${simSelf.toFixed(3)}

                    Jaccard keyword similarity:
                    - Dense : ${jaccDense.toFixed(3)} 
                    - Trajectory : ${jaccTraj.toFixed(3)}

                    Reliability score (semantic x 0.7 * jaccard * 0.3):
                    - Dense : ${reliabilityDense} 
                    - Trajectory : ${reliabilityTraj}

                    Full conversation:
                    ${JSON.stringify(modelSummaryContext)}
                `
            }
        ],
        think: false,
        stream: true,
        format: 'json',
        options: { ...agentsConfig[agentName].options, num_predict: 256 }
    }));

    let verificationJson = '';
    console.log('\n\x1b[90m[VERIFY LAYER — SCORES ONLY]\x1b[0m');
    for await (const chunk of verificationStream) {
        const content = chunk.message?.content || '';
        if (content) { process.stdout.write(content); verificationJson += content; }
    }

    let trustScore = 50, consistency = 50;
    try {
        const parsed = JSON.parse(verificationJson);
        trustScore = Math.max(0, Math.min(100, parsed.trust_score || 50));
        consistency = Math.max(0, Math.min(100, parsed.consistency_between_summaries || 50));
    } catch (e) {}

    let prunedMessages = ctxManager.getContextMessages(messages);

    const { U, S, P, T, valid } = extractProtocolParts(bestSummary);
    const anchorTrustScore = Number(((trustScore + consistency + bestReliability) / 3).toFixed(3));

    if (valid && anchorTrustScore >= 50) {
        const anchorId = ctxManager.addAnchor(bestSummary, Math.min(trustScore, bestReliability), bestType);
        const finalInjection = `[CTX_ANC_${anchorId}]=[U:${U}][S:${S}][P:${P}][T:${T}]`;

        prunedMessages.push({role: 'system', name: 'system-context-anchor', eventId: `ctx-${anchorId}`, content:finalInjection});
        prunedMessages = ctxManager.getContextMessages(prunedMessages);

        console.log(`\n\n\x1b[90m[ANCHOR CREATED]\x1b[0m ${finalInjection}`);
    } else {
        console.log(`\n\n\x1b[90m[ANCHOR SKIPPED]\x1b[0m Verification failed — keeping more raw turns instead`);
    }

    console.log(`\n\x1b[90m[CTX HEALTH]\x1b[0m ${agentName} ~${ctxManager.estimateTokens(prunedMessages)}t`);
    console.log('─'.repeat(110));

    return prunedMessages;
};

const runAgent = async (agentName, userPrompt, userAlias, toolHeader) => {
    const ctxManager = new ContextManager(agentName, userAlias);

    const selectedConfig = agentsConfig[agentName];

    const coreMessages = [
        { eventId: crypto.randomUUID(), content: selectedConfig.system },
        { eventId: crypto.randomUUID(), content: userPrompt },
        { eventId: crypto.randomUUID(), content: toolHeader}
    ];

    const agentTools = selectedConfig.tools.map(name => toolRegistry[name]?.definition).filter(Boolean);

    ctxManager.setCore(coreMessages);

    let messages = coreMessages;
    let iteration = 0;

    const startingContext = ctxManager.getContextMessages(messages);

    while (iteration < agentsConfig[agentName].maxIterations) {
        iteration++;
        const result = await withRetry(async () => ollama.chat({
            model: agentsConfig[agentName].model,
            options: agentsConfig[agentName].options,
            messages: stripEventIds(iteration === 1 ? startingContext : messages),
            tools: agentTools,
            think: true,
            stream: true
        }));

        const assistantMessage = { role: 'assistant', name: agentName, eventId: '', content: '', thinking: '', tool_calls: [] };
        let inThinking = false, inContent = false;

        for await (const chunk of result) {
            const msg = chunk.message || {};
            if (msg.thinking) {
                if (!inThinking) { inThinking = true; console.log(`\n🧠 [${agentName} THINK]`); }
                process.stdout.write('\x1b[34m' + msg.thinking + '\x1b[0m');
                assistantMessage.thinking += msg.thinking;
            }
            if (msg.content) {
                if (!inContent) { inContent = true; console.log(`\n💬 [${agentName} RESP]`); }
                process.stdout.write('\x1b[36m' + msg.content + '\x1b[0m');
                assistantMessage.content += msg.content;
            }
            if (msg.tool_calls?.length > 0) assistantMessage.tool_calls.push(...msg.tool_calls);
        }

        console.log('\n' + '─'.repeat(110));

        assistantMessage.eventId = crypto.randomUUID();
        messages.push(assistantMessage);

        if (assistantMessage.tool_calls?.length > 0) {
            for (const toolCall of assistantMessage.tool_calls) {
                const functionName = toolCall.function.name;
                console.log(`\n🔧 [${agentName} TOOL ${functionName}]`);

                const args = parseToolArguments(toolCall.function.arguments);

                if (functionName === 'finalize_answer') {
                    return { content: args.final_answer || '[No answer]', explanation: args.consensus_explanation || '', finalized: true, messages };
                }

                const handler = getToolHandler(functionName, toolRegistry);
                if (handler) {
                    const toolResult = await handler(args, { agentName, chatroom });

                    messages.push({ 
                        role: 'tool', 
                        name: functionName, 
                        eventId: crypto.randomUUID(), 
                        content: JSON.stringify(toolResult) 
                    });
                } else {
                    messages.push({ 
                        role: 'system', 
                        name: 'system-tool-error', 
                        eventId: crypto.randomUUID(), 
                        content: `No handler found for tool: ${functionName}. Please use show_all_tools to get the exact names of all the tools you have access to.` 
                    });
                }
            }

            const contextUpdate = await streamMultiLayerVerifiedContextUpdate(agentName, messages, ctxManager);
            messages = contextUpdate;

            continue;
        }

        if (assistantMessage.content?.trim()) {
            return { content: assistantMessage.content.trim(), messages };
        }

        break;
    }

    return { content: `[${agentName}] Max iterations.`, messages };
};

export const startConversation = async (userPrompt, userAlias) => {
    const start = performance.now();
    const conversationId = (Math.random() * start).toString(36);

    toolRegistry = await createToolRegistry(runAgent, agentsConfig, inputStore);

    chatroom.sendMessage(userAlias, userPrompt, { topic: 'general', metadata: { type: 'user_query', source: 'human' } });

    const totalLeaders = Object.entries(agentsConfig).filter(([_, cfg]) => cfg.isLeader);

    if (totalLeaders.length !== 1) {
        console.log(`❌ Exactly one leader needed. Found: ${totalLeaders.length}`);
        process.exit(1);
    }

    console.log('\n💡 [USER QUERY]');
    console.log(`\x1b[35m${userPrompt}\x1b[0m`);

    try {
        const leaderResult = await runAgent(
            totalLeaders[0][0], 
            userPrompt,
            userAlias,
            `The user addressing you has set their preferred alias to: ${userAlias}. Refer to them by this name.`
        );

        console.log('\n🏆 [FINAL TEAM ANSWER]');
        console.log('─'.repeat(90));

        if (leaderResult.explanation) console.log(`📋 Consensus explanation:\n\x1b[33m${leaderResult.explanation}\x1b[0m\n`);

        console.log('🤖 Final answer:')
        console.log(`\x1b[32m${leaderResult.content}\x1b[0m`);

        const duration = ((performance.now() - start) / 1000).toFixed(2);
        console.log(`\n⏳ Total time: ${duration}s | 💾 Full team thoughts: /chat_logs/${conversationId}.json`);
        console.log('─'.repeat(90) + '\n');

        return { success : true };
    } catch (error) { return { success : false, error } }
};