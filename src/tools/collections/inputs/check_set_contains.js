export const definition = {
    type: 'function',
    function: {
        name: 'check_set_contains',
        description: 'Checks whether a value exists in a registered Set structure (e.g. testSet). Returns boolean result.',
        parameters: {
            type: 'object',
            properties: {
                data_name: {
                    type: 'string',
                    description: 'Name of the Set structure (default: testSet)'
                },
                value: {
                    type: ['string', 'number', 'boolean'],
                    description: 'Value to check for membership'
                }
            },
            required: ['value'],
            additionalProperties: false
        },
        version: '1.0'
    }
};

export const createHandler = ({ inputStore }) => {
    return async (args, context = {}) => {
        const { data_name = 'testSet', value } = args || {};
        const set = inputStore.get(data_name);
        if (!(set instanceof Set)) {
            return {
                status: 'error',
                data: null,
                message: `${data_name} is not a Set`
            };
        }

        const contains = set.has(value);

        return {
            status: 'success',
            data: {
                data_name,
                value,
                contains,
                set_size: set.size,
                sample_values: Array.from(set).slice(0, 5)
            },
            message: `Membership check for value "${value}" in ${data_name}: ${contains}`
        };
    };
};