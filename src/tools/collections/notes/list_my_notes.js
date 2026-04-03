export const definition = {
    type: 'function',
    function: {
        name: 'list_my_notes',
        description: 'List all your personal private notes (title + ID only).',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false
        },
        version: '1.0'
    }
};

export const createHandler = ({ inputStore }) => {
    return async (args, context = {}) => {
        const { agentName } = context;
        if (!agentName) return { status: 'error', message: 'Agent context missing' };

        const notes = inputStore.getMyNotes(agentName);
        return {
            status: 'success',
            data: notes.map(n => ({ id: n.id, title: n.title, createdAt: n.createdAt })),
            message: `You have ${notes.length} private note(s)`
        };
    };
};