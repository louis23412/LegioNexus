export const definition = {
    type: 'function',
    function: {
        name: 'show_all_tools',
        description: 'Returns a complete list of all available tools with their names and descriptions.',
        parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
        version: '1.0'
    }
};

export const createHandler = ({ toolRegistry, agentsConfig }) => {
    return async (args, context = {}) => {
        const agentName = context.agentName || 'unknown';
        const allowedToolNames = agentsConfig[agentName]?.tools || Object.keys(toolRegistry);

        const toolList = allowedToolNames
            .map(name => toolRegistry[name] ? {
                name,
                description: toolRegistry[name].definition.function.description,
                version: toolRegistry[name].version
            } : null)
            .filter(Boolean);

        return {
            status: 'success',
            data: { tools: toolList, count: toolList.length },
            message: `You currently have ${toolList.length} working tool(s) available (only the tools you have access to).`
        };
    };
};