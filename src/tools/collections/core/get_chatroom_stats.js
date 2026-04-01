export const definition = {
    type: 'function',
    function: {
        name: 'get_chatroom_stats',
        description: 'Returns advanced statistics about the shared chatroom (new enhancement).',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        version: '1.0'
    }
};

export const createHandler = () => {
    return async (args, context = {}) => {
        const summary = context.chatroom.getStatusSummary();
        return {
            status: 'success',
            data: {
                ...summary,
                reactionsCount: Object.keys(context.chatroom.reactions || {}).length
            },
            message: 'Chatroom statistics retrieved successfully'
        };
    };
};