export const definition = {
    type: 'function',
    function: {
        name: 'view_team_members',
        description: 'Returns a list of all members in the team.',
        parameters: {
            type: 'object',
            properties: {},
            required: [],
            additionalProperties: false
        },
        version: '1.0'
    }
};

export const createHandler = ({ agentsConfig }) => {
    return async (args, context = {}) => {
        const caller = context.agentName || 'unknown';

        const memberLines = Object.keys(agentsConfig)
            .map(name => {
                return name === caller 
                    ? `${name} (you)` 
                    : name;
            })
            .join('\n');

        const cleanList = `TEAM MEMBERS\n${'─'.repeat(20)}\n${memberLines}`;

        return {
            status: 'success',
            data: {
                members: Object.keys(agentsConfig),
                total: Object.keys(agentsConfig).length,
                you: caller
            },
            message: cleanList
        };
    };
};