import ollama from 'ollama';

const model = 'qwen3.5';

const testArr = new Array(1234).fill(1);
const userPrompt = 'How many items are in the test array?';

const teamConstitution = `
    Coordination Constitution:
    - Always start by calling get_team_status (use use_summary=true when history grows to avoid context bloat).
    - Consult every team member at least once via consult_member (use exact names from get_team_status).
    - Use message_team_member for quick peer-to-peer side discussions (recipients auto-reply).
    - Review every response in tool results and the shared chatroom.
    - ONLY after consulting ALL members and reaching clear consensus, call finalize_answer.
`;

class Chatroom {
    constructor() {
        this.log = [];
    }

    add(speaker, content) {
        this.log.push({ speaker, content });
        return this;
    }

    getHistory() {
        if (this.log.length === 0) {
            return '=== TEAM CHATROOM HISTORY ===\n(No messages yet)\n=== END OF HISTORY ===\n\n';
        }

        const formatted = this.log
            .map(e => `[${e.speaker}]: ${e.content}`)
            .join('\n\n');

        return `=== TEAM CHATROOM HISTORY ===\n${formatted}\n\n=== END OF HISTORY ===\n\n`;
    }

    getCompressedSummary() {
        if (this.log.length === 0) {
            return '=== CHATROOM COMPRESSED SUMMARY ===\n(No messages yet)\n=== END COMPRESSED SUMMARY ===\n\n';
        }

        const summary = this.getStatusSummary();

        let compressed = `=== CHATROOM COMPRESSED SUMMARY ===\n`;
        compressed += `Total messages: ${summary.totalMessages}\n`;
        compressed += `Consulted members: ${summary.consultedMembers.join(', ')}\n\n`;
        compressed += `Recent activity:\n`;
        compressed += summary.recentActivity.join('\n') + '\n\n';
        compressed += `Note: Call get_team_status(use_summary=false) for full detailed history if critical.\n`;
        compressed += `=== END COMPRESSED SUMMARY ===\n\n`;

        return compressed;
    }

    clear() {
        this.log = [];
    }

    getStatusSummary() {
        const consulted = [...new Set(this.log.map(e => e.speaker))];
        return {
            totalMessages: this.log.length,
            consultedMembers: consulted,
            recentActivity: this.log.slice(-3).map(e => `${e.speaker}: ${e.content.substring(0, 80)}...`)
        };
    }
}

const chatroom = new Chatroom();

const toolRegistry = {
    get_array_length: {
        definition: {
            type: 'function',
            function: {
                name: 'get_array_length',
                description: 'Returns the exact number of items in the test array. Use this instead of trying to count manually or guessing.',
                parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }
            }
        },

        handler: async (args, context = {}) => {
            return {
                status: 'success',
                data: { count: testArr.length },
                message: `Array length retrieved successfully: ${testArr.length} items.`
            };
        }
    },

    show_all_tools: {
        definition: {
            type: 'function',
            function: {
                name: 'show_all_tools',
                description: 'Returns a complete list of all available tools with their names and descriptions.',
                parameters: { type: 'object', properties: {}, required: [], additionalProperties: false }
            }
        },

        handler: async (args, context = {}) => {
            const toolList = Object.keys(toolRegistry).map(name => ({
                name,
                description: toolRegistry[name].definition.function.description
            }));

            return {
                status: 'success',
                data: {
                    tools: toolList,
                    count: toolList.length
                },
                message: `You currently have ${toolList.length} working tool(s) available (dynamic registry).`
            };
        }
    },

    get_team_status: {
        definition: {
            type: 'function',
            function: {
                name: 'get_team_status',
                description: 'See who has been consulted, current chatroom history (or compressed summary), and team consensus status. Use get_team_status with use_summary=true to avoid context bloat with long histories.',
                parameters: {
                    type: 'object',
                    properties: {
                        use_summary: {
                            type: 'boolean',
                            description: 'true to get a compressed summary instead of full history (recommended when >20 messages)'
                        }
                    },
                    required: [],
                    additionalProperties: false
                }
            }
        },
        
        handler: async (args, context = {}) => {
            const { use_summary = false } = args || {};
            const summary = context.chatroom.getStatusSummary();
            const history = use_summary
                ? context.chatroom.getCompressedSummary()
                : context.chatroom.getHistory();

            return {
                status: 'success',
                data: {
                    team_members: Object.keys(agentsConfig),
                    consulted_members: summary.consultedMembers,
                    total_messages: summary.totalMessages,
                    history: history,
                    recent_activity: summary.recentActivity,
                    consensus: 'Pending – leader will determine after full consultation',
                    is_summary: use_summary
                },
                message: `Team status retrieved successfully (${use_summary ? 'compressed summary' : 'full history'})`
            };
        }
    },

    consult_member: {
        definition: {
            type: 'function',
            function: {
                name: 'consult_member',
                description: 'Use this tool ONLY to direct and consult a specific team member. Provide a clear query or task. Use get_team_status first to see exact available member names.',
                parameters: {
                    type: 'object',
                    properties: {
                        member_name: { type: 'string', description: 'Exact name from get_team_status (e.g. DataAnalyst, CodeExpert, FactVerifier)' },
                        query: { type: 'string', description: 'Specific instruction or question for the member' }
                    },
                    required: ['member_name', 'query'],
                    additionalProperties: false
                }
            }
        },

        handler: async (args, context = {}) => {
            const { member_name, query } = args || {};

            if (!member_name || !query) {
                return {
                    status: 'error',
                    data: null,
                    message: 'Invalid arguments: member_name and query are required.'
                };
            }

            const memberConfig = agentsConfig[member_name];
            if (!memberConfig) {
                return {
                    status: 'error',
                    data: null,
                    message: `Unknown member: ${member_name}. Use get_team_status to see available members.`
                };
            }

            console.log(`\n🔍 [CONSULT ${context.agentName || 'TeamLeader'} → ${member_name}]`);
            console.log('─'.repeat(90));
            console.log(`\x1b[33m ${query} \x1b[0m`);
            console.log('─'.repeat(90));

            const memberInitialMessages = [
                { role: 'system', content: memberConfig.system },
                {
                    role: 'user',
                    content: `The current team chatroom history and status is available via the get_team_status tool. Call it first if you need context (recommend use_summary=true for long histories).\n\nYou have been consulted by the Team Leader.\n\nTask assigned by the Team Leader:\n${query}\n\nRespond inside the unified team chatroom. Use tools if needed. End with your clear conclusion.`
                }
            ];

            let memberResult;
            try {
                memberResult = await runAgent(
                    member_name,
                    memberInitialMessages,
                    getToolsForAgent(member_name),
                    memberConfig.maxIterations
                );
            } catch (err) {
                console.error(`❌ [CONSULT ERROR] ${member_name}:`, err.message);
                const failureMsg = `[MEMBER CRASHED] ${err.message}`;
                context.chatroom.add(member_name, failureMsg);
                return {
                    status: 'error',
                    data: null,
                    message: `Member ${member_name} crashed during consultation: ${err.message}`,
                    consulted_member: member_name
                };
            }

            let memberResponseContent = memberResult.content || '[No response provided]';
            const isFailure = memberResponseContent.includes('Max iterations reached');

            if (isFailure) {
                memberResponseContent = `[MEMBER FAILURE] ${memberResponseContent}`;
                console.log(`⚠️ [CONSULT] ${member_name} failed or reached max iterations`);
            }

            // Add to shared chatroom (even failures for transparency)
            context.chatroom.add(member_name, memberResponseContent);

            return {
                status: isFailure ? 'member_failed' : 'success',
                data: {
                    consulted_member: member_name,
                    query_received: query,
                    member_response: memberResponseContent
                },
                message: isFailure ? 'Member consultation completed with failure signal' : 'consulted successfully'
            };
        }
    },

    finalize_answer: {
        definition: {
            type: 'function',
            function: {
                name: 'finalize_answer',
                description: 'Use this ONLY when ALL members have been consulted and consensus is reached. This ends the collaboration.',
                parameters: {
                    type: 'object',
                    properties: {
                        final_answer: { type: 'string', description: 'The final agreed answer to the user query' },
                        consensus_explanation: { type: 'string', description: 'Brief explanation of how consensus was reached (reference each member)' }
                    },
                    required: ['final_answer', 'consensus_explanation'],
                    additionalProperties: false
                }
            }
        },

        handler: async (args, context = {}) => {
            return {
                status: 'success',
                data: {
                    finalized: true,
                    final_answer: args.final_answer,
                    consensus_explanation: args.consensus_explanation
                },
                message: 'Final answer tool called successfully'
            };
        }
    },

    message_team_member: {
        definition: {
            type: 'function',
            function: {
                name: 'message_team_member',
                description: 'Send a direct message to any other team member for peer-to-peer collaboration. The recipient will AUTOMATICALLY respond in the shared chatroom. Use this for quick side discussions.',
                parameters: {
                    type: 'object',
                    properties: {
                        member_name: { type: 'string', description: 'Exact name from get_team_status (anyone except yourself)' },
                        message: { type: 'string', description: 'Your message or question' }
                    },
                    required: ['member_name', 'message'],
                    additionalProperties: false
                }
            }
        },

        handler: async (args, context = {}) => {
            const { member_name, message } = args || {};
            if (!member_name || !message) {
                return {
                status: 'error',
                data: null,
                message: 'Invalid arguments: member_name and message are required.'
                };
            }

            if (!agentsConfig[member_name]) {
                return {
                status: 'error',
                data: null,
                message: `Unknown member: ${member_name}. Use get_team_status.`
                };
            }

            if (member_name === context.agentName) {
                return {
                status: 'error',
                data: null,
                message: 'Cannot message yourself.'
                };
            }

            console.log(`\n📨 [P2P] ${context.agentName} → ${member_name}: "${message}"`);

            const sentEntry = `📨 Direct P2P message from ${context.agentName} to ${member_name}: ${message}`;
            context.chatroom.add(context.agentName, sentEntry);

            const recipientConfig = agentsConfig[member_name];

            const recipientInitialMessages = [
                { role: 'system', content: recipientConfig.system },
                {
                role: 'user',
                content: `The current team chatroom history and status is available via the get_team_status tool. Call it first if you need context (recommend use_summary=true for long histories).\n\nYou have received a DIRECT peer-to-peer message from ${context.agentName}.\n\nMessage:\n${message}\n\nRespond directly and helpfully to this message in the unified team chatroom. Use tools if needed. Keep your reply concise and relevant to the team goal.`
                }
            ];

            console.log(`\n🔄 [P2P AUTO-RESPONSE] Triggering ${member_name} to reply...`);

            let recipientResult;
            try {
                recipientResult = await runAgent(
                member_name,
                recipientInitialMessages,
                getToolsForAgent(member_name),
                recipientConfig.maxIterations
                );
            } catch (err) {
                console.error(`❌ [P2P ERROR] ${member_name}:`, err.message);
                const failureReply = `[P2P RECIPIENT CRASHED] ${err.message}`;
                const replyEntry = `📨 Direct P2P reply from ${member_name} to ${context.agentName}: ${failureReply}`;
                context.chatroom.add(member_name, replyEntry);
                return {
                status: 'error',
                data: null,
                message: `Message sent but recipient ${member_name} crashed: ${err.message}`,
                message_sent_to: member_name,
                recipient_response: failureReply
                };
            }

            let replyContent = recipientResult.content || '[No reply]';
            const isFailure = replyContent.includes('Max iterations reached');

            if (isFailure) {
                replyContent = `[P2P FAILURE] ${replyContent}`;
                console.log(`⚠️ [P2P] ${member_name} failed to reply properly`);
            }

            // Record recipient's automatic reply
            const replyEntry = `📨 Direct P2P reply from ${member_name} to ${context.agentName}: ${replyContent}`;
            context.chatroom.add(member_name, replyEntry);

            console.log(`✅ [CHATROOM] ${member_name} auto-replied and added to shared memory`);

            return {
                status: isFailure ? 'recipient_failed' : 'success',
                data: {
                message_sent_to: member_name,
                message_content: message,
                recipient_response: replyContent
                },
                message: isFailure
                ? 'Message delivered but recipient failed to reply properly'
                : 'Message delivered and recipient has automatically replied in the chatroom',
                note: 'Both message and reply are now visible to everyone via get_team_status'
            };
        }
    }
};

const agentsConfig = {
  TeamLeader: {
    name: 'TeamLeader',
    system: `You are the Team Leader in a unified collaborative chatroom.

Your role is to coordinate the team using the available tools and strictly following the Team Coordination Constitution.

Team Coordination Constitution:
${teamConstitution}

Never output the final answer as plain text. Always use the finalize_answer tool to conclude.
Stay in character as the coordinator.`,
    tools: ['get_team_status', 'consult_member', 'message_team_member', 'finalize_answer'],
    maxIterations: 40
  },
  DataAnalyst: {
    name: 'DataAnalyst',
    system: `You are DataAnalyst, a precise analytical assistant collaborating in the unified team chatroom.

Analyze data and tasks using your tools. Provide clear, logical analysis and conclusions to support the team goal. Call get_team_status when you need current context or history.`,
    tools: ['get_array_length', 'show_all_tools', 'get_team_status', 'message_team_member'],
    maxIterations: 60
  },
  CodeExpert: {
    name: 'CodeExpert',
    system: `You are CodeExpert, a coding and data-structure specialist collaborating in the unified team chatroom.

Inspect and analyze data structures using tools. Share expert opinions and reasoning to help the team determine the correct count.`,
    tools: ['get_array_length', 'show_all_tools', 'get_team_status', 'message_team_member'],
    maxIterations: 60
  },
  FactVerifier: {
    name: 'FactVerifier',
    system: `You are FactVerifier, a rigorous fact-checking specialist collaborating in the unified team chatroom.

Verify facts, tool outputs, and conclusions. Provide confirmed, evidence-based input to the team.`,
    tools: ['get_array_length', 'show_all_tools', 'get_team_status', 'message_team_member'],
    maxIterations: 60
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS: Dynamic tool lookup + safe argument parsing
// ─────────────────────────────────────────────────────────────────────────────
function getToolsForAgent(agentName) {
  const config = agentsConfig[agentName];
  if (!config?.tools) return [];
  return config.tools
    .map(toolName => {
      const entry = toolRegistry[toolName];
      if (!entry?.definition) {
        console.warn(`⚠️ Missing tool definition: ${toolName} for agent ${agentName}`);
        return null;
      }
      return entry.definition;
    })
    .filter(Boolean);
}

function getToolHandler(toolName) {
  return toolRegistry[toolName]?.handler || null;
}

function parseToolArguments(rawArgs) {
  let args = {};
  if (rawArgs == null) return args;
  if (typeof rawArgs === 'string') {
    const trimmed = rawArgs.trim();
    if (trimmed && trimmed !== 'null') {
      try { args = JSON.parse(trimmed); } catch (e) {}
    }
  } else if (typeof rawArgs === 'object') {
    args = rawArgs;
  }
  return args;
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL AGENT RUNNER (unchanged streaming/thinking logic)
// ─────────────────────────────────────────────────────────────────────────────
async function runAgent(agentName, initialMessages, agentTools, maxIterations) {
  let messages = [...initialMessages];
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;

    const stream = await ollama.chat({
      model,
      messages,
      tools: agentTools,
      keep_alive: 0,
      options: {
        temperature: 0,
        top_p: 0.1,
        top_k: 10,
      },
      think: true,
      stream: true
    });

    const assistantMessage = {
      role: 'assistant',
      content: '',
      thinking: '',
      tool_calls: []
    };

    let inThinking = false;
    let inContent = false;

    for await (const chunk of stream) {
      const msg = chunk.message || {};

      if (msg.thinking) {
        if (!inThinking) {
          inThinking = true;
          console.log(`\n🧠 [${agentName} THINKING TRACE]`);
          console.log('─'.repeat(90));
        }
        process.stdout.write('\x1b[34m' + msg.thinking + '\x1b[0m');
        assistantMessage.thinking += msg.thinking;
      }

      if (msg.content) {
        if (!inContent) {
          inContent = true;
          if (inThinking) console.log('\n');
          console.log(`\n💬 [${agentName} FINAL RESPONSE]`);
          console.log('─'.repeat(90));
        }
        process.stdout.write('\x1b[36m' + msg.content + '\x1b[0m');
        assistantMessage.content += msg.content;
      }

      if (msg.tool_calls?.length > 0) {
        assistantMessage.tool_calls = msg.tool_calls;
      }
    }

    console.log('\n' + '─'.repeat(90));

    messages.push(assistantMessage);

    if (assistantMessage.tool_calls?.length > 0) {
      for (const toolCall of assistantMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const args = parseToolArguments(toolCall.function.arguments);

        if (functionName === 'finalize_answer') {
          return {
            content: args.final_answer || '[No answer provided]',
            explanation: args.consensus_explanation || '',
            finalized: true,
            messages
          };
        }

        const handler = getToolHandler(functionName);
        if (handler) {
          const toolResult = await handler(args, { agentName, chatroom });
          messages.push({
            role: 'tool',
            name: functionName,
            content: JSON.stringify(toolResult),
          });
        } else {
          console.warn(`⚠️  No handler for tool: ${functionName} (agent: ${agentName})`);
        }
      }
      continue;
    }

    if (assistantMessage.content?.trim()) {
      return {
        content: assistantMessage.content.trim(),
        messages
      };
    }

    break;
  }

  return {
    content: `[${agentName}] Max iterations reached without final answer.`,
    messages
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXECUTION
// ─────────────────────────────────────────────────────────────────────────────
const main = async () => {
  const start = performance.now();
  const leaderConfig = agentsConfig.TeamLeader;

  const leaderMessages = [
    { role: 'system', content: leaderConfig.system },
    { role: 'user', content: userPrompt }
  ];

  try {
    const leaderResult = await runAgent(
      'TeamLeader',
      leaderMessages,
      getToolsForAgent('TeamLeader'),
      leaderConfig.maxIterations
    );

    console.log('\n🏆 [FINAL TEAM ANSWER]');
    console.log('─'.repeat(90));

    if (leaderResult.explanation) {
      console.log(`📋 Consensus explanation:\n\x1b[33m${leaderResult.explanation}\x1b[0m\n`);
    }

    console.log('🤖 Final answer:')
    console.log(`\x1b[32m${leaderResult.content}\x1b[0m`);

    console.log(`\n⏱️ Total time: ${((performance.now() - start) / 1000).toFixed(2)}s | 💬 Chatroom final size: ${chatroom.log.length} messages`);
    console.log('─'.repeat(90) + '\n');
  } catch (err) {
    console.error(`Failed with ${model}:`, err.message);
    console.error(err);
    process.exit(1);
  }
};

main().catch(console.error);