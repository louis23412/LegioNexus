export const definition = {
    type: 'function',
    function: {
        name: 'send_chat_message',
        description: 'Send a message to the shared team chatroom. This is the main way agents communicate, share analysis, ask questions and build consensus.',
        parameters: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'The full message content (keep it clean, and direct)'
                },
                topic: {
                    type: 'string',
                    description: 'Topic/channel to post in (default: general)'
                },
                reply_to: {
                    type: 'string',
                    description: 'Optional message ID to reply to (creates threaded conversation)'
                }
            },
            required: ['content'],
            additionalProperties: false
        },
        version: '2.0'
    }
};

export const createHandler = () => {
    return async (args, context = {}) => {
        const { chatroom, agentName } = context;
        if (!chatroom) {
            return { status: 'error', message: 'Chatroom unavailable' };
        }

        const { content, topic, reply_to } = args || {};
        
        const message = chatroom.sendMessage(agentName, content, {
            topic: topic || 'general',
            replyTo: reply_to
        });

        return {
            status: 'success',
            data: {
                messageId: message.id,
                timestamp: message.timestamp,
                topic: message.topic,
                replyTo: message.replyTo
            },
            message: `✅ Message posted successfully to chatroom (ID: ${message.id})`
        };
    };
};