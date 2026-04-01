export const definition = {
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
};

export const createHandler = ({ runAgentFn, agentsConfig, createErrorResponse, toolRegistry }) => {   // ← toolRegistry added
    return async (args, context = {}) => {
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

        const currentHistory = context.chatroom.getP2PContext(topic);

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
            recipientResult = await runAgentFn(member_name, recipientInitialMessages, recipientTools);
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
    };
};