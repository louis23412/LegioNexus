export const definition = {
    type: 'function',
    function: {
        name: 'react_to_message',
        description: 'Add an emoji reaction to any message in the chatroom.',
        parameters: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: 'Target message ID' },
                emoji: { type: 'string', description: 'Emoji reaction (e.g. 👍, ✅, ❓, 🔥, 📌)' }
            },
            required: ['message_id', 'emoji'],
            additionalProperties: false
        },
        version: '2.0'
    }
};

export const createHandler = () => {
    return async (args, context = {}) => {
        const { chatroom, agentName } = context;
        if (!chatroom) return { status: 'error', message: 'Chatroom unavailable' };

        const { message_id, emoji } = args;
        const success = chatroom.addReaction(message_id, emoji, agentName);

        return {
            status: success ? 'success' : 'error',
            message: success ? `Reacted with ${emoji} to message ${message_id}` : 'Failed to add reaction'
        };
    };
};