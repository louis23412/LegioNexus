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

const stripEventIds = (messagesArray) => {
    return messagesArray.map(msg => {
        if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
            const { eventId, ...cleanMsg } = msg;
            return cleanMsg;
        }
        return msg;
    });
};

const calculateTrustScore = (anchorData, verifierTrust, consistency) => {
    const weights = {
        semantic_fidelity: 0.35,
        keyword_overlap: 0.15,
        verification_trust: 0.25,
        consistency: 0.12,
        cross_summary_agreement: 0.08,
        reliability_delta: 0.05
    };

    const avgSim = (anchorData.simDense + anchorData.simTraj) / 2;
    const avgJacc = (anchorData.jaccDense + anchorData.jaccTraj) / 2;
    const crossAgreementBonus = Math.max(0, 100 - Math.abs(anchorData.simSelf - 75)) * 0.3;

    const baseScore = 
        weights.semantic_fidelity * avgSim +
        weights.keyword_overlap * avgJacc +
        weights.verification_trust * verifierTrust +
        weights.consistency * consistency +
        weights.cross_summary_agreement * crossAgreementBonus +
        weights.reliability_delta * (100 - Math.abs(anchorData.reliabilityDense - anchorData.reliabilityTraj));

    return Number(baseScore.toFixed(3));
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
                    - Dense vs Full conversation : ${anchorData.simDense} 
                    - Trajectory vs Full conversation : ${anchorData.simTraj} 
                    - Dense vs Trajectory : ${anchorData.simSelf}

                    Jaccard keyword similarity:
                    - Dense : ${anchorData.jaccDense} 
                    - Trajectory : ${anchorData.jaccTraj}

                    Reliability score:
                    - Dense : ${anchorData.reliabilityDense} 
                    - Trajectory : ${anchorData.reliabilityTraj}

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

    const fullAnchorData = ctxManager.extractAnchorFeatures(
        modelSummaryContext, 
        { convEmbedding, denseEmbedding, trajEmbedding }, 
        { denseSummary, trajectorySummary }
    );

    broadcastEvent('ctx-manager', 'sanity-gate', crypto.randomUUID(), {
        agent : agentName,
        semantic_similarity : { layer1 : fullAnchorData.simDense, layer2: fullAnchorData.simTraj, cross_layer: fullAnchorData.simSelf },
        keyword_similarity : { layer1 : fullAnchorData.jaccDense, layer2 : fullAnchorData.jaccTraj },
        reliability_score : { layer1 : fullAnchorData.reliabilityDense, layer2 : fullAnchorData.reliabilityTraj }
    });

    checkAbort();

    const verificationJson = await getVerificationSummary(modelSummaryContext, agentName, fullAnchorData);

    const verifierTrustScore = verificationJson?.trust_score ? verificationJson.trust_score : 0;
    const consistency = verificationJson?.consistency_between_summaries ? verificationJson.consistency_between_summaries : 0;

    checkAbort();

    const bestSummary = fullAnchorData.reliabilityDense >= fullAnchorData.reliabilityTraj ? denseSummaryObject : trajectorySummaryObject;

    const { U, S, P, T } = bestSummary;

    const anchorTrustScore = calculateTrustScore(fullAnchorData, verifierTrustScore, consistency);

    if (anchorTrustScore >= 50) {
        const { anchorId, anchorStatus, anchorTime, resolutionAnchor } = ctxManager.addAnchor(
            anchorTrustScore, isLast, {
                dense : {
                    summary : denseSummaryObject,
                    keywords : [ ...fullAnchorData.kwDense ],
                    embeddings : denseEmbedding
                },

                trajectory : {
                    summary : trajectorySummaryObject,
                    keywords : [ ...fullAnchorData.kwTraj ],
                    embeddings : trajEmbedding
                }
            }, {
                turns : stripEventIds(summaryContext),
                keywords : [ ...fullAnchorData.kwConv ],
                embeddings : convEmbedding
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