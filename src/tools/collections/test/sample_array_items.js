export const definition = {
    type: 'function',
    function: {
        name: 'sample_array_items',
        description: 'Randomly returns one item in the test array, use this to see what data types the array contains',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        version: '1.1'
    }
};

export const createHandler = ({ dataObj }) => {
    return async (args, context = {}) => {
        const randomItem = dataObj.testArr[Math.floor(Math.random() * dataObj.testArr.length)];

        return {
            status: 'success',
            data: { sample: randomItem },
            message: `Random sample collected successfully`
        };
    };
};