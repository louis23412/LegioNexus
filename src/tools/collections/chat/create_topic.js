export const definition = {
    type: 'function',
    function: {
        name: 'create_topic',
        description: 'Create a new discussion topic/thread in the chatroom and post an initial message.',
        parameters: {
            type: 'object',
            properties: {
                topic_name: { type: 'string', description: 'Name of the new topic' },
                initial_message: { type: 'string', description: 'Optional first message to post in the new topic' }
            },
            required: ['topic_name'],
            additionalProperties: false
        },
        version: '2.0'
    }
};

export const createHandler = () => {
    return async (args, context = {}) => {
        const { chatroom, agentName } = context;
        if (!chatroom) return { status: 'error', message: 'Chatroom unavailable' };

        const { topic_name, initial_message } = args || {};

        if (!chatroom.topics.has(topic_name)) {
            chatroom.topics.add(topic_name);
        }

        if (initial_message) {
            chatroom.sendMessage(agentName, initial_message, { topic: topic_name });
        } else {
            chatroom.sendMessage('system', `📌 New topic started: ${topic_name}`, { topic: topic_name });
        }

        return {
            status: 'success',
            data: { topic: topic_name },
            message: `✅ New topic "${topic_name}" created and chatroom switched`
        };
    };
};