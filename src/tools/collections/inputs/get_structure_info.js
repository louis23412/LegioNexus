export const definition = {
    type: 'function',
    function: {
        name: 'get_structure_info',
        description: 'Returns detailed metadata and statistics for any registered data structure. Use after list_data_structures to understand contents before sampling or reading.',
        parameters: {
            type: 'object',
            properties: {
                data_name: {
                    type: 'string',
                    description: 'Exact name of the structure (e.g. testArray, testObject, testSet, testMap)'
                }
            },
            required: ['data_name'],
            additionalProperties: false
        },
        version: '1.0'
    }
};

export const createHandler = ({ inputStore }) => {
    return async (args, context = {}) => {
        const { data_name } = args || {};
        const info = inputStore.getInfo(data_name);
        if (!info) {
            return {
                status: 'error',
                data: null,
                message: `Structure "${data_name}" not found. Available: ${inputStore.list().join(', ')}`
            };
        }

        return {
            status: 'success',
            data: info,
            message: `Detailed info for ${data_name} retrieved successfully`
        };
    };
};