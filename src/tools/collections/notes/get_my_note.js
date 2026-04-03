export const definition = {
    type: 'function',
    function: {
        name: 'get_my_note',
        description: 'Retrieve the full content of one of your own private notes by ID.',
        parameters: {
            type: 'object',
            properties: {
                note_id: { type: 'string', description: 'Exact ID of the note' }
            },
            required: ['note_id'],
            additionalProperties: false
        },
        version: '1.0'
    }
};

export const createHandler = ({ inputStore }) => {
    return async (args, context = {}) => {
        const { note_id } = args || {};
        const { agentName } = context;

        if (!agentName || !note_id) {
            return { status: 'error', message: 'Missing agentName or note_id' };
        }

        const note = inputStore.getNote(agentName, note_id);
        if (!note) {
            return { status: 'error', message: `Note ${note_id} not found` };
        }

        return {
            status: 'success',
            data: note,
            message: `✅ Retrieved private note ${note_id}`
        };
    };
};