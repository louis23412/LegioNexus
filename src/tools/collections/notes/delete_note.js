export const definition = {
    type: 'function',
    function: {
        name: 'delete_note',
        description: 'Delete one of your own private notes by its ID. Use list_my_notes first to see your note IDs.',
        parameters: {
            type: 'object',
            properties: {
                note_id: { type: 'string', description: 'Exact ID of the note to delete' }
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

        const success = inputStore.deleteNote(agentName, note_id);
        if (!success) {
            return { status: 'error', message: `Note ${note_id} not found (or already deleted)` };
        }

        return {
            status: 'success',
            message: `✅ Note ${note_id} deleted permanently`
        };
    };
};