export const definition = {
    type: 'function',
    function: {
        name: 'consult_member',
        description: 'Use this tool ONLY to direct and consult a specific team member. Provide a clear query or task. Use get_team_status first to see exact available member names. Now supports topic assignment.',
        parameters: {
            type: 'object',
            properties: {
                member_name: { type: 'string', description: 'Exact name from get_team_status' },
                query: { type: 'string', description: 'Specific instruction or question for the member' },
                topic: { type: 'string', description: 'Optional: topic/thread to assign this consultation to (for easier later search)' }
            },
            required: ['member_name', 'query'],
            additionalProperties: false
        },
        version: '1.2'
    }
};

export const createHandler = ({ runAgentFn, agentsConfig, createErrorResponse, toolRegistry }) => {   // ← toolRegistry added
    return async (args, context = {}) => {
        const { member_name, query, topic = 'main' } = args || {};

        if (!member_name || !query) {
            return createErrorResponse('Invalid arguments: member_name and query are required.', 'INVALID_ARGS');
        }

        const memberConfig = agentsConfig[member_name];
        if (!memberConfig) {
            return createErrorResponse(`Unknown member: ${member_name}. Use get_team_status to see available members.`, 'UNKNOWN_MEMBER');
        }

        if (context.agentName === member_name) {
            return createErrorResponse(`You can not consult yourself (${context.agentName})`, 'SELF_REFF');
        }

        console.log(`\n🔍 [CONSULT ${context.agentName || 'TeamLeader'} → ${member_name}]`);
        console.log('─'.repeat(90));
        console.log(`\x1b[33m ${query} \x1b[0m`);
        console.log('─'.repeat(90));

        const currentHistory = context.chatroom.getFormattedChatMessages(topic);

        const memberInitialMessages = [
            { role: 'system', content: memberConfig.system },
            {
                role: 'user',
                content: `Current team chat context:\n\n${currentHistory}\n\nTask: ${query}`
            }
        ];

        let memberResult;
        try {
            const memberTools = memberConfig.tools
                .map(toolName => toolRegistry[toolName]?.definition)
                .filter(Boolean);
            memberResult = await runAgentFn(member_name, memberInitialMessages, memberTools);
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
    };
};