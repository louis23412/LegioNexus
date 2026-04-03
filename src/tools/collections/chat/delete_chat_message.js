export const definition = {
    type: 'function',
    function: {
        name: 'delete_chat_message',
        description: 'Delete a message you previously sent in the chatroom. Soft-delete with permission checks.',
        parameters: {
            type: 'object',
            properties: {
                message_id: {
                    type: 'string',
                    description: 'The ID of the message to delete'
                }
            },
            required: ['message_id'],
            additionalProperties: false
        },
        version: '2.0'
    }
};

export const createHandler = () => {
    return async (args, context = {}) => {
        const { chatroom, agentName } = context;
        if (!chatroom) return { status: 'error', message: 'Chatroom unavailable' };

        const { message_id } = args;
        const result = chatroom.deleteMessage(message_id, agentName);

        if (result.success) {
            return {
                status: 'success',
                message: `🗑️ Message ${message_id} deleted successfully by ${agentName}`
            };
        } else {
            return {
                status: 'error',
                message: result.reason || 'Failed to delete message'
            };
        }
    };
};