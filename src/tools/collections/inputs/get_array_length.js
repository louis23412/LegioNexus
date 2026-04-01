export const definition = {
    type: 'function',
    function: {
        name: 'get_array_length',
        description: 'Returns the exact length/size of any registered data structure (array, Set, Map, or object key count). Use data_name to target specific structures.',
        parameters: {
            type: 'object',
            properties: {
                data_name: {
                    type: 'string',
                    description: 'Name of the data structure (default: testArray)'
                }
            },
            required: [],
            additionalProperties: false
        },
        version: '2.0'
    }
};

export const createHandler = ({ inputStore }) => {  // ← inputStore
    return async (args, context = {}) => {
        const { data_name = 'testArray' } = args || {};
        const entry = inputStore.getEntry(data_name);
        if (!entry) {
            return {
                status: 'error',
                data: null,
                message: `Structure "${data_name}" not found. Available: ${inputStore.list().join(', ')}`
            };
        }

        let length = 0;
        if (entry.type === 'array') length = entry.value.length;
        else if (entry.type === 'set' || entry.type === 'map') length = entry.value.size;
        else if (entry.type === 'object') length = Object.keys(entry.value).length;
        else length = 0;

        return {
            status: 'success',
            data: { data_name, type: entry.type, length },
            message: `Length/size of ${data_name} (${entry.type}) retrieved: ${length}`
        };
    };
};