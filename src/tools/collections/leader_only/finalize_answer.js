export const definition = {
    type: 'function',
    function: {
        name: 'finalize_answer',
        description: 'Use this ONLY when ALL members have been consulted and consensus is reached. This ends the collaboration.',
        parameters: {
            type: 'object',
            properties: {
                final_answer: { type: 'string', description: 'The final agreed answer to the user query' },
                consensus_explanation: { type: 'string', description: 'Brief explanation of how consensus was reached (reference each member)' }
            },
            required: ['final_answer', 'consensus_explanation'],
            additionalProperties: false
        },
        version: '1.0'
    }
};

export const createHandler = () => {
    return async (args, context = {}) => {
        return {
            status: 'success',
            data: {
                finalized: true,
                final_answer: args.final_answer,
                consensus_explanation: args.consensus_explanation
            },
            message: 'Final answer tool called successfully'
        };
    };
};