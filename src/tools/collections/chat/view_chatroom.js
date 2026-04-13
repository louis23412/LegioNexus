export const definition = {
    type: 'function',
    function: {
        name: 'view_chatroom',
        description: 'View the current messages in the team group chatroom',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false
        },
        version: '1.0'
    }
};

export const createHandler = () => {
    return async (_, context = {}) => {
        const { chatroom } = context;

        const messages = chatroom.viewMessages();

        if (messages.length > 0) {
            return {
                total_messages: messages.length,
                messages: messages.map((m) => {
                    const messageDate = new Date(m.timestamp);

                    const formattedTime = `${messageDate.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric'
                    })} ${messageDate.toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    })}`;

                    return `[MSG_${m.id} - ${formattedTime} => @${m.speaker} : ${m.content}]`;
                }).join('')
            };
        }

        return { total_messages: 0, messages: null };
    };
};