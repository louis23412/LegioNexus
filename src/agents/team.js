const toolBelts = {
    leader_only_tools : [
        'consult_member',

        'finalize_answer'
    ],

    worker_only_tools : [
        'message_team_member',
        
        'list_data_structures',
        'get_structure_info',

        'get_array_length',
        'sample_array_items',

        'get_object_property',
        'check_set_contains',
        'get_map_value'
    ],

    notes_tools : [
        'create_note',
        'delete_note',
        'list_my_notes',
        'get_my_note'
    ],

    all_access_tools : [
        'get_team_status',

        'show_all_tools',

        'get_chatroom_stats',
        'search_chatroom',
        'format_chat_messages'
    ]
}

export const memberDefinitions = [
    {
        name : 'team-leader',
        isLeader : true,

        toolAccess : [
            toolBelts.leader_only_tools,
            toolBelts.all_access_tools,
            toolBelts.notes_tools
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
        isLeader : false,

        toolAccess : [
            toolBelts.worker_only_tools,
            toolBelts.all_access_tools,
            toolBelts.notes_tools
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
        isLeader : false,

        toolAccess : [
            toolBelts.worker_only_tools,
            toolBelts.all_access_tools,
            toolBelts.notes_tools
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
        isLeader : false,

        toolAccess : [
            toolBelts.worker_only_tools,
            toolBelts.all_access_tools,
            toolBelts.notes_tools
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