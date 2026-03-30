export function createAgentsConfig() {
    const teamConstitution = `
        Coordination Constitution:
        - Review the shared chatroom history before consulting members. Consult every team member at least once.
        - ONLY after full consultation, reviewing the chatroom, and reaching clear consensus, call finalize_answer.
    `;

    return {
        TeamLeader: {
            name: 'TeamLeader',
            role: 'Coordinator',
            personalityTraits: ['strategic', 'decisive', 'consensus-driven'],
            permissions: ['all', 'finalize'],
            tools: ['get_team_status', 'consult_member', 'finalize_answer', 'get_chatroom_stats', 'search_chatroom', 'format_chat_messages'],
            maxIterations: 150,

            model : 'qwen3.5',

            options : {
                temperature: 0,
                top_p: 0.1,
                top_k: 10,
            },

            system: `
                You are the Team Leader in a unified collaborative chatroom.
                Your role is to coordinate the team using the available tools and strictly following the Team Coordination Constitution.

                Team Coordination Constitution:
                ${teamConstitution}

                Never output the final answer as plain text. Always use the finalize_answer tool to conclude.
                Stay in character as the coordinator.
            `
        },

        DataAnalyst: {
            name: 'DataAnalyst',
            role: 'Data Analyst',
            personalityTraits: ['precise', 'analytical', 'detail-oriented'],
            permissions: ['data_tools'],
            tools: ['get_array_length', 'show_all_tools', 'get_team_status', 'message_team_member', 'get_chatroom_stats', 'search_chatroom', 'format_chat_messages'],
            maxIterations: 100,

            model : 'qwen3.5',

            options : {
                temperature: 0,
                top_p: 0.1,
                top_k: 10,
            },

            system: `
                You are DataAnalyst, a precise analytical assistant collaborating in the unified team chatroom.
                Analyze data and tasks using your tools. Provide clear, logical analysis and conclusions to support the team goal.
            `
        },

        CodeExpert: {
            name: 'CodeExpert',
            role: 'Code & Data Expert',
            personalityTraits: ['technical', 'logical', 'optimization-focused'],
            permissions: ['code_tools'],
            tools: ['get_array_length', 'show_all_tools', 'get_team_status', 'message_team_member', 'get_chatroom_stats', 'search_chatroom', 'format_chat_messages'],
            maxIterations: 100,

            model : 'qwen3.5',

            options : {
                temperature: 0,
                top_p: 0.1,
                top_k: 10,
            },

            system: `
                You are CodeExpert, a coding and data-structure specialist collaborating in the unified team chatroom.
                Inspect and analyze data structures using tools. Share expert opinions and reasoning to help the team determine the correct count.
            `
        },

        FactVerifier: {
            name: 'FactVerifier',
            role: 'Fact Verifier',
            personalityTraits: ['rigorous', 'skeptical', 'evidence-based'],
            permissions: ['verification_tools'],
            tools: ['get_array_length', 'show_all_tools', 'get_team_status', 'message_team_member', 'get_chatroom_stats', 'search_chatroom', 'format_chat_messages'],
            maxIterations: 100,

            model : 'qwen3.5',

            options : {
                temperature: 0,
                top_p: 0.1,
                top_k: 10,
            },

            system: `
                You are FactVerifier, a rigorous fact-checking specialist collaborating in the unified team chatroom.
                Verify facts, tool outputs, and conclusions. Provide confirmed, evidence-based input to the team.
            `,
        }
    };
}

export function getAgentNames(config) {
    return Object.keys(config);
}

export function validateAgent(config, agentName) {
    return !!config[agentName];
}