export const definition = {
    type: 'function',
    function: {
        name: 'get_map_value',
        description: 'Returns the value associated with a key in a registered Map structure (e.g. testMap).',
        parameters: {
            type: 'object',
            properties: {
                data_name: {
                    type: 'string',
                    description: 'Name of the Map structure (default: testMap)'
                },
                key: {
                    type: 'string',
                    description: 'Key to look up in the Map'
                }
            },
            required: ['key'],
            additionalProperties: false
        },
        version: '1.0'
    }
};

export const createHandler = ({ inputStore }) => {
    return async (args, context = {}) => {
        const { data_name = 'testMap', key } = args || {};
        const map = inputStore.get(data_name);
        if (!(map instanceof Map)) {
            return {
                status: 'error',
                data: null,
                message: `${data_name} is not a Map`
            };
        }

        const value = map.get(key);
        const exists = map.has(key);

        return {
            status: 'success',
            data: {
                data_name,
                key,
                value,
                exists,
                all_keys: Array.from(map.keys()),
                map_size: map.size
            },
            message: exists
                ? `Value for key "${key}" retrieved from ${data_name}`
                : `Key "${key}" does not exist in ${data_name}`
        };
    };
};