export const definition = {
    type: 'function',
    function: {
        name: 'consult_member',
        description: 'Use this tool ONLY to direct and consult a specific team member. Provide a clear query or task.',
        parameters: {
            type: 'object',
            properties: {
                member_name: { type: 'string', description: 'Exact member name' },
                query: { type: 'string', description: 'Specific instruction or question for the member' }
            },
            required: ['member_name', 'query'],
            additionalProperties: false
        },
        version: '1.2'
    }
};

export const createHandler = ({ runAgentFn, agentsConfig, createErrorResponse }) => {
    return async (args, context = {}) => {
        const { member_name, query } = args || {};

        if (!member_name || !query) {
            return createErrorResponse('Invalid arguments: member_name and query are required.', 'INVALID_ARGS');
        }

        const memberConfig = agentsConfig[member_name];
        if (!memberConfig) {
            return createErrorResponse(`Unknown member: ${member_name}.`, 'UNKNOWN_MEMBER');
        }

        if (context.agentName === member_name) {
            return createErrorResponse(`You can not consult yourself (${context.agentName})`, 'SELF_REFF');
        }

        console.log(`\n🔍 [CONSULT ${context.agentName} → ${member_name}]`);
        console.log('─'.repeat(90));
        console.log(`\x1b[33m ${query} \x1b[0m`);
        console.log('─'.repeat(90));

        let memberResult;
        try {
            memberResult = await runAgentFn(
                member_name,
                `Task from ${context.agentName}:\n${query}`,
                context.agentName,
                `You are being adressed by ${context.agentName}. Refer to them by this name.\nEnsure your contributions are recorded by analyzing and sending messages in the team chat.`
            );
        } catch (err) {
            console.error(`❌ [CONSULT ERROR] ${member_name}:`, err.message);
            return createErrorResponse(`Member ${member_name} crashed during consultation: ${err.message}`, 'MEMBER_CRASH');
        }

        let memberResponseContent = memberResult.content || '[No response provided]';
        const isFailure = memberResponseContent.includes('Max iterations reached');

        if (isFailure) {
            memberResponseContent = `[MEMBER FAILURE] ${memberResponseContent}`;
            console.log(`⚠️ [CONSULT] ${member_name} failed or reached max iterations`);
        }

        return {
            status: isFailure ? 'member_failed' : 'success',
            data: {
                consulted_member: member_name,
                query_received: query,
                member_response: memberResponseContent
            },
            message: isFailure ? 'Member consultation completed with failure signal' : 'consulted successfully'
        };
    };
};