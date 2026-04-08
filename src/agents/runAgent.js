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

// ====================== RELIABILITY HELPERS ======================
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

// ====================== PROTOCOL PARSER (GENERIC, NO HARD-CODED NAMES) ======================
const extractProtocolParts = (text) => {
    if (!text || typeof text !== 'string') {
        console.warn('\x1b[33m[PROTOCOL PARSER] Empty or invalid text\x1b[0m');
        return { U: '—', S: '—', P: '—' };
    }

    const extract = (patterns) => {
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                return match[1].trim();
            }
        }
        return '—';
    };

    // U extraction - pure label based, works for both styles
    const U = extract([
        /MEM:U:\s*([^\n]+)/i,
        /U:\s*([^\n]+)/i,
        /MEM:EVENT\d*:\s*U\([^)]+\)\s*([^\n]+)/i,   // capture content after U(...) in EVENT lines
        /MEM:EVENT\d*:\s*([^\n]+)/i                 // fallback any EVENT line content
    ]);

    // S extraction - pure label based
    const S = extract([
        /MEM:S:\s*([^\n]+)/i,
        /S:\s*([^\n]+)/i,
        /MEM:EVENT\d*:\s*S\([^)]+\)\s*([^\n]+)/i,   // capture content after S(...) in EVENT lines
        /MEM:EVENT\d*:\s*([^\n]+)/i                 // fallback any EVENT line content
    ]);

    // P extraction - handles STATE and P labels, plus multi-line fallback
    const P = extract([
        /MEM:P:\s*([^\n]+)/i,
        /P:\s*([^\n]+)/i,
        /MEM:STATE:\s*([^\n]+)/i,
        /MEM:STATE:\s*(.+?)(?=\s*MEM:|$)/is,
        /(?:MEM:EVENT\d*:\s*.*?)+\s*MEM:STATE:\s*([^\n]+)/is,
        /MEM:(?!U:|S:|P:|EVENT|STATE:)([^\n]+)/i
    ]);

    return {
        U: U.substring(0, 140),
        S: S.substring(0, 140),
        P: P.substring(0, 220)
    };
};
// =============================================================================

// ====================== NEW: EMBEDDING SAFETY TRUNCATION ======================
const EMBED_MAX_TOKENS = 35000; // qwen3-embedding:8b = 40k → we keep safe headroom

const truncateForEmbedding = (messagesArray) => {
    let truncated = [...messagesArray];
    while (true) {
        const estTokens = Math.ceil(truncated.reduce((acc, msg) => {
            let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || {});
            return acc + (content.length / 3.7);
        }, 0));

        if (estTokens <= EMBED_MAX_TOKENS) break;

        if (truncated.length <= 5) {
            // final fallback: truncate the very last message
            const last = truncated[truncated.length - 1];
            if (last && last.content) {
                const str = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
                last.content = str.substring(0, Math.floor(EMBED_MAX_TOKENS * 3.7 * 0.85));
            }
            break;
        }
        truncated.shift(); // remove oldest message
    }
    return JSON.stringify(truncated);
};
// =============================================================================

const captureThoughtChain = (messages, agentName, extraStats = {}) => {
    if (!teamThoughtChains[agentName]) teamThoughtChains[agentName] = [];
    const roughTokens = Math.ceil(messages.reduce((acc, msg) => {
        let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || {});
        return acc + (content.length / 3.7);
    }, 0));

    const stats = {
        chainId: teamThoughtChains[agentName].length,
        numMessages: messages.length,
        roughTokens,
        iteration: extraStats.iteration || 0,
        finalType: extraStats.finalType || 'unknown',
        ...extraStats
    };
    teamThoughtChains[agentName].push({ ...stats, thoughts: [...messages] });
};

const streamMultiLayerVerifiedContextUpdate = async (agentName, messages, ctxManager) => {
    const summaryContext = ctxManager.getContextMessages(messages);

    console.log(`\n🧐 [${agentName} MULTI-LAYER SANITY CHECK]`);
    console.log('─'.repeat(110));
    console.log(`\x1b[90m[FOCUSED CONTEXT]\x1b[0m ${summaryContext.length} msgs (~${ctxManager.estimateTokens(summaryContext)} tokens)`);

    // 1. TWO DIFFERENT STYLES — PAST ONLY, COMPACT CONTEXT PROTOCOL
    const denseConfig = {
        model: agentsConfig[agentName].model,
        messages: [{
            role: 'system',
            content: `PROTOCOL: createCompactPastSummary STYLE1 → ONLY past events. MAX density. /no_think /no_future /no_suggestions
Output EXACTLY in Context Protocol language with memory labels.
Format:
MEM:U: [one-line past user intent]
MEM:S: [system state]
MEM:P: [playbook + key events compact]
No extra text, no newlines beyond labels, no next steps, no suggestions.`
        }, {
            role: 'user',
            content: `You are ${agentName}. Compact past-summary of full conversation:\n${JSON.stringify(summaryContext)}`
        }],
        think: false,
        stream: true,
        options: { ...agentsConfig[agentName].options, num_predict: 512 }
    };

    const trajectoryConfig = {
        model: agentsConfig[agentName].model,
        messages: [{
            role: 'system',
            content: `PROTOCOL: createCompactPastSummary STYLE2 → ONLY past events. MAX density. /no_think /no_future /no_suggestions
Output as labeled memory chain (different style from STYLE1).
Format:
MEM:EVENT1: ...
MEM:EVENT2: ...
MEM:STATE: [current playbook state]
Minimal newlines, compact protocol language. Only past.`
        }, {
            role: 'user',
            content: `You are ${agentName}. Compact past-summary of full conversation:\n${JSON.stringify(summaryContext)}`
        }],
        think: false,
        stream: true,
        options: { ...agentsConfig[agentName].options, num_predict: 512 }
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

    // 2. ADVANCED RELIABILITY CHECK — WITH EMBEDDING SAFETY TRUNCATION
    console.log('\n\n\x1b[90m[EMBEDDING + REGEX RELIABILITY GATE]\x1b[0m');
    const embedModel = 'qwen3-embedding';

    // === SAFETY TOKEN LIMIT ===
    let convText = JSON.stringify(summaryContext);
    const estTokens = Math.ceil(summaryContext.reduce((acc, msg) => {
        let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || {});
        return acc + (content.length / 3.7);
    }, 0));

    if (estTokens > EMBED_MAX_TOKENS) {
        console.log(`\x1b[33m[EMBED TRUNCATION]\x1b[0m Full context ~${estTokens}t > ${EMBED_MAX_TOKENS}. Using LAST PART only.`);
        convText = truncateForEmbedding(summaryContext);
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

    // 3. OBJECTIVELY SELECT THE BEST SUMMARY
    const bestSummary = reliabilityDense >= reliabilityTraj ? denseSummary : trajectorySummary;
    const bestType = reliabilityDense >= reliabilityTraj ? 'dense' : 'trajectory';
    const bestReliability = Math.max(reliabilityDense, reliabilityTraj);

    console.log(`\n\x1b[90m[OBJECTIVE WINNER]\x1b[0m ${bestType.toUpperCase()} (${bestReliability}%) will be used for final anchor content`);

    // 4. VERIFICATION LAYER (unchanged)
    const verificationStream = await withRetry(async () => ollama.chat({
        model: agentsConfig[agentName].model,
        messages: [{
            role: 'system',
            content: `PROTOCOL: verifyAndConsolidate → ONLY JSON. /no_think
Use the objective reliability metrics + conversation.
Output EXACTLY:
{"trust_score":0-100,"consistency_between_summaries":0-100,"notes":[max3 short]}
Do NOT output final_recommended_anchor.`
        }, {
            role: 'user',
            content: `Dense:${denseSummary}
Trajectory:${trajectorySummary}
BestSummary (objective winner):${bestSummary}
Conv:${JSON.stringify(summaryContext)}
RELIABILITY METRICS:
SemanticSimDense:${simDense.toFixed(3)} Traj:${simTraj.toFixed(3)} Self:${simSelf.toFixed(3)}
KeywordJaccardDense:${jaccDense.toFixed(3)} Traj:${jaccTraj.toFixed(3)}
ReliabilityDense:${reliabilityDense} ReliabilityTraj:${reliabilityTraj}`
        }],
        think: false,
        stream: true,
        format: 'json',
        options: { ...agentsConfig[agentName].options, num_predict: 512 }
    }));

    let verificationJson = '';
    console.log('\n\x1b[90m[VERIFY LAYER — SCORES ONLY]\x1b[0m');
    for await (const chunk of verificationStream) {
        const content = chunk.message?.content || '';
        if (content) { process.stdout.write(content); verificationJson += content; }
    }

    let trustScore = 88, consistency = 90, notes = ['anchor ok'];
    try {
        const parsed = JSON.parse(verificationJson);
        trustScore = Math.max(0, Math.min(100, parsed.trust_score || 88));
        consistency = Math.max(0, Math.min(100, parsed.consistency_between_summaries || 90));
        notes = Array.isArray(parsed.notes) ? parsed.notes.slice(0, 3) : notes;
    } catch (e) {
        console.warn('\x1b[33m[VERIFY FALLBACK]\x1b[0m');
    }

    // 5. FINAL ANCHOR CONTENT
    const { U, S, P } = extractProtocolParts(bestSummary);

    const prunedMessages = ctxManager.getContextMessages(messages);

    if (trustScore >= 75 && consistency >= 50 && bestReliability >= 50) {
        ctxManager.addAnchor(bestSummary, Math.min(trustScore, bestReliability), bestType);

        const finalInjection = `[CTX ANCHOR T${trustScore}R${bestReliability}C${consistency}] U:${U} S:${S} P:${P} [${bestType.toUpperCase()}]`;
        console.log(`\n\x1b[90m[ANCHOR CREATED]\x1b[0m ${finalInjection}`);
    } else {
        console.log(`\n\x1b[90m[ANCHOR SKIPPED]\x1b[0m Verification failed — keeping more raw turns instead`);
    }

    console.log(`\n\x1b[90m[CTX HEALTH]\x1b[0m ${agentName} ~${ctxManager.estimateTokens(prunedMessages)}t`);
    console.log('─'.repeat(110));

    return {
        messagesForNextTurn: prunedMessages
    };
};

const runAgent = async (agentName, userPrompt, toolHeader) => {
    const ctxManager = new ContextManager(agentName);

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
            messages: iteration === 1 ? startingContext : messages,
            tools: agentTools,
            think: true,
            stream: true
        }));

        const assistantMessage = { role: 'assistant', content: '', thinking: '', tool_calls: [] };
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
                    captureThoughtChain(messages, agentName, { iteration, finalType: 'finalize' });
                    return { content: args.final_answer || '[No answer]', explanation: args.consensus_explanation || '', finalized: true, messages };
                }

                const handler = getToolHandler(functionName, toolRegistry);
                if (handler) {
                    const toolResult = await handler(args, { agentName, chatroom });
                    messages.push({ role: 'tool', eventId: crypto.randomUUID(), name: functionName, content: JSON.stringify(toolResult) });
                } else {
                    console.warn(`⚠️ No handler ${functionName}`);
                }
            }

            // const contextUpdate = await streamMultiLayerVerifiedContextUpdate(agentName, messages, ctxManager);
            // messages = contextUpdate.messagesForNextTurn;
            messages = ctxManager.getContextMessages(messages);

            continue;
        }

        if (assistantMessage.content?.trim()) {
            captureThoughtChain(messages, agentName, { iteration, finalType: 'content' });
            return { content: assistantMessage.content.trim(), messages };
        }

        break;
    }

    captureThoughtChain(messages, agentName, { iteration, finalType: 'max_it' });
    return { content: `[${agentName}] Max iterations.`, messages };
};

const saveConversation = (cId) => {
    const logDir = path.join(import.meta.dirname, '..', '..', 'chat_logs');
    const filePath = path.join(logDir, `${cId}.json`);

    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
    fs.writeFileSync(filePath, JSON.stringify({
        thought_chains : teamThoughtChains,
        team_chat : chatroom.dump()
    }));
}

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
            `The user addressing you has set their preferred alias to: ${userAlias}. Refer to them by this name.`
        );

        console.log('\n🏆 [FINAL TEAM ANSWER]');
        console.log('─'.repeat(90));

        if (leaderResult.explanation) console.log(`📋 Consensus explanation:\n\x1b[33m${leaderResult.explanation}\x1b[0m\n`);

        console.log('🤖 Final answer:')
        console.log(`\x1b[32m${leaderResult.content}\x1b[0m`);

        saveConversation(conversationId);

        const duration = ((performance.now() - start) / 1000).toFixed(2);
        console.log(`\n⏳ Total time: ${duration}s | 💾 Full team thoughts: /chat_logs/${conversationId}.json`);
        console.log('─'.repeat(90) + '\n');

        return { success : true };
    } catch (error) { return { success : false, error } }
};