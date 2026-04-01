export const definition = {
    type: 'function',
    function: {
        name: 'list_data_structures',
        description: 'Returns the complete list of all registered data structures in the InputStore, including type, size/length, and description. Use this first to discover what data is available.',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        version: '1.0'
    }
};

export const createHandler = ({ inputStore }) => {
    return async (args, context = {}) => {
        const structures = inputStore.list();
        const details = structures.map(name => {
            const info = inputStore.getInfo(name);
            return {
                name,
                type: info.type,
                size: info.length ?? info.size ?? info.keyCount ?? 0,
                description: info.metadata?.description || 'No description'
            };
        });

        return {
            status: 'success',
            data: {
                total_structures: structures.length,
                structures: details
            },
            message: `Listed ${structures.length} data structures successfully`
        };
    };
};