import ollama from 'ollama';

const testArr = new Array(1000).fill(1);

const model = 'qwen3.5';

// ─────────────────────────────────────────────────────────────────────────────
// 1. TOOL DEFINITIONS (clean, declarative, easy to extend)
// ─────────────────────────────────────────────────────────────────────────────
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_array_length',
      description: 'Returns the exact number of items in the test array. Use this instead of trying to count manually or guessing.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },

  {
    type: 'function',
    function: {
      name: 'show_all_tools',
      description: 'Returns a complete list of all available tools with their names and descriptions. Use this when you are unsure which tools exist or want to refresh your knowledge of the toolbox.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 2. TOOL HANDLERS
// ─────────────────────────────────────────────────────────────────────────────
const toolHandlers = {
  get_array_length: async () => {
    return { count: testArr.length };
  },

  // ─────────────────────────────────────────────────────────────
  // NEW HANDLER
  // ─────────────────────────────────────────────────────────────
  show_all_tools: async () => {
    // Build a clean, human-readable list that the model can understand
    const toolList = tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
    }));

    return {
      tools: toolList,
      count: toolList.length,
      message: `You currently have ${toolList.length} tool(s) available.`,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. MAIN EXECUTION WITH TOOL-USE LOOP + THINKING CAPTURE
// ─────────────────────────────────────────────────────────────────────────────
const main = async () => {
  const start = performance.now();

  const messages = [
    {
    role: 'system',
    content: `
        You are a precise analytical assistant that ONLY uses tools when they are available.
        
        All tool responses can be 100% trusted.
        Never perform manual calculations, counting, or data inspection yourself.
        
        IMPORTANT: You do NOT know the list of available tools by heart.
        If you are ever unsure what tools you have, call "show_all_tools" first.
        You can call it at any time to get a fresh list of every tool and its description.
    `,
    },

    {
      role: 'user',
      content: 'Count the number of items in the test array.',
    },
  ];

  try {
    while (true) {
      const response = await ollama.chat({
        model,
        messages,
        tools,
        keep_alive: 0,
        options: {
          temperature: 0,
          top_p: 0.1,
          top_k: 10,
        }
      });

      const assistantMessage = response.message;

      // ─────────────────────────────────────────────────────────────
      // NEW: Capture and display model.thinking (what the model "thought")
      // ─────────────────────────────────────────────────────────────
        if (assistantMessage.thinking) {
        const thinking = assistantMessage.thinking.trim();
            if (thinking) {
                console.log(`🧠 [MODEL THINKING]`);
                console.log('─'.repeat(60));
                console.log('\x1b[34m' + thinking + '\x1b[0m');
                console.log('─'.repeat(60));
            }
        }

      // Add the assistant's message to the conversation history
      messages.push(assistantMessage);

      // ── Handle tool calls ───────────────────────────────────────
      if (assistantMessage.tool_calls?.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const functionName = toolCall.function.name;

          // Robust argument parsing
          let args = {};
          const rawArgs = toolCall.function.arguments;
          if (rawArgs != null) {
            if (typeof rawArgs === 'string') {
              const trimmed = rawArgs.trim();
              if (trimmed && trimmed !== 'null') {
                try {
                  args = JSON.parse(trimmed);
                } catch (e) {}
              }
            } else if (typeof rawArgs === 'object') {
              args = rawArgs;
            }
          }

          const handler = toolHandlers[functionName];
          if (handler) {
            const toolResult = await handler(args);
            messages.push({
              role: 'tool',
              name: functionName,
              content: JSON.stringify(toolResult),
            });
          } else {
            console.warn(`⚠️  No handler found for tool: ${functionName}`);
          }
        }
        continue; // let the model respond again with the tool result
      }

      // ── Final answer (no more tool calls) ───────────────────────
        if (assistantMessage.content) {
            const finalAnswer = assistantMessage.content.trim();

            console.log(`🤖 [MODEL ANSWER:]`);
            console.log('─'.repeat(60));
            console.log(`\x1b[32m${finalAnswer}\x1b[0m`)
            console.log('─'.repeat(60));
        } else {
            console.log('\n\n(No content in final response)');
        }
      break;
    }
  } catch (err) {
    console.error(`Failed ${model}: ${err.message}`);
    console.error(err);
    process.exit(1);
  }

  console.log(`⏱️ [Time: ${((performance.now() - start) / 1000).toFixed(2)}s]`);
};

main().catch(console.error);