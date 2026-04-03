export const definition = {
    type: 'function',
    function: {
        name: 'search_chat_messages',
        description: 'Advanced search across the entire chatroom with filters (keyword, speaker, topic, date, thread).',
        parameters: {
            type: 'object',
            properties: {
                keyword: { type: 'string', description: 'Search term' },
                speaker: { type: 'string', description: 'Filter by speaker' },
                topic: { type: 'string', description: 'Filter by topic' },
                limit: { type: 'number', description: 'Max results (default 30)' }
            },
            required: ['keyword'],
            additionalProperties: false
        },
        version: '2.0'
    }
};

export const createHandler = () => {
    return async (args, context = {}) => {
        const { chatroom } = context;
        if (!chatroom) return { status: 'error', message: 'Chatroom unavailable' };

        const results = chatroom.search(args || {});

        return {
            status: 'success',
            data: { results, count: results.length },
            message: `🔎 Found ${results.length} matching messages`
        };
    };
};