import ollama from 'ollama';
import crypto from 'crypto';

import { agentsConfig } from './agentsConfig.js';
import { stripEventIds, withRetry } from '../utils.js';
import { toolRegistry } from '../tools/toolRegistry.js';
import { ContextManager } from '../context/contextManager.js';

const activeState = {
    conversationId : null,
    eventSocket : null,
    eventAbort : null
};

const setActiveState = async (id, sckt, sig) => {
    activeState.conversationId = id;
    activeState.eventSocket = sckt;
    activeState.eventAbort = sig;
}

const resetActiveState = () => {
    activeState.conversationId = null;
    activeState.eventSocket = null;
    activeState.eventAbort = null;
};

const broadcastEvent = (agentName, eventType, eventId, data) => { 
    activeState.eventSocket.emit(eventType, { agentName, eventId, data }) 
};

const getToolHandler = (toolName, registry) => { 
    return registry[toolName]?.handler || null 
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

const checkAbort = () => {
    if (activeState.eventAbort?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
    }
};

const runAgent = async (userPrompt, userAlias) => {
    const agentTools = agentsConfig.tools.map(name => toolRegistry[name]?.definition).filter(Boolean);

    const ctxManager = await ContextManager.init(
        'mongodb://0.0.0.0:60666/?directConnection=true',
        `${agentsConfig.name}-${userAlias}-${activeState.conversationId}`,
        agentsConfig.name,
        userAlias, 
        activeState.conversationId,
        userPrompt
    );

    let iteration = 0;
    let messages = await ctxManager.getContextUpdate(null, false, null);

    while (iteration < agentsConfig.maxIterations) {
        checkAbort();

        iteration++;
        const result = await withRetry(async () => ollama.chat({
            model: agentsConfig.model,
            options: agentsConfig.options,
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
                broadcastEvent(agentsConfig.name, 'think', thinkId, msg.thinking);
                assistantMessage.thinking += msg.thinking;
            }

            if (msg.content) {
                broadcastEvent(agentsConfig.name, 'content', contentId, msg.content);
                assistantMessage.content += msg.content;
            }

            if (msg.tool_calls?.length > 0) assistantMessage.tool_calls.push(...msg.tool_calls);

            if (chunk.done) { currentContextSize = chunk.prompt_eval_count };
        }

        if (currentContextSize) {
            contextFillPct = Number(((currentContextSize / agentsConfig.options.num_ctx) * 100).toFixed(3));

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
                    caller : agentsConfig.name,
                    tool_name : functionName,
                    arguments : args
                });

                const handler = getToolHandler(functionName, toolRegistry);

                if (handler) {
                    const toolResult = await handler(args);

                    messages.push({ 
                        role: 'tool', 
                        tool_name: functionName, 
                        eventId: crypto.randomUUID(), 
                        content: JSON.stringify(toolResult) 
                    });

                    broadcastEvent('system', 'tool-result', crypto.randomUUID(), {
                        caller : agentsConfig.name,
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
                        caller : agentsConfig.name,
                        failed_name : functionName
                    });
                }
            }

            checkAbort();

            messages = await ctxManager.getContextUpdate(messages, false, null);

            continue;
        }

        if (assistantMessage.content?.trim()) {
            checkAbort();

            await ctxManager.getContextUpdate(messages, true, assistantMessage.content.trim());

            await ctxManager.close();

            return { content: assistantMessage.content.trim() };
        }

        break;
    }

    await ctxManager.close();

    return { content: `[${agentsConfig.name}] Max iterations.` };
};

export const startConversation = async (convId, userPrompt, userAlias, eSckt, signal) => {
    await setActiveState(convId, eSckt, signal);

    try {
        const start = performance.now();

        broadcastEvent('system', 'user-prompt', crypto.randomUUID(), { 
            user_prompt : userPrompt, 
            user_alias : userAlias 
        });

        const finalResult = await runAgent(userPrompt, userAlias);

        const duration = ((performance.now() - start) / 1000).toFixed(2);

        broadcastEvent('system', 'final-answer', crypto.randomUUID(), {
            final_answer : finalResult.content,
            runtime : duration
        });

        resetActiveState();

        return { success : true };
    }
    catch (error) { 
        resetActiveState();

        if (error.name === 'AbortError') {
            return { success: true, aborted: true };
        }

        return { success : false, error } 
    }
};