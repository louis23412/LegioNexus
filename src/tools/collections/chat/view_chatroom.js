export const definition = {
    type: 'function',
    function: {
        name: 'view_chatroom',
        description: 'Get a clean, formatted view of the chatroom.',
        parameters: {
            type: 'object',
            properties: {
                topic: {
                    type: 'string',
                    description: 'Optional topic to filter by (default: all)'
                },
                limit: {
                    type: 'number',
                    description: 'Number of recent messages to show (default: 40)'
                }
            },
            required: [],
            additionalProperties: false
        },
        version: '2.0'
    }
};

export const createHandler = () => {
    return async (args, context = {}) => {
        const { chatroom } = context;
        if (!chatroom) return { status: 'error', message: 'Chatroom unavailable' };

        const { topic, limit = 40 } = args || {};
        const view = chatroom.getChatView(topic, limit);

        return {
            status: 'success',
            data: { view },
            message: `📜 Chatroom view returned (${topic || 'all topics'})`
        };
    };
};