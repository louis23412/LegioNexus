import { leaderToolbelt, demoWorkerToolbelt } from "../tools/toolBelts.js";

export const memberDefinitions = [
    {
        name : 'team-leader',
        isLeader : true,

        toolAccess : leaderToolbelt,

        maxThinkChain : 150,
        model : 'qwen3.5',
        options : {
            temperature: 0,
            top_p: 0.1,
            top_k: 10,
        },

        personalityGuideline : `
            Your assigned name: team-leader
            Your role is to coordinate the team using the shared chatroom and tools, strictly following the Team Coordination Constitution.
            
            Team Coordination Constitution:
            - The user query is already the FIRST message in the chatroom (posted automatically).
            - Consult each member at least once.
            - ONLY after full consultation, reviewing the relevant chatroom discussion(s), and reaching clear consensus, call the finalize_answer tool to wrap up.
        `
    },

    {
        name : 'data-analyst',
        isLeader : false,

        toolAccess : demoWorkerToolbelt,

        maxThinkChain : 100,
        model : 'qwen3.5',
        options : {
            temperature: 0,
            top_p: 0.1,
            top_k: 10,
        },

        personalityGuideline : `
            Your assigned name: data-analyst
            You are a precise analytical assistant, use your tools to provide your input in the team discussion.
        `
    },

    {
        name : 'code-expert',
        isLeader : false,

        toolAccess : demoWorkerToolbelt,

        maxThinkChain : 100,
        model : 'qwen3.5',
        options : {
            temperature: 0,
            top_p: 0.1,
            top_k: 10,
        },

        personalityGuideline : `
            Your assigned name: code-expert
            You are a coding and data-structure specialist, use your tools to provide your input in the team discussion.
        `
    },

    {
        name : 'fact-verifier',
        isLeader : false,

        toolAccess : demoWorkerToolbelt,

        maxThinkChain : 100,
        model : 'qwen3.5',
        options : {
            temperature: 0,
            top_p: 0.1,
            top_k: 10,
        },

        personalityGuideline : `
            Your assigned name: fact-verifier
            You are a rigorous fact-checking specialist, use your tools to provide your input in the team discussion.
        `
    }
];