export const definition = {
    type: 'function',
    function: {
        name: 'get_array_length',
        description: 'Returns the exact number of items in the test array. Use this instead of trying to count manually or guessing.',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        version: '1.1'
    }
};

export const createHandler = ({ dataObj }) => {
    return async (args, context = {}) => {
        return {
            status: 'success',
            data: { count: dataObj.testArr.length },
            message: `Array length retrieved successfully: ${dataObj.testArr.length} items.`
        };
    };
};