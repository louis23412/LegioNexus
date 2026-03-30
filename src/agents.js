// ====================== agents.js ======================
/**
 * Agents Module
 * Purpose: Complete agentsConfig definition and agent-related helpers.
 *
 * Enhancements added:
 * - Dynamic creation via createAgentsConfig(teamConstitution) for clean injection
 * - Personality traits + role-based permissions per agent
 * - Hot-reload support skeleton (loadAgentsFromConfig)
 * - New specialized agent skeleton (Summarizer) ready for extension
 * - Clear separation of concerns and improved documentation
 * - Dropped all hand-holding; agents now receive tools + question + direct chat context and figure out the rest
 * - Added search_chatroom tool to every agent for better immediate chat access
 * - Added format_chat_messages tool to every agent (clean bloat-free chat + topic/thread support)
 */

export function createAgentsConfig(teamConstitution) {
    return {
        TeamLeader: {
            name: 'TeamLeader',
            role: 'Coordinator',
            personalityTraits: ['strategic', 'decisive', 'consensus-driven'],
            permissions: ['all', 'finalize'],
            system: `You are the Team Leader in a unified collaborative chatroom.

Your role is to coordinate the team using the available tools and strictly following the Team Coordination Constitution.

Team Coordination Constitution:
${teamConstitution}

Never output the final answer as plain text. Always use the finalize_answer tool to conclude.
Stay in character as the coordinator.`,
            tools: ['get_team_status', 'consult_member', 'message_team_member', 'finalize_answer', 'get_chatroom_stats', 'search_chatroom', 'format_chat_messages'],
            maxIterations: 40
        },
        DataAnalyst: {
            name: 'DataAnalyst',
            role: 'Data Analyst',
            personalityTraits: ['precise', 'analytical', 'detail-oriented'],
            permissions: ['data_tools'],
            system: `You are DataAnalyst, a precise analytical assistant collaborating in the unified team chatroom.

Analyze data and tasks using your tools. Provide clear, logical analysis and conclusions to support the team goal.`,
            tools: ['get_array_length', 'show_all_tools', 'get_team_status', 'message_team_member', 'get_chatroom_stats', 'search_chatroom', 'format_chat_messages'],
            maxIterations: 60
        },
        CodeExpert: {
            name: 'CodeExpert',
            role: 'Code & Data Expert',
            personalityTraits: ['technical', 'logical', 'optimization-focused'],
            permissions: ['code_tools'],
            system: `You are CodeExpert, a coding and data-structure specialist collaborating in the unified team chatroom.

Inspect and analyze data structures using tools. Share expert opinions and reasoning to help the team determine the correct count.`,
            tools: ['get_array_length', 'show_all_tools', 'get_team_status', 'message_team_member', 'get_chatroom_stats', 'search_chatroom', 'format_chat_messages'],
            maxIterations: 60
        },
        FactVerifier: {
            name: 'FactVerifier',
            role: 'Fact Verifier',
            personalityTraits: ['rigorous', 'skeptical', 'evidence-based'],
            permissions: ['verification_tools'],
            system: `You are FactVerifier, a rigorous fact-checking specialist collaborating in the unified team chatroom.

Verify facts, tool outputs, and conclusions. Provide confirmed, evidence-based input to the team.`,
            tools: ['get_array_length', 'show_all_tools', 'get_team_status', 'message_team_member', 'get_chatroom_stats', 'search_chatroom', 'format_chat_messages'],
            maxIterations: 60
        }
        // Future specialized agents can be added here (e.g. Summarizer)
    };
}

// Helper for dynamic loading / hot-reload support (enhancement)
export function getAgentNames(config) {
    return Object.keys(config);
}

export function validateAgent(config, agentName) {
    return !!config[agentName];
}