import fs from 'fs';
import path from 'path';
import ollama from 'ollama';
import crypto from 'crypto';

import { Chatroom } from '../chat/chatroom.js';
import { InputStore } from '../inputs/inputStore.js';
import { createAgentsConfig } from '../agents/agents.js';
import { createToolRegistry } from '../tools/toolRegistry.js';
import { ContextManager } from '../context/contextManager.js';

let chatroom;
let eventSocket;
let toolRegistry;
let conversationFolder;

const inputStore = new InputStore();
const agentsConfig = createAgentsConfig();

const EMBED_MAX_TOKENS = 35000;
const embedModel = 'qwen3-embedding';

const stateFolder = path.join(import.meta.dirname, '..', '..', 'state_data');
if (!fs.existsSync(stateFolder)) fs.mkdirSync(stateFolder);

const broadcastEvent = (agentName, eventType, eventId, data) => eventSocket.emit(eventType, { agentName, eventId, data });

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

const checkAbort = (signal) => {
    if (signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
    }
};

const withRetry = async (fn, retries = 3) => {
    for (let i = 0; i <= retries; i++) {
        try { return await fn(); } catch (err) {
            if (i === retries) { 
                broadcastEvent(null, 'ollama-calls-fail', crypto.randomUUID(), {
                    error : err.message,
                    retries
                })
                throw err
            };

            broadcastEvent(null, 'ollama-call-retry', crypto.randomUUID(), {
                current_try : i + 1,
                max_tries : retries
            })

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

const getCtxUpdate = async (agentName, messages, ctxManager, signal) => {
    const summaryContext = ctxManager.getContextMessages(messages);
    const modelSummaryContext = stripEventIds(summaryContext);

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

    const denseSummaryStream = await withRetry(async () => ollama.chat(denseConfig));
    let denseSummary = '';
    const denseId = crypto.randomUUID();
    for await (const chunk of denseSummaryStream) {
        checkAbort(signal);
        const content = chunk.message?.content || '';
        if (content) { 
            broadcastEvent(agentName, 'sanity-check-1', denseId, content);
            denseSummary += content;
        }
    }

    const trajectorySummaryStream = await withRetry(async () => ollama.chat(trajectoryConfig));
    let trajectorySummary = '';
    const trajId = crypto.randomUUID();
    for await (const chunk of trajectorySummaryStream) {
        checkAbort(signal);
        const content = chunk.message?.content || '';
        if (content) {
            broadcastEvent(agentName, 'sanity-check-2', trajId, content);
            trajectorySummary += content; 
        }
    }

    checkAbort(signal);

    let convText = JSON.stringify(modelSummaryContext);
    const estTokens = Math.ceil(modelSummaryContext.reduce((acc, msg) => {
        let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || {});
        return acc + (content.length / 3.7);
    }, 0));

    if (estTokens > EMBED_MAX_TOKENS) { convText = truncateForEmbedding(modelSummaryContext) };

    const convEmbedding = await withRetry(async () => (await ollama.embeddings({ model: embedModel, prompt: convText })).embedding);
    checkAbort(signal);

    const kwConv = new Set(extractKeywords(convText));

    const denseEmbedding = await withRetry(async () => (await ollama.embeddings({ model: embedModel, prompt: denseSummary })).embedding);
    checkAbort(signal);

    const simDense = convEmbedding.length ? cosineSimilarity(denseEmbedding, convEmbedding) : 0;
    const kwDense = new Set(extractKeywords(denseSummary));
    const jaccDense = jaccardSimilarity(kwConv, kwDense);
    const reliabilityDense = Math.round((simDense * 0.7 + jaccDense * 0.3) * 100);

    const trajEmbedding = await withRetry(async () => (await ollama.embeddings({ model: embedModel, prompt: trajectorySummary })).embedding);
    checkAbort(signal);

    const simTraj = convEmbedding.length ? cosineSimilarity(trajEmbedding, convEmbedding) : 0;
    const kwTraj = new Set(extractKeywords(trajectorySummary));
    const jaccTraj = jaccardSimilarity(kwConv, kwTraj);
    const reliabilityTraj = Math.round((simTraj * 0.7 + jaccTraj * 0.3) * 100);

    const simSelf = convEmbedding.length ? cosineSimilarity(denseEmbedding, trajEmbedding) : 0;

    broadcastEvent(agentName, 'sanity-gate', crypto.randomUUID(), {
        semantic_similarity : { layer1 : simDense * 100, layer2: simTraj * 100, cross_layer: simSelf * 100 },
        keyword_similarity : { layer1 : jaccDense * 100, layer2 : jaccTraj * 100 },
        reliability_score : { layer1 : reliabilityDense, layer2 : reliabilityTraj }
    });

    const bestSummary = reliabilityDense >= reliabilityTraj ? denseSummary : trajectorySummary;
    const bestType = reliabilityDense >= reliabilityTraj ? 'dense' : 'trajectory';
    const bestReliability = Math.max(reliabilityDense, reliabilityTraj);

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
    const verifyId = crypto.randomUUID();

    for await (const chunk of verificationStream) {
        checkAbort(signal);
        const content = chunk.message?.content || '';
        if (content) {
            broadcastEvent(agentName, 'sanity-verify', verifyId, content);
            verificationJson += content; 
        }
    }

    checkAbort(signal);

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

        broadcastEvent(agentName, 'anchor-create', crypto.randomUUID(), { anchorId, U, S, P, T });
    } else {
        broadcastEvent(agentName, 'anchor-skip', crypto.randomUUID(), null);
    }

    return prunedMessages;
};

const runAgent = async (agentName, userPrompt, userAlias, toolHeader, signal) => {
    const ctxManager = new ContextManager(agentName, userAlias, conversationFolder);

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
        checkAbort(signal);

        iteration++;
        const result = await withRetry(async () => ollama.chat({
            model: agentsConfig[agentName].model,
            options: agentsConfig[agentName].options,
            messages: stripEventIds(iteration === 1 ? startingContext : messages),
            tools: agentTools,
            think: true,
            stream: true
        }));

        const assistantMessage = { 
            role: 'assistant', 
            name: agentName, 
            eventId: crypto.randomUUID(), 
            content: '', 
            thinking: '', 
            tool_calls: [] 
        };

        const thinkId = crypto.randomUUID();
        const contentId = crypto.randomUUID();

        for await (const chunk of result) {
            checkAbort(signal);

            const msg = chunk.message || {};

            if (msg.thinking) {
                broadcastEvent(agentName, 'think', thinkId, msg.thinking);
                assistantMessage.thinking += msg.thinking;
            }

            if (msg.content) {
                broadcastEvent(agentName, 'content', contentId, msg.content);
                assistantMessage.content += msg.content;
            }

            if (msg.tool_calls?.length > 0) assistantMessage.tool_calls.push(...msg.tool_calls);
        }

        messages.push(assistantMessage);

        if (assistantMessage.tool_calls?.length > 0) {
            for (const toolCall of assistantMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const args = parseToolArguments(toolCall.function.arguments);

                broadcastEvent(agentName, 'call-tool', crypto.randomUUID(), {
                    function_name : functionName,
                    arguments : args
                });

                if (functionName === 'finalize_answer') {
                    ctxManager.dumpLastContext(messages);
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
                    broadcastEvent(agentName, 'tool-result', crypto.randomUUID(), toolResult);
                } else {
                    messages.push({ 
                        role: 'system', 
                        name: 'system-tool-error', 
                        eventId: crypto.randomUUID(), 
                        content: `No handler found for tool: ${functionName}. Please use show_all_tools to get the exact names of all the tools you have access to.` 
                    });
                    broadcastEvent(agentName, 'no-tool-handler', crypto.randomUUID(), functionName);
                }
            }

            checkAbort(signal);
            const contextUpdate = await getCtxUpdate(agentName, messages, ctxManager, signal);
            messages = contextUpdate;

            continue;
        }

        if (assistantMessage.content?.trim()) {
            ctxManager.dumpLastContext(messages);
            return { content: assistantMessage.content.trim(), messages };
        }

        break;
    }

    ctxManager.dumpLastContext(messages);
    return { content: `[${agentName}] Max iterations.`, messages };
};

export const startConversation = async (convId, userPrompt, userAlias, eSckt, signal) => {
    const convFolder = path.join(stateFolder, `conv_${convId}`);
    if (!fs.existsSync(convFolder)) fs.mkdirSync(convFolder);

    eventSocket = eSckt;
    conversationFolder = convFolder;

    chatroom = new Chatroom(convFolder);
    toolRegistry = await createToolRegistry(runAgent, agentsConfig, inputStore);

    const totalLeaders = Object.entries(agentsConfig).filter(([_, cfg]) => cfg.isLeader);

    if (totalLeaders.length !== 1) throw new Error(`Exactly one leader needed. Found: ${totalLeaders.length}`);

    try {
        const start = performance.now();

        broadcastEvent(null, 'user-prompt', crypto.randomUUID(), userPrompt);

        const leaderResult = await runAgent(
            totalLeaders[0][0], 
            userPrompt,
            userAlias,
            `The user addressing you has set their preferred alias to: ${userAlias}. Refer to them by this name.`,
            signal
        );

        const duration = ((performance.now() - start) / 1000).toFixed(2);

        broadcastEvent(null, 'final-answer', crypto.randomUUID(), {
            explanation : leaderResult.explanation,
            final_answer : leaderResult.content,
            runtime : duration
        });

        return { success : true };
    }
    catch (error) { 
        if (error.name === 'AbortError') {
            console.log('🛑 Conversation aborted by user request');
            return { success: true, aborted: true };
        }
        return { success : false, error } 
    }
};