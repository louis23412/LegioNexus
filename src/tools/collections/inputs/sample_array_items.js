export const definition = {
    type: 'function',
    function: {
        name: 'sample_array_items',
        description: 'Returns a random sample item/entry from any registered data structure (array, Set, Map, or object). Great for inspecting contents without loading everything.',
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

        let sample;
        if (entry.type === 'array') {
            sample = entry.value[Math.floor(Math.random() * entry.value.length)];
        } else if (entry.type === 'set') {
            const arr = Array.from(entry.value);
            sample = arr[Math.floor(Math.random() * arr.length)];
        } else if (entry.type === 'map') {
            const arr = Array.from(entry.value.entries());
            sample = arr[Math.floor(Math.random() * arr.length)];
        } else if (entry.type === 'object') {
            const keys = Object.keys(entry.value);
            const key = keys[Math.floor(Math.random() * keys.length)];
            sample = { key, value: entry.value[key] };
        } else {
            sample = entry.value;
        }

        return {
            status: 'success',
            data: { data_name, type: entry.type, sample },
            message: `Random sample from ${data_name} (${entry.type}) collected successfully`
        };
    };
};