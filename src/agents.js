const toolBelts = {
    leader_only_tools : [
        'consult_member',

        'finalize_answer'
    ],

    worker_only_tools : [
        'message_team_member',
    ],

    all_access_tools : [
        'get_team_status',

        'show_all_tools',

        'get_chatroom_stats',
        'search_chatroom',
        'format_chat_messages'
    ],

    test_tools : [
        'get_array_length',
        'sample_array_items'
    ]
}

const memberDefinitions = [
    {
        name : 'team-leader',
        toolAccess : [
            toolBelts.leader_only_tools,
            toolBelts.all_access_tools
        ],

        maxThinkChain : 150,
        model : 'qwen3.5',
        options : {
            temperature: 0,
            top_p: 0.1,
            top_k: 10,
        },

        personalityGuideline : `
            Your assigned name: team-leader
            Your role is to coordinate the team using the available tools and strictly following the Team Coordination Constitution.

            Team Coordination Constitution:
            - Review the shared chatroom history before consulting members. Consult every team member at least once.
            - ONLY after full consultation, reviewing the chatroom, and reaching clear consensus, call finalize_answer.

            Never output the final answer as plain text. Always use the finalize_answer tool to conclude.
            Stay in character as the coordinator.
        `
    },

    {
        name : 'data-analyst',
        toolAccess : [
            toolBelts.worker_only_tools,
            toolBelts.all_access_tools,
            toolBelts.test_tools
        ],

        maxThinkChain : 100,
        model : 'qwen3.5',
        options : {
            temperature: 0,
            top_p: 0.1,
            top_k: 10,
        },

        personalityGuideline : `
            Your assigned name: data-analyst
            You are a precise analytical assistant collaborating in the unified team chatroom.
            Analyze data and tasks using your tools. Provide clear, logical analysis and conclusions to support the team goal.
        `
    },

    {
        name : 'code-expert',
        toolAccess : [
            toolBelts.worker_only_tools,
            toolBelts.all_access_tools,
            toolBelts.test_tools
        ],

        maxThinkChain : 100,
        model : 'qwen3.5',
        options : {
            temperature: 0,
            top_p: 0.1,
            top_k: 10,
        },

        personalityGuideline : `
            Your assigned name: code-expert
            You are a coding and data-structure specialist collaborating in the unified team chatroom.
            Inspect and analyze data structures using tools. Share expert opinions and reasoning to help the team determine the correct count.
        `
    },

    {
        name : 'fact-verifier',
        toolAccess : [
            toolBelts.worker_only_tools,
            toolBelts.all_access_tools,
            toolBelts.test_tools
        ],

        maxThinkChain : 100,
        model : 'qwen3.5',
        options : {
            temperature: 0,
            top_p: 0.1,
            top_k: 10,
        },

        personalityGuideline : `
            Your assigned name: fact-verifier
            You are a rigorous fact-checking specialist collaborating in the unified team chatroom.
            Verify facts, tool outputs, and conclusions. Provide confirmed, evidence-based input to the team.
        `
    }
];

const cleanToolList = (list) => {
    return (list.flat()).sort((a, b) => a.localeCompare(b));
}

export function createAgentsConfig() {
    const memberObj = {};

    for (const member of memberDefinitions) {
        memberObj[member.name] = {
            name : member.name,
            tools : cleanToolList(member.toolAccess),

            maxIterations : member.maxThinkChain,
            model : member.model,
            options : member.options,
            system : member.personalityGuideline.trim()
        }
    }

    return memberObj;
}

export function getAgentNames(config) {
    return Object.keys(config);
}

export function validateAgent(config, agentName) {
    return !!config[agentName];
}