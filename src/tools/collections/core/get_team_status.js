export const definition = {
    type: 'function',
    function: {
        name: 'get_team_status',
        description: 'See who has been consulted, current chatroom history (or compressed summary), and team consensus status. Use get_team_status with use_summary=true to avoid context bloat with long histories. Now supports topic filtering.',
        parameters: {
            type: 'object',
            properties: {
                use_summary: { type: 'boolean', description: 'true to get a compressed summary instead of full history (recommended when >20 messages)' },
                your_name: {type: 'string', description: 'your assigned name'},
                topic: { type: 'string', description: 'Optional: filter status and history to a specific topic/thread' }
            },
            required: ['your_name'],
            additionalProperties: false
        },
        version: '1.3'
    }
};

export const createHandler = ({ agentsConfig }) => {
    return async (args, context = {}) => {
        const { use_summary = false, your_name = null, topic = null } = args || {};
        const summary = context.chatroom.getStatusSummary(topic);

        const history = use_summary
            ? context.chatroom.getCompressedSummary(topic)
            : context.chatroom.getFormattedChatMessages(topic);

        const team_members = Object.keys(agentsConfig);
        team_members.forEach((v, i) => {
            if (v === your_name) team_members[i] = `${v}(you)`;
        });

        return {
            status: 'success',
            data: {
                team_members,
                consulted_members: summary.consultedMembers,
                total_messages: summary.totalMessages,
                history: history,
                recent_activity: summary.recentActivity,
                consensus: 'Pending – leader will determine after full consultation',
                is_summary: use_summary,
                topic: summary.topic || null
            },
            message: `Team status retrieved successfully (${use_summary ? 'compressed summary' : 'clean formatted history'}${topic ? ` for topic "${topic}"` : ''})`
        };
    };
};