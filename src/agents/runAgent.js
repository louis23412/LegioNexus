import fs from 'fs';
import path from 'path';
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
    const summaryContext = ctxManager.getContextMessages(messages, true);

    console.log(`\n🧐 [${agentName} MULTI-LAYER SANITY CHECK]`);
    console.log('─'.repeat(110));
    console.log(`\x1b[90m[FOCUSED CONTEXT]\x1b[0m ${summaryContext.length} msgs (~${ctxManager.estimateTokens(summaryContext)} tokens)`);

    const denseConfig = {
        model: agentsConfig[agentName].model,
        messages: [{
            role: 'system',
            content: `PROTOCOL: createDenseSummary: output ONLY 3-5 bullets. MAX density. /no_think\nFormat exactly:\nU: [USER INTENT]\nS: [SYSTEM DIRECTIVES]\nP: [CURRENT PLAYBOOK]\nNo extra text, newlines minimal, no fluff.`
        }, {
            role: 'user',
            content: `You are ${agentName}. Dense-summary full conversation:\n${JSON.stringify(summaryContext)}`
        }],
        think: false,
        stream: true,
        options: { temperature: 0.0, top_p: 0.8, num_predict: 512 }
    };

    const trajectoryConfig = {
        model: agentsConfig[agentName].model,
        messages: [{
            role: 'system',
            content: `PROTOCOL: createTrajectorySummary: output ONLY labeled structure. /no_think\nU: [USER one sentence]\nS: [SYSTEM bullets]\nP: [KEY EVENTS] [OPEN QUESTIONS] [PLAYBOOK STATE]\nMinimal newlines, max density.`
        }, {
            role: 'user',
            content: `You are ${agentName}. Trajectory-summary full conversation:\n${JSON.stringify(summaryContext)}`
        }],
        think: false,
        stream: true,
        options: { temperature: 0.0, top_p: 0.8, num_predict: 512 }
    };

    const [denseSummaryStream, trajectorySummaryStream] = await Promise.all([
        withRetry(async () => ollama.chat(denseConfig)),
        withRetry(async () => ollama.chat(trajectoryConfig))
    ]);

    let denseSummary = '';
    console.log('\n\x1b[90m[DENSE LAYER]\x1b[0m');
    for await (const chunk of denseSummaryStream) {
        const content = chunk.message?.content || '';
        if (content) { process.stdout.write(content); denseSummary += content; }
    }

    let trajectorySummary = '';
    console.log('\n\n\x1b[90m[TRAJECTORY LAYER]\x1b[0m');
    for await (const chunk of trajectorySummaryStream) {
        const content = chunk.message?.content || '';
        if (content) { process.stdout.write(content); trajectorySummary += content; }
    }

    const verificationStream = await withRetry(async () => ollama.chat({
        model: agentsConfig[agentName].model,
        messages: [{
            role: 'system',
            content: `PROTOCOL: verifyAndConsolidate → ONLY JSON. /no_think {"trust_score":0-100,"consistency_between_summaries":0-100,"notes":[max3 short],"final_recommended_anchor":""}`
        }, {
            role: 'user',
            content: `Dense:${denseSummary} Trajectory:${trajectorySummary} Conv:${JSON.stringify(summaryContext)}`
        }],
        think: false,
        stream: true,
        format: 'json',
        options: { temperature: 0.0, top_p: 0.8, num_predict: 512 }
    }));

    let verificationJson = '';
    console.log('\n\n\x1b[90m[VERIFY LAYER]\x1b[0m');
    for await (const chunk of verificationStream) {
        const content = chunk.message?.content || '';
        if (content) { process.stdout.write(content); verificationJson += content; }
    }

    let trustScore = 88, consistency = 90, notes = ['anchor ok'], finalRecommended = '';
    try {
        const parsed = JSON.parse(verificationJson);
        trustScore = Math.max(0, Math.min(100, parsed.trust_score || 88));
        consistency = Math.max(0, Math.min(100, parsed.consistency_between_summaries || 90));
        notes = Array.isArray(parsed.notes) ? parsed.notes.slice(0, 3) : notes;
        finalRecommended = parsed.final_recommended_anchor || '';
    } catch (e) {
        console.warn('\x1b[33m[VERIFY FALLBACK]\x1b[0m');
    }

    const finalInjection = `✅ VERIFIED PLAYBOOK T${trustScore}C${consistency} U:${notes[0]||'—'} S:${notes[1]||'—'} P:${finalRecommended||notes[2]||'—'}`;

    ctxManager.addAnchor(denseSummary, trustScore, 'dense');
    ctxManager.addAnchor(trajectorySummary, Math.min(trustScore, consistency), 'trajectory');

    const prunedMessages = ctxManager.getContextMessages([...messages], false);
    console.log(`\n\n\x1b[90m[CTX HEALTH]\x1b[0m ${agentName} ~${ctxManager.estimateTokens(prunedMessages)}t`);
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

const runAgent = async (agentName, userPrompt, toolHeader) => {
    const ctxManager = new ContextManager(agentName);

    const selectedConfig = agentsConfig[agentName];

    const coreMessages = [
        { role: 'system', content: selectedConfig.system },
        { role: 'user', content: userPrompt },
        { role: 'tool', content: toolHeader}
    ];

    const agentTools = selectedConfig.tools.map(name => toolRegistry[name]?.definition).filter(Boolean);

    ctxManager.setCore(coreMessages);

    let messages = coreMessages;
    let iteration = 0;

    while (iteration < agentsConfig[agentName].maxIterations) {
        iteration++;
        const result = await withRetry(async () => ollama.chat({
            model: agentsConfig[agentName].model,
            options: agentsConfig[agentName].options,
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
                    messages.push({ role: 'tool', name: functionName, content: JSON.stringify(toolResult) });
                } else {
                    console.warn(`⚠️ No handler ${functionName}`);
                }
            }

            const contextUpdate = await streamMultiLayerVerifiedContextUpdate(agentName, messages, ctxManager);
            messages = contextUpdate.messagesForNextTurn;

            if (contextUpdate.verified) {
                messages.push({ role: 'tool', name: 'ctx_anchor', content: contextUpdate.injection });
            }

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
    } 
    
    catch (error) { return { success : false, error } }
};