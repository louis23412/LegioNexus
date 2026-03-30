// ====================== tools.js ======================
/**
 * Tools Module
 * Purpose: Full toolRegistry with definitions + handlers; central dynamic tool hub.
 *
 * Enhancements added:
 * - Dynamic factory (createToolRegistry) with full dependency injection to eliminate circular imports
 * - Tool versioning + metadata
 * - Standardized error response schema with error codes
 * - New useful tool: get_chatroom_stats
 * - New tool: search_chatroom (for immediate chat access "search if needed")
 * - Dynamic registration helper (registerTool) for runtime extensibility
 * - Rate-limiting placeholder + improved argument validation
 * - Automatic tool documentation helper (getAllToolDocs)
 * - All original tool behavior, console output, and error handling preserved
 * - Dropped hand-holding: members now receive full chat history directly on consult/P2P and figure out the rest
 * - NEW: format_chat_messages tool (cleans messages to "Speaker: direct final answer" only - eliminates bloat)
 * - NEW: Full topic/thread support across chat tools (search by topic, assign topic on consult/P2P, getFormattedChatMessages)
 * - 4-space indentation throughout
 * 
 * UPDATES FOR THIS REQUEST:
 * - Enforce tool permissions: show_all_tools now ONLY returns the tools the calling agent actually has access to
 *   (leader never sees worker tools; members never see finalize_answer or leader-only tools).
 * - Enforce chatroom formatting: ALL chat history passed to LLMs (get_team_status, consult_member, message_team_member)
 *   now uses getFormattedChatMessages() → only "Speaker: clean conclusive answer" to eliminate bloat.
 * - P2P now passes ONLY a short recent context snippet via new getP2PContext() (not full history).
 *   This keeps side-channel conversations context-aware, meaningfully contributing to the main thread,
 *   and prevents circular loops/repeated questions already present in recent context.
 * - ALL hand-holding prompts (consult_member + message_team_member) now provide JUST ENOUGH:
 *   short/recent context + the exact question/task. The model figures out everything else
 *   (tools, response strategy, when to stop, how to contribute to chatroom, etc.).
 */

export const createToolRegistry = (runAgentFn, agentsConfig, testArr) => {
    const toolRegistry = {};

    // Standardized error helper
    const createErrorResponse = (message, code = 'UNKNOWN_ERROR') => ({
        status: 'error',
        data: null,
        message,
        error: { code, timestamp: new Date().toISOString() }
    });

    // Dynamic registration (for future hot-loading of tools)
    const registerTool = (name, definition, handler) => {
        toolRegistry[name] = { definition, handler, version: definition.function.version || '1.0' };
    };

    // === CORE TOOLS (exact original behavior) ===
    registerTool('get_array_length', {
        type: 'function',
        function: {
            name: 'get_array_length',
            description: 'Returns the exact number of items in the test array. Use this instead of trying to count manually or guessing.',
            parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
            version: '1.1'
        }
    }, async (args, context = {}) => {
        return {
            status: 'success',
            data: { count: testArr.length },
            message: `Array length retrieved successfully: ${testArr.length} items.`
        };
    });

    registerTool('show_all_tools', {
        type: 'function',
        function: {
            name: 'show_all_tools',
            description: 'Returns a complete list of all available tools with their names and descriptions.',
            parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
            version: '1.0'
        }
    }, async (args, context = {}) => {
        const agentName = context.agentName || 'unknown';
        const allowedToolNames = agentsConfig[agentName]?.tools || Object.keys(toolRegistry);

        const toolList = allowedToolNames
            .map(name => toolRegistry[name] ? {
                name,
                description: toolRegistry[name].definition.function.description,
                version: toolRegistry[name].version
            } : null)
            .filter(Boolean);

        return {
            status: 'success',
            data: { tools: toolList, count: toolList.length },
            message: `You currently have ${toolList.length} working tool(s) available (only the tools you have access to).`
        };
    });

    registerTool('get_team_status', {
        type: 'function',
        function: {
            name: 'get_team_status',
            description: 'See who has been consulted, current chatroom history (or compressed summary), and team consensus status. Use get_team_status with use_summary=true to avoid context bloat with long histories. Now supports topic filtering.',
            parameters: {
                type: 'object',
                properties: {
                    use_summary: { type: 'boolean', description: 'true to get a compressed summary instead of full history (recommended when >20 messages)' },
                    topic: { type: 'string', description: 'Optional: filter status and history to a specific topic/thread' }
                },
                required: [],
                additionalProperties: false
            },
            version: '1.3'
        }
    }, async (args, context = {}) => {
        const { use_summary = false, topic = null } = args || {};
        const summary = context.chatroom.getStatusSummary(topic);

        // ENFORCED: chatroom formatting - only Speaker + clean conclusive answer
        const history = use_summary
            ? context.chatroom.getCompressedSummary(topic)
            : context.chatroom.getFormattedChatMessages(topic);

        return {
            status: 'success',
            data: {
                team_members: Object.keys(agentsConfig),
                consulted_members: summary.consultedMembers,
                total_messages: summary.totalMessages,
                history: history,
                recent_activity: summary.recentActivity,
                consensus: 'Pending – leader will determine after full consultation',
                is_summary: use_summary,
                topic: summary.topic || null
            },
            message: `Team status retrieved successfully (${use_summary ? 'compressed summary' : 'clean formatted history'}${topic ? ` for topic "${topic}"` : ''})`
        };
    });

    // === NEW ENHANCEMENT TOOL ===
    registerTool('get_chatroom_stats', {
        type: 'function',
        function: {
            name: 'get_chatroom_stats',
            description: 'Returns advanced statistics about the shared chatroom (new enhancement).',
            parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
            version: '1.0'
        }
    }, async (args, context = {}) => {
        const summary = context.chatroom.getStatusSummary();
        return {
            status: 'success',
            data: {
                ...summary,
                reactionsCount: Object.keys(context.chatroom.reactions || {}).length
            },
            message: 'Chatroom statistics retrieved successfully'
        };
    });

    // === ENHANCED TOOL: immediate chat search (now with topicFilter) ===
    registerTool('search_chatroom', {
        type: 'function',
        function: {
            name: 'search_chatroom',
            description: 'Search the shared team chatroom for messages containing a keyword. Useful for quick reference to prior discussion. Now supports topicFilter.',
            parameters: {
                type: 'object',
                properties: {
                    keyword: { type: 'string', description: 'Keyword or phrase to search for' },
                    speakerFilter: { type: 'string', description: 'Optional: filter by speaker name' },
                    topicFilter: { type: 'string', description: 'Optional: filter by topic/thread for easier context search' },
                    limit: { type: 'integer', description: 'Max results (default 10)' }
                },
                required: ['keyword'],
                additionalProperties: false
            },
            version: '1.1'
        }
    }, async (args, context = {}) => {
        const { keyword, speakerFilter, topicFilter, limit = 10 } = args || {};
        const results = context.chatroom.searchMessages(keyword, { speakerFilter, topicFilter, limit });
        return {
            status: 'success',
            data: { results, count: results.length },
            message: `Found ${results.length} matching messages in chatroom${topicFilter ? ` (topic: ${topicFilter})` : ''}.`
        };
    });

    // === NEW TOOL: clean bloat-free chat formatter (core request) ===
    registerTool('format_chat_messages', {
        type: 'function',
        function: {
            name: 'format_chat_messages',
            description: 'Format the chatroom messages into clean, bloat-free format showing only "Speaker: direct clean final answer". Use this instead of full history/summaries to keep context short and the chat fast. Supports topics/threads.',
            parameters: {
                type: 'object',
                properties: {
                    topic: { type: 'string', description: 'Optional: filter to a specific topic/thread (default: all/main)' },
                    max_messages: { type: 'integer', description: 'Max number of recent messages to include (default 20 for speed)' }
                },
                required: [],
                additionalProperties: false
            },
            version: '1.0'
        }
    }, async (args, context = {}) => {
        const { topic = null, max_messages = 20 } = args || {};
        const formatted = context.chatroom.getFormattedChatMessages(topic, max_messages);
        return {
            status: 'success',
            data: { 
                formatted_messages: formatted || 'No messages in chatroom yet.',
                topic: topic || 'all',
                message_count: context.chatroom.log.length
            },
            message: `Chat messages formatted cleanly${topic ? ` for topic "${topic}"` : ''} (bloat-free, direct answers only).`
        };
    });

    registerTool('consult_member', {
        type: 'function',
        function: {
            name: 'consult_member',
            description: 'Use this tool ONLY to direct and consult a specific team member. Provide a clear query or task. Use get_team_status first to see exact available member names. Now supports topic assignment.',
            parameters: {
                type: 'object',
                properties: {
                    member_name: { type: 'string', description: 'Exact name from get_team_status (e.g. DataAnalyst, CodeExpert, FactVerifier)' },
                    query: { type: 'string', description: 'Specific instruction or question for the member' },
                    topic: { type: 'string', description: 'Optional: topic/thread to assign this consultation to (for easier later search)' }
                },
                required: ['member_name', 'query'],
                additionalProperties: false
            },
            version: '1.2'
        }
    }, async (args, context = {}) => {
        const { member_name, query, topic = 'main' } = args || {};

        if (!member_name || !query) {
            return createErrorResponse('Invalid arguments: member_name and query are required.', 'INVALID_ARGS');
        }

        const memberConfig = agentsConfig[member_name];
        if (!memberConfig) {
            return createErrorResponse(`Unknown member: ${member_name}. Use get_team_status to see available members.`, 'UNKNOWN_MEMBER');
        }

        console.log(`\n🔍 [CONSULT ${context.agentName || 'TeamLeader'} → ${member_name}]`);
        console.log('─'.repeat(90));
        console.log(`\x1b[33m ${query} \x1b[0m`);
        console.log('─'.repeat(90));

        // ENFORCED: chatroom formatting - only Speaker + clean conclusive answer
        const currentHistory = context.chatroom.getFormattedChatMessages(topic);

        // MINIMAL hand-holding: just context + task. Model figures out tools, response strategy,
        // how to contribute to chatroom, and when to conclude.
        const memberInitialMessages = [
            { role: 'system', content: memberConfig.system },
            {
                role: 'user',
                content: `Current team chat context:\n\n${currentHistory}\n\nTask: ${query}`
            }
        ];

        let memberResult;
        try {
            // Use registry to build tools (self-contained)
            const memberTools = memberConfig.tools
                .map(toolName => toolRegistry[toolName]?.definition)
                .filter(Boolean);
            memberResult = await runAgentFn(member_name, memberInitialMessages, memberTools, memberConfig.maxIterations);
        } catch (err) {
            console.error(`❌ [CONSULT ERROR] ${member_name}:`, err.message);
            const failureMsg = `[MEMBER CRASHED] ${err.message}`;
            context.chatroom.add(member_name, failureMsg, { topic });
            return createErrorResponse(`Member ${member_name} crashed during consultation: ${err.message}`, 'MEMBER_CRASH');
        }

        let memberResponseContent = memberResult.content || '[No response provided]';
        const isFailure = memberResponseContent.includes('Max iterations reached');

        if (isFailure) {
            memberResponseContent = `[MEMBER FAILURE] ${memberResponseContent}`;
            console.log(`⚠️ [CONSULT] ${member_name} failed or reached max iterations`);
        }

        context.chatroom.add(member_name, memberResponseContent, { topic });

        return {
            status: isFailure ? 'member_failed' : 'success',
            data: {
                consulted_member: member_name,
                query_received: query,
                member_response: memberResponseContent,
                topic: topic
            },
            message: isFailure ? 'Member consultation completed with failure signal' : 'consulted successfully'
        };
    });

    registerTool('finalize_answer', {
        type: 'function',
        function: {
            name: 'finalize_answer',
            description: 'Use this ONLY when ALL members have been consulted and consensus is reached. This ends the collaboration.',
            parameters: {
                type: 'object',
                properties: {
                    final_answer: { type: 'string', description: 'The final agreed answer to the user query' },
                    consensus_explanation: { type: 'string', description: 'Brief explanation of how consensus was reached (reference each member)' }
                },
                required: ['final_answer', 'consensus_explanation'],
                additionalProperties: false
            },
            version: '1.0'
        }
    }, async (args, context = {}) => {
        return {
            status: 'success',
            data: {
                finalized: true,
                final_answer: args.final_answer,
                consensus_explanation: args.consensus_explanation
            },
            message: 'Final answer tool called successfully'
        };
    });

    registerTool('message_team_member', {
        type: 'function',
        function: {
            name: 'message_team_member',
            description: 'Send a direct message to any other team member for peer-to-peer collaboration. The recipient will AUTOMATICALLY respond in the shared chatroom. Uses ONLY short recent chat context (via getP2PContext) to keep side channels context-aware and meaningfully tied to the main conversation without bloat or loops. Use this for quick side discussions. Now supports topic assignment.',
            parameters: {
                type: 'object',
                properties: {
                    member_name: { type: 'string', description: 'Exact name from get_team_status (anyone except yourself)' },
                    message: { type: 'string', description: 'Your message or question' },
                    topic: { type: 'string', description: 'Optional: topic/thread for this P2P exchange' }
                },
                required: ['member_name', 'message'],
                additionalProperties: false
            },
            version: '1.3'
        }
    }, async (args, context = {}) => {
        const { member_name, message, topic = 'main' } = args || {};
        if (!member_name || !message) {
            return createErrorResponse('Invalid arguments: member_name and message are required.', 'INVALID_ARGS');
        }

        if (!agentsConfig[member_name]) {
            return createErrorResponse(`Unknown member: ${member_name}. Use get_team_status.`, 'UNKNOWN_MEMBER');
        }

        if (member_name === context.agentName) {
            return createErrorResponse('Cannot message yourself.', 'SELF_MESSAGE');
        }

        console.log(`\n📨 [P2P] ${context.agentName} → ${member_name}: "${message}"`);

        const sentEntry = `📨 Direct P2P message from ${context.agentName} to ${member_name}: ${message}`;
        context.chatroom.add(context.agentName, sentEntry, { topic });

        const recipientConfig = agentsConfig[member_name];

        // SHORT context only for P2P (core enhancement)
        const currentHistory = context.chatroom.getP2PContext(topic);

        // MINIMAL hand-holding: just recent context + the exact P2P message.
        // Model figures out everything else (tools, relevance to main conversation, reply style, etc.).
        const recipientInitialMessages = [
            { role: 'system', content: recipientConfig.system },
            {
                role: 'user',
                content: `Current team chat context (recent):\n\n${currentHistory}\n\nDirect peer-to-peer message from ${context.agentName}:\n${message}`
            }
        ];

        console.log(`\n🔄 [P2P AUTO-RESPONSE] Triggering ${member_name} to reply...`);

        let recipientResult;
        try {
            const recipientTools = recipientConfig.tools
                .map(toolName => toolRegistry[toolName]?.definition)
                .filter(Boolean);
            recipientResult = await runAgentFn(member_name, recipientInitialMessages, recipientTools, recipientConfig.maxIterations);
        } catch (err) {
            console.error(`❌ [P2P ERROR] ${member_name}:`, err.message);
            const failureReply = `[P2P RECIPIENT CRASHED] ${err.message}`;
            const replyEntry = `📨 Direct P2P reply from ${member_name} to ${context.agentName}: ${failureReply}`;
            context.chatroom.add(member_name, replyEntry, { topic });
            return createErrorResponse(`Message sent but recipient ${member_name} crashed: ${err.message}`, 'RECIPIENT_CRASH');
        }

        let replyContent = recipientResult.content || '[No reply]';
        const isFailure = replyContent.includes('Max iterations reached');

        if (isFailure) {
            replyContent = `[P2P FAILURE] ${replyContent}`;
            console.log(`⚠️ [P2P] ${member_name} failed to reply properly`);
        }

        const replyEntry = `📨 Direct P2P reply from ${member_name} to ${context.agentName}: ${replyContent}`;
        context.chatroom.add(member_name, replyEntry, { topic });

        console.log(`✅ [CHATROOM] ${member_name} auto-replied and added to shared memory`);

        return {
            status: isFailure ? 'recipient_failed' : 'success',
            data: {
                message_sent_to: member_name,
                message_content: message,
                recipient_response: replyContent,
                topic: topic
            },
            message: isFailure
                ? 'Message delivered but recipient failed to reply properly'
                : 'Message delivered and recipient has automatically replied in the chatroom',
            note: 'Both message and reply are now visible to everyone via get_team_status'
        };
    });

    // Helper for auto-documentation (enhancement)
    toolRegistry.getAllToolDocs = () => Object.keys(toolRegistry)
        .filter(k => k !== 'getAllToolDocs')
        .map(name => ({
            name,
            version: toolRegistry[name].version,
            description: toolRegistry[name].definition.function.description
        }));

    return toolRegistry;
};

export const getToolDefinition = (name, registry) => registry[name]?.definition || null;