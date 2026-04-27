export const summaryDefinitions = {
    embed_model : 'qwen3-embedding',

    dense_summary : {
        model : 'qwen3.5',

        systemDirective : `
            /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture

            PROTOCOL: create_compact_past_summary → ONLY summarize past events. MAX density.
            - Maximize information density per token
            - Use shortest possible phrases and atomic facts
            - Prioritize critical state changes, entities, and recency
            - Focus your attention mostly on the most recent events / changes.
            - Avoid restating already resolved facts / events, unless relevant to the most recent change. 
            - Eliminate all redundancy and narrative fluff
            - If you are uncertain about something, DO NOT guess / suggest or add any question.

            Format: [MEM:U:<user intent>][MEM:S:<system state>][MEM:P:<key events>][MEM:T:<key topics + entities>]
            Output: EXACTLY in protocol format. Min 1. Max 1.

            No extra text, no newlines, no artifacts. minimal whitespace.
            /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture
        `,

        options : {
            temperature: 1,
            presence_penalty : 1.5,
            top_p: 0.95,
            top_k: 20,
            num_ctx : 16384,
            num_predict : 256
        }
    },

    trajectory_summary : {
        model : 'qwen3.5',

        systemDirective : `
            /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture

            PROTOCOL: create_compact_past_summary → ONLY summarize past events. MAX density.
            - Capture the causal chain and narrative flow
            - Highlight sequence of events, evolving intent, and decision points
            - Show how user intent and system state changed over time.
            - Focus your attention mostly on the most recent events / changes.
            - Keep chronological coherence while staying ultra-compact.
            - If you are uncertain about something, DO NOT guess / suggest or add any question.
            - Avoid restating already resolved facts / events, unless relevant to the most recent change.

            Format: [MEM:U:<user intent>][MEM:S:<system state>][MEM:P:<key events>][MEM:T:<key topics + entities>]
            Output: EXACTLY in protocol format. Min 1. Max 1.

            No extra text, no newlines, no artifacts. minimal whitespace.
            /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture
        `,

        options : {
            temperature: 1,
            presence_penalty : 1.5,
            top_p: 0.95,
            top_k: 20,
            num_ctx : 16384,
            num_predict : 256
        }
    },

    verification_summary : {
        model : 'qwen3.5',

        systemDirective : `
            /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture

            PROTOCOL: verify_and_consolidate → ONLY JSON.
            Format: {"trust_score":0-100,"consistency_between_summaries":0-100}
            Output: EXACTLY in protocol format. Min 1. Max 1.

            No extra text, no newlines, no artifacts. minimal whitespace.
            /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture
        `,

        options : {
            temperature: 1,
            presence_penalty : 1.5,
            top_p: 0.95,
            top_k: 20,
            num_ctx : 16384,
            num_predict : 128
        }
    }
};