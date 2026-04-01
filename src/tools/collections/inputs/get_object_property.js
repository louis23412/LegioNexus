export const definition = {
    type: 'function',
    function: {
        name: 'get_object_property',
        description: 'Returns the value of a specific property/key from a registered object structure (e.g. testObject).',
        parameters: {
            type: 'object',
            properties: {
                data_name: {
                    type: 'string',
                    description: 'Name of the object structure (default: testObject)'
                },
                property: {
                    type: 'string',
                    description: 'Property name or key to retrieve'
                }
            },
            required: ['property'],
            additionalProperties: false
        },
        version: '1.0'
    }
};

export const createHandler = ({ inputStore }) => {
    return async (args, context = {}) => {
        const { data_name = 'testObject', property } = args || {};
        const obj = inputStore.get(data_name);
        if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
            return {
                status: 'error',
                data: null,
                message: `${data_name} is not an object`
            };
        }

        const value = obj[property];
        const exists = property in obj;

        return {
            status: 'success',
            data: {
                data_name,
                property,
                value,
                exists,
                all_keys: Object.keys(obj)
            },
            message: exists
                ? `Property "${property}" retrieved from ${data_name}`
                : `Property "${property}" does not exist in ${data_name}`
        };
    };
};