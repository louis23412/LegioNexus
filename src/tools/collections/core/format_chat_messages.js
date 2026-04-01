export const definition = {
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
};

export const createHandler = () => {
    return async (args, context = {}) => {
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
    };
};