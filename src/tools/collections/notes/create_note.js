export const definition = {
    type: 'function',
    function: {
        name: 'create_note',
        description: 'Create a new private note visible ONLY to yourself. Use for personal memory, calculations or reminders during the task.',
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Short, descriptive title (max 80 chars recommended)' },
                body: { type: 'string', description: 'Full content/body of the note' }
            },
            required: ['title', 'body'],
            additionalProperties: false
        },
        version: '1.0'
    }
};

export const createHandler = ({ inputStore }) => {
    return async (args, context = {}) => {
        const { title, body } = args || {};
        const { agentName } = context;

        if (!agentName) return { status: 'error', message: 'Agent context missing' };
        if (!title?.trim() || !body?.trim()) {
            return { status: 'error', message: 'Both title and body are required' };
        }

        const note = inputStore.createNote(agentName, title, body);
        return {
            status: 'success',
            data: note,
            message: `✅ Private note created (ID: ${note.id})`
        };
    };
};