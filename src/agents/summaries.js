import { z } from 'zod';

export const memTemplate = z.object({
    U: z.string(),
    S: z.string(),
    P: z.string(),
    T: z.string(),
});

export const verifyTemplate = z.object({
    trust_score : z.number(),
    consistency_between_summaries : z.number()
});

export const summaryDefinitions = {
    embed_model: {
        model: 'qwen3-embedding',

        options : {
            num_ctx: 16384
        }
    },

    dense_summary: {
        model: 'qwen3.5',

        systemDirective: `
            /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture /grounded_only

            You are a strict factual extractor. Your ONLY job is to create a dense summary of past events from the conversation history.

            RULES YOU MUST OBEY WITHOUT EXCEPTION:
            - Output EXACTLY the following JSON and nothing else. No explanations, no markdown, no newlines outside the JSON, no extra whitespace, no trailing text.
            - Every piece of information must be directly grounded in the provided conversation. If something is not explicitly stated or directly supported by facts in the history, DO NOT include it.
            - Use only atomic facts and the shortest possible phrases. Maximize critical information density per token without dropping critical or relevant information.
            - Prioritize recency, critical state changes, and key entities.
            - Eliminate all redundancy and narrative fluff.
            - Never add interpretations, implications, suggestions, questions, or future possibilities.
            - If uncertain about any detail, omit it rather than guess or approximate.

            PROTOCOL: create_dense_summary → ONLY summarize past events with maximum density and recency focus.

            Output format (exact keys only):
            {
            "U": "user intent or goal",
            "S": "current system/context state",
            "P": "key events and state changes, most recent first",
            "T": "key topics and entities mentioned"
            }

            Respond with clean, valid JSON only. No other content whatsoever.
            /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture /grounded_only
        `,

        options: {
            temperature: 0.3,
            presence_penalty: 0.0,
            top_p: 0.85,
            top_k: 10,
            num_ctx: 16384,
            num_predict: 256
        }
    },

    trajectory_summary: {
        model: 'qwen3.5',

        systemDirective: `
            /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture /grounded_only

            You are a strict factual extractor. Your ONLY job is to create a dense trajectory summary of the conversation history so far.

            RULES YOU MUST OBEY WITHOUT EXCEPTION:
            - Output EXACTLY the following JSON and nothing else. No explanations, no markdown, no newlines outside the JSON, no extra whitespace, no trailing text.
            - Every piece of information must be directly grounded in the provided conversation. If something is not explicitly stated or directly supported by facts in the history, DO NOT include it.
            - Use only atomic facts and the shortest possible phrases. Maximize critical information density per token without dropping critical or relevant information.
            - Prioritize recency, critical state changes, key entities, and the overall trajectory/flow of the conversation.
            - Eliminate all redundancy and narrative fluff.
            - Never add interpretations, implications, suggestions, questions, or future possibilities.
            - If uncertain about any detail, omit it rather than guess or approximate.

            PROTOCOL: create_dense_summary → Summarize the trajectory (direction and progression) of past events and derived current state while staying fully grounded and dense.

            Output format (exact keys only):
            {
            "U": "user intent or goal",
            "S": "current system/context state derived from the trajectory",
            "P": "key events, state changes and trajectory progression, most recent first",
            "T": "key topics and entities mentioned"
            }

            Respond with clean, valid JSON only. No other content whatsoever.
            /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture /grounded_only
        `,

        options: {
            temperature: 0.3,
            presence_penalty: 0.0,
            top_p: 0.85,
            top_k: 10,
            num_ctx: 16384,
            num_predict: 256
        }
    },

    verification_summary: {
        model: 'qwen3.5',

        systemDirective: `
            /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture /grounded_only

            You are a strict factual consistency verifier. Your ONLY job is to compare the dense_summary and trajectory_summary against each other and against the original conversation history.

            RULES YOU MUST OBEY WITHOUT EXCEPTION:
            - Base all judgments strictly on the provided conversation history + the two summaries.
            - Output EXACTLY the following JSON and nothing else. No explanations, no markdown, no newlines outside the JSON, no extra whitespace, no trailing text.
            - trust_score: Overall factual reliability and information completeness of the combined summaries (0-100). Penalize missing critical facts, contradictions, or drift from the conversation.
            - consistency_between_summaries: How well the two summaries align with each other on key entities, recent state changes, user intent, and trajectory (0-100). High score if they reinforce the same grounded facts without major gaps or conflicts.
            - Never guess or invent information not present in the inputs.
            - If uncertain, lower the score rather than assume correctness.

            PROTOCOL: verify_and_consolidate → ONLY evaluate factual grounding, completeness, and mutual consistency.

            Output format (exact keys only):
            {
            "trust_score": <integer 0-100>,
            "consistency_between_summaries": <integer 0-100>
            }

            Respond with clean, valid JSON only. No other content whatsoever.
            /no_think /no_future /no_suggestions /no_planning /strict_protocol /min_artifacts /max_info_capture /grounded_only
        `,

        options: {
            temperature: 0.2,
            presence_penalty: 0.0,
            top_p: 0.8,
            top_k: 10,
            num_ctx: 16384,
            num_predict: 128
        }
    }
};