export const definition = {
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
};

export const createHandler = () => {
    return async (args, context = {}) => {
        const { keyword, speakerFilter, topicFilter, limit = 10 } = args || {};
        const results = context.chatroom.searchMessages(keyword, { speakerFilter, topicFilter, limit });
        return {
            status: 'success',
            data: { results, count: results.length },
            message: `Found ${results.length} matching messages in chatroom${topicFilter ? ` (topic: ${topicFilter})` : ''}.`
        };
    };
};