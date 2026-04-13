export const definition = {
    type: 'function',
    function: {
        name: 'send_chat_message',
        description: 'Send a message to the shared team chatroom.',
        parameters: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'The message to post in the chat room. Keep your message short and direct to the point. Max 250 character length.'
                }
            },
            required: ['content'],
            additionalProperties: false
        },
        version: '1.0'
    }
};

export const createHandler = () => {
    return async (args, context = {}) => {
        const { chatroom, agentName } = context;

        const { content } = args || {};

        if (content.length < 2 || content.length > 250) {
            return {
                status : 'failure',
                error : `Incorrect message length. Min: 2 - Max: 250 - Received: ${content.length}`
            }
        }
        
        const messageId = chatroom.sendMessage(agentName, content);

        return {
            status: 'success',
            messageId
        };
    };
};