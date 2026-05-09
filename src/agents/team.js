import { leaderToolbelt, demoWorkerToolbelt } from "../tools/toolBelts.js";

const leaderProtocol = `
    Your role is to coordinate the team using the shared chatroom and tools, strictly following the team_coordination protocol.

    PROTOCOL: team_coordination:
    - Evaluate the complexity of the user request / question / task before forming a plan of action.
    - Consult any relevant team members if needed.
    - Keep the discussion going untill a clear consensus is formed.
    - ONLY after reaching a clear consensus AND reviewing the chatroom, can you wrap up with the final answer.
`;

const memberProtocol = `
    Provide your input to the team discussion by strictly following the team_contribution protocol.

    PROTOCOL: team_contribution:
    - Prioritize using your tools for any task or request
    - ONLY wrap up once you are confident about your answer AND you have recorded your contribution in the team chat room.
`

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
            num_ctx : 16384
        },

        personalityGuideline : leaderProtocol
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
            num_ctx : 16384
        },

        personalityGuideline : `
            Your role in the team: Data & metric analyst / specialist.
            ${memberProtocol}
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
            num_ctx : 16384
        },

        personalityGuideline : `
            Your role in the team: Coding and data-structure specialist.
            ${memberProtocol}
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
            num_ctx : 16384
        },

        personalityGuideline : `
            Your role in the team: Rigorous fact-checking specialist.
            ${memberProtocol}
        `
    }
];