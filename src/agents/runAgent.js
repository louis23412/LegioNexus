import fs from 'fs';
import path from 'path';
import ollama from 'ollama';
import crypto from 'crypto';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { Chatroom } from '../chat/chatroom.js';
import { InputStore } from '../inputs/inputStore.js';
import { ContextManager } from '../context/contextManager.js';

import { createAgentsConfig } from './agents.js';
import { createToolRegistry } from '../tools/toolRegistry.js';
import { summaryDefinitions, memTemplate, verifyTemplate } from './summaries.js';

let chatroom;
let toolRegistry;
let conversationFolder;

let eventSocket;
let eventAbort;

const inputStore = new InputStore();
const agentsConfig = createAgentsConfig();

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

const checkAbort = () => {
    if (eventAbort?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
    }
};

const withRetry = async (fn, retries = 3) => {
    for (let i = 0; i <= retries; i++) {
        try { return await fn(); } catch (err) {
            if (i === retries) { 
                broadcastEvent('system', 'ollama-calls-fail', crypto.randomUUID(), {
                    error : err.message,
                    retries
                })
                throw err
            };

            broadcastEvent('system', 'ollama-call-retry', crypto.randomUUID(), {
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

const stripEventIds = (messagesArray) => {
    return messagesArray.map(msg => {
        if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
            const { eventId, ...cleanMsg } = msg;
            return cleanMsg;
        }
        return msg;
    });
};

const analyzeAnchorData = (context, agentName, embeddingData, summaryData) => {
    const kwConv = new Set(extractKeywords(context));

    const simDense = embeddingData.convEmbedding.length ? cosineSimilarity(embeddingData.denseEmbedding, embeddingData.convEmbedding) : 0;
    const kwDense = new Set(extractKeywords(summaryData.denseSummary));
    const jaccDense = jaccardSimilarity(kwConv, kwDense);
    const reliabilityDense = (simDense * 0.7 + jaccDense * 0.3) * 100;

    const simTraj = embeddingData.convEmbedding.length ? cosineSimilarity(embeddingData.trajEmbedding, embeddingData.convEmbedding) : 0;
    const kwTraj = new Set(extractKeywords(summaryData.trajectorySummary));
    const jaccTraj = jaccardSimilarity(kwConv, kwTraj);
    const reliabilityTraj = (simTraj * 0.7 + jaccTraj * 0.3) * 100;

    const simSelf = embeddingData.convEmbedding.length ? cosineSimilarity(embeddingData.denseEmbedding, embeddingData.trajEmbedding) : 0;

    broadcastEvent('ctx-manager', 'sanity-gate', crypto.randomUUID(), {
        agent : agentName,

        semantic_similarity : { 
            layer1 : (simDense * 100).toFixed(3), 
            layer2: (simTraj * 100).toFixed(3), 
            cross_layer: (simSelf * 100).toFixed(3) 
        },

        keyword_similarity : { 
            layer1 : (jaccDense * 100).toFixed(3), 
            layer2 : (jaccTraj * 100).toFixed(3) 
        },

        reliability_score : { 
            layer1 : reliabilityDense.toFixed(3), 
            layer2 : reliabilityTraj.toFixed(3) 
        }
    });

    return {
        kwDense, kwTraj,
        jaccDense, jaccTraj, 
        simDense, simTraj, simSelf,
        reliabilityDense, reliabilityTraj,
        denseSummary : summaryData.denseSummary,
        trajectorySummary : summaryData.trajectorySummary, 
    }
};

const getContextSummary = async (type, context, agentName) => {
    const selectedSumType = summaryDefinitions[type];

    let summaryContent = {};
    const summaryId = crypto.randomUUID();

    const response = await withRetry(async () => ollama.chat({
        model: selectedSumType.model,

        messages: [
            { role: 'system', content: selectedSumType.systemDirective },
            { role: 'user', content: `Strictly follow the create_dense_summary protocol and summarize this:\n${JSON.stringify(context)}` }
        ],

        think: false,
        stream: false,

        format: zodToJsonSchema(memTemplate),

        options: selectedSumType.options
    }));

    try {
        const fullContent = response.message?.content || '';

        const sanityNum = type === 'dense_summary' ? 'sanity-check-1' : 'sanity-check-2';

        if (fullContent) {
            broadcastEvent('ctx-manager', sanityNum, summaryId, {
                agent: agentName,
                content: fullContent
            });

            summaryContent = fullContent;
        }

        summaryContent = memTemplate.parse(JSON.parse(summaryContent));

    } catch (err) {
        summaryContent = {};
    }

    return summaryContent;
};

const getVerificationSummary = async (context, agentName, anchorData) => {
    let verificationContent = {};
    const verifyId = crypto.randomUUID();

    const response = await withRetry(async () => ollama.chat({
        model: summaryDefinitions.verification_summary.model,

        messages: [
            { role: 'system', content: summaryDefinitions.verification_summary.systemDirective },

            {
                role: 'user',
                content: `
                    Strictly follow the verify_and_consolidate protocol and evaluate both summaries against the main conversation:

                    1. Dense style summary:
                    ${anchorData.denseSummary}

                    2. Trajectory style summary:
                    ${anchorData.trajectorySummary}

                    Semantic similarity:
                    - Dense vs Full conversation : ${anchorData.simDense.toFixed(3)} 
                    - Trajectory vs Full conversation : ${anchorData.simTraj.toFixed(3)} 
                    - Dense vs Trajectory : ${anchorData.simSelf.toFixed(3)}

                    Jaccard keyword similarity:
                    - Dense : ${anchorData.jaccDense.toFixed(3)} 
                    - Trajectory : ${anchorData.jaccTraj.toFixed(3)}

                    Reliability score:
                    - Dense : ${anchorData.reliabilityDense.toFixed(3)} 
                    - Trajectory : ${anchorData.reliabilityTraj.toFixed(3)}

                    Full conversation:
                    ${context}
                `
            }
        ],

        think: false,
        stream: false,

        format: zodToJsonSchema(verifyTemplate),

        options: summaryDefinitions.verification_summary.options
    }));

    try {
        const fullContent = response.message?.content || '';

        if (fullContent) {
            broadcastEvent('ctx-manager', 'sanity-verify', verifyId, {
                agent: agentName,
                content : fullContent
            });

            verificationContent = fullContent;

            verificationContent = verifyTemplate.parse(JSON.parse(verificationContent))
        }
    } catch (err) {
        verificationContent = {};
    }

    return verificationContent;
};

const getCtxUpdate = async (agentName, messages, ctxManager, isLast, finalResult = null) => {
    const summaryContext = ctxManager.getContextMessages(messages, true, isLast);
    const modelSummaryContext = JSON.stringify(stripEventIds(summaryContext));

    const denseSummaryObject = await getContextSummary('dense_summary', modelSummaryContext, agentName);
    const denseSummary = JSON.stringify(denseSummaryObject);

    checkAbort();

    const trajectorySummaryObject = await getContextSummary('trajectory_summary', modelSummaryContext, agentName);
    const trajectorySummary = JSON.stringify(trajectorySummaryObject);

    checkAbort();

    const allEmbeddings = await withRetry(async () => (await ollama.embed({ 
        model : summaryDefinitions.embed_model.model, 
        input : [modelSummaryContext, denseSummary, trajectorySummary],
        options: summaryDefinitions.embed_model.options
    })).embeddings);

    const [ convEmbedding, denseEmbedding, trajEmbedding ] = allEmbeddings;

    checkAbort();

    const fullAnchorData = analyzeAnchorData(
        modelSummaryContext, agentName, 
        { convEmbedding, denseEmbedding, trajEmbedding }, 
        { denseSummary, trajectorySummary }
    );

    checkAbort();

    const verificationJson = await getVerificationSummary(modelSummaryContext, agentName, fullAnchorData);

    const trustScore = verificationJson?.trust_score ? verificationJson.trust_score : 0;
    const consistency = verificationJson?.consistency_between_summaries ? verificationJson.consistency_between_summaries : 0;

    checkAbort();

    const bestSummary = fullAnchorData.reliabilityDense >= fullAnchorData.reliabilityTraj ? denseSummaryObject : trajectorySummaryObject;
    const bestType = fullAnchorData.reliabilityDense >= fullAnchorData.reliabilityTraj ? 'dense' : 'trajectory';
    const bestReliability = Math.max(fullAnchorData.reliabilityDense, fullAnchorData.reliabilityTraj);

    const { U, S, P, T } = bestSummary;

    const anchorTrustScore = Number(((trustScore + consistency + bestReliability) / 3).toFixed(3));

    if (anchorTrustScore >= 50) {
        const { anchorId, anchorStatus, anchorTime, resolutionAnchor } = ctxManager.addAnchor(
            bestSummary, anchorTrustScore, bestType, isLast, {
                keywords : bestType === 'trajectory' ? [ ...fullAnchorData.kwTraj ] : [ ...fullAnchorData.kwDense ],
                embeddings : bestType === 'trajectory' ? trajEmbedding : denseEmbedding
            },
            finalResult
        );

        const compactTimeStamp = (new Date(anchorTime).toLocaleString()).replaceAll(' ', '');

        const finalInjection = `
            [CTX_ANC_${anchorId}|STATUS:${anchorStatus}|RES_ANC:${!resolutionAnchor ? '-' : `A${resolutionAnchor}`}|SYS_TIME:${compactTimeStamp}]=[U:${U}][S:${S}][P:${P}][T:${T}]
        `.trim();

        messages.push({role: 'system', eventId: `ctx-${anchorId}`, content:finalInjection});

        const prunedMessages = ctxManager.getContextMessages(messages, false, isLast);

        broadcastEvent('ctx-manager', 'anchor-create', crypto.randomUUID(), {
            agent : agentName, 
            content : finalInjection
        });

        return prunedMessages;
    } else {
        const prunedMessages = ctxManager.getContextMessages(messages, false, isLast);

        broadcastEvent('ctx-manager', 'anchor-skip', crypto.randomUUID(), agentName);

        return prunedMessages;
    }
};

const runAgent = async (agentName, userPrompt, userAlias, toolHeader) => {
    const selectedConfig = agentsConfig[agentName];

    const agentTools = selectedConfig.tools.map(name => toolRegistry[name]?.definition).filter(Boolean);

    const ctxManager = new ContextManager(agentName, userAlias, conversationFolder, selectedConfig.system, userPrompt, toolHeader);

    let iteration = 0;
    let messages = ctxManager.getStarterContext();

    while (iteration < agentsConfig[agentName].maxIterations) {
        checkAbort();

        iteration++;
        const result = await withRetry(async () => ollama.chat({
            model: agentsConfig[agentName].model,
            options: agentsConfig[agentName].options,
            messages: stripEventIds(messages),
            tools: agentTools,
            think: true,
            stream: true
        }));

        const assistantMessage = { 
            role: 'assistant',
            eventId: crypto.randomUUID(), 
            content: '', 
            thinking: '', 
            tool_calls: [] 
        };

        const thinkId = crypto.randomUUID();
        const contentId = crypto.randomUUID();

        let currentContextSize;
        let contextFillPct;

        for await (const chunk of result) {
            checkAbort();

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

            if (chunk.done) { currentContextSize = chunk.prompt_eval_count };
        }

        if (currentContextSize) {
            contextFillPct = Number(((currentContextSize / agentsConfig[agentName].options.num_ctx) * 100).toFixed(3));

            broadcastEvent('system', 'context-capacity', crypto.randomUUID(), {
                fill_pct : contextFillPct,
                token_size : currentContextSize
            })
        };

        if (!assistantMessage.thinking?.trim()) {
            delete assistantMessage.thinking;
        }

        if (!assistantMessage.content?.trim()) {
            delete assistantMessage.content;
        }

        if (!assistantMessage.tool_calls?.length) {
            delete assistantMessage.tool_calls;
        }

        messages.push(assistantMessage);

        if (assistantMessage.tool_calls?.length > 0) {
            for (const toolCall of assistantMessage.tool_calls) {
                const functionName = toolCall.function.name;
                const args = parseToolArguments(toolCall.function.arguments);

                broadcastEvent('system', 'call-tool', crypto.randomUUID(), {
                    caller : agentName,
                    tool_name : functionName,
                    arguments : args
                });

                const handler = getToolHandler(functionName, toolRegistry);

                if (handler) {
                    const toolResult = await handler(args, { agentName, chatroom });

                    messages.push({ 
                        role: 'tool', 
                        tool_name: functionName, 
                        eventId: crypto.randomUUID(), 
                        content: JSON.stringify(toolResult) 
                    });

                    broadcastEvent('system', 'tool-result', crypto.randomUUID(), {
                        caller : agentName,
                        tool_name : functionName,
                        result : toolResult
                    });
                } else {
                    messages.push({ 
                        role: 'system',
                        eventId: crypto.randomUUID(), 
                        content: `No handler found for tool: ${functionName}. Please use show_all_tools to get the exact names of all the tools you have access to.` 
                    });

                    broadcastEvent('system', 'no-tool-handler', crypto.randomUUID(), {
                        caller : agentName,
                        failed_name : functionName
                    });
                }
            }

            checkAbort();

            messages = await getCtxUpdate(agentName, messages, ctxManager, false, null);

            continue;
        }

        if (assistantMessage.content?.trim()) {
            checkAbort();

            await getCtxUpdate(agentName, messages, ctxManager, true, assistantMessage.content.trim());

            return { content: assistantMessage.content.trim() };
        }

        break;
    }

    return { content: `[${agentName}] Max iterations.` };
};

export const startConversation = async (convId, userPrompt, userAlias, eSckt, signal) => {
    const convFolder = path.join(stateFolder, `conv_${convId}`);
    if (!fs.existsSync(convFolder)) fs.mkdirSync(convFolder);

    eventSocket = eSckt;
    eventAbort = signal;
    conversationFolder = convFolder;

    chatroom = new Chatroom(convFolder);
    toolRegistry = await createToolRegistry(runAgent, agentsConfig, inputStore);

    const totalLeaders = Object.entries(agentsConfig).filter(([_, cfg]) => cfg.isLeader);

    if (totalLeaders.length !== 1) throw new Error(`Exactly one leader needed. Found: ${totalLeaders.length}`);

    try {
        const start = performance.now();

        broadcastEvent('system', 'user-prompt', crypto.randomUUID(), { 
            user_prompt : userPrompt, 
            user_alias : userAlias 
        });

        const finalResult = await runAgent(
            totalLeaders[0][0], 
            userPrompt,
            userAlias,
            `The user addressing you has set their preferred alias to: ${userAlias}. Refer to them by this name.`
        );

        const duration = ((performance.now() - start) / 1000).toFixed(2);

        broadcastEvent('system', 'final-answer', crypto.randomUUID(), {
            final_answer : finalResult.content,
            runtime : duration
        });

        return { success : true };
    }
    catch (error) { 
        if (error.name === 'AbortError') {
            return { success: true, aborted: true };
        }
        return { success : false, error } 
    }
};