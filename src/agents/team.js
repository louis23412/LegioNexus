import { leaderToolbelt, demoWorkerToolbelt } from "../tools/toolBelts.js";

export const memberDefinitions = [
    {
        name : 'team-leader',
        isLeader : true,

        toolAccess : leaderToolbelt,

        maxThinkChain : 150,
        model : 'qwen3.5',
        options : {
            temperature: 1,
            presence_penalty : 1.5,
            top_p: 0.95,
            top_k: 20,
        },

        personalityGuideline : `
            /strict_protocol /tool_priority /team_collaboration

            Your assigned name: team-leader
            Your role is to coordinate the team using the shared chatroom and tools, strictly following the team_coordination protocol.
            
            PROTOCOL: team_coordination:
            - Consult any relevant team members.
            - Keep the discussion going untill a clear consensus is formed.
            - ONLY after reaching a clear consensus AND reviewing the chatroom, can you wrap up with the final answer.

            /strict_protocol /tool_priority /team_collaboration
        `
    },

    {
        name : 'data-analyst',
        isLeader : false,

        toolAccess : demoWorkerToolbelt,

        maxThinkChain : 100,
        model : 'qwen3.5',
        options : {
            temperature: 1,
            presence_penalty : 1.5,
            top_p: 0.95,
            top_k: 20,
        },

        personalityGuideline : `
            /strict_protocol /tool_priority /team_collaboration

            Your assigned name: data-analyst
            Your role in the team: Provide accurate and meaningful insights and analysis.
            Provide your input to the team discussion by strictly following the team_contribution protocol.

            PROTOCOL: team_contribution:
            - Prioritize using your tools for any task or request
            - ONLY wrap up once you are confident about your answer AND you have recorded your contribution in the team chat room.

            /strict_protocol /tool_priority /team_collaboration
        `
    },

    {
        name : 'code-expert',
        isLeader : false,

        toolAccess : demoWorkerToolbelt,

        maxThinkChain : 100,
        model : 'qwen3.5',
        options : {
            temperature: 1,
            presence_penalty : 1.5,
            top_p: 0.95,
            top_k: 20,
        },

        personalityGuideline : `
            /strict_protocol /tool_priority /team_collaboration

            Your assigned name: code-expert
            Your role in the team: You are a coding and data-structure specialist.
            Provide your input to the team discussion by strictly following the team_contribution protocol.

            PROTOCOL: team_contribution:
            - Prioritize using your tools for any task or request
            - ONLY wrap up once you are confident about your answer AND you have recorded your contribution in the team chat room.

            /strict_protocol /tool_priority /team_collaboration
        `
    },

    {
        name : 'fact-verifier',
        isLeader : false,

        toolAccess : demoWorkerToolbelt,

        maxThinkChain : 100,
        model : 'qwen3.5',
        options : {
            temperature: 1,
            presence_penalty : 1.5,
            top_p: 0.95,
            top_k: 20,
        },

        personalityGuideline : `
            /strict_protocol /tool_priority /team_collaboration

            Your assigned name: fact-verifier
            Your role in the team: You are a rigorous fact-checking specialist.
            Provide your input to the team discussion by strictly following the team_contribution protocol.

            PROTOCOL: team_contribution:
            - Prioritize using your tools for any task or request
            - ONLY wrap up once you are confident about your answer AND you have recorded your contribution in the team chat room.

            /strict_protocol /tool_priority /team_collaboration
        `
    }
];