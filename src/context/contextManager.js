import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import ollama from 'ollama';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { AnchorStore } from './anchorStore.js';
import { ContextStore } from './contextStore.js';
import { stripEventIds, withRetry } from '../utils.js';
import { summaryDefinitions, memTemplate, verifyTemplate } from './summaries.js';

export class ContextManager {
    #agentName; #master; #convId;

    #pinnedUserIntent; #prevUserQuery;

    #maxRecentTurns; 
    #maxVisibleAnchors; #maxMemoryAnchors;

    #anchorSeq; #startingAnchor;

    #startTime; #endTime;
    #prevStartTime; #prevEndTime;

    #anchorStore; #contextStore;

    #keywordConfig;

    constructor(agentName, master, convId, userInt, seq, stores) {
        this.#agentName = agentName;
        this.#master = master;
        this.#convId = convId;

        this.#maxRecentTurns = 25;
        this.#maxVisibleAnchors = 10;
        this.#maxMemoryAnchors = 5;

        this.#anchorSeq = seq;

        this.#startingAnchor = null;

        this.#startTime = new Date(),
        this.#endTime = null,

        this.#prevStartTime = null,
        this.#prevEndTime = null,

        this.#prevUserQuery = null;

        this.#pinnedUserIntent = userInt;

        this.#anchorStore = stores.anchorStore;
        this.#contextStore = stores.contextStore;

        this.#keywordConfig = {
            minWordLength: 3,
            ngramMax: 3,

            boostTerms: new Set(),

            weakWords: new Set([
                'hey', 'hello', 'hi', 'sup', 'yo', 'greetings',

                'what', 'when', 'where', 'who', 'whom', 'whose', 'why', 'how',
                'which', 'whether',

                'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
                'do', 'does', 'did', 'done', 'doing',
                'have', 'has', 'had', 'having',
                'will', 'would', 'can', 'could', 'may', 'might', 'shall', 'should', 'must',
                'ought', 'need', 'dare',

                "don't", "doesn't", "didn't", "won't", "wouldn't", "can't", "couldn't",
                "isn't", "aren't", "wasn't", "weren't", "haven't", "hasn't", "hadn't",
                "not", "no", "nor",

                'the', 'a', 'an',
                'this', 'that', 'these', 'those',
                'i', 'me', 'my', 'mine', 'myself',
                'you', 'your', 'yours', 'yourself', 'yourselves',
                'he', 'him', 'his', 'himself',
                'she', 'her', 'hers', 'herself',
                'it', 'its', 'itself',
                'we', 'us', 'our', 'ours', 'ourselves',
                'they', 'them', 'their', 'theirs', 'themselves',
                'one', 'someone', 'anyone', 'everyone', 'noone', 'nobody', 'somebody',

                'and', 'or', 'but', 'yet', 'so', 'for', 'nor',
                'although', 'though', 'because', 'since', 'unless', 'until', 'while', 'whereas',

                'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'into', 'over', 'after', 'before',
                'about', 'above', 'across', 'against', 'along', 'among', 'around', 'as', 'behind', 'below', 'beneath',
                'beside', 'between', 'beyond', 'down', 'during', 'except', 'inside', 'near', 'off', 'out', 'outside',
                'past', 'per', 'through', 'throughout', 'toward', 'towards', 'under', 'until', 'upon', 'via', 'within', 'without',

                'there', 'here', 'then', 'now', 'so', 'just', 'like', 'very', 'really', 'quite', 'too', 'also',
                'again', 'always', 'never', 'ever', 'often', 'sometimes', 'usually', 'already', 'still', 'yet',
                'maybe', 'perhaps', 'probably', 'actually', 'basically', 'simply', 'just', 'only', 'even',
                'well', 'right', 'okay', 'ok', 'yes', 'yeah', 'no', 'nah', 'sure', 'please', 'thanks', 'thank',

                'some', 'any', 'all', 'other', 'another', 'each', 'every', 'few', 'many', 'more', 'most', 'several', 'such',
                'both', 'either', 'neither', 'whole', 'same',

                'uh', 'um', 'er', 'ah', 'oh', 'yeah', 'yep', 'yup', 'nah', 'hmm', 'like',

                'if', 'else', 'than', 'then', 'when', 'where', 'while',
                'own', 'same', 'such', 'rather', 'quite', 'much', 'more', 'most',
                'get', 'got', 'gets', 'getting',
                'make', 'makes', 'made', 'making',
                'take', 'takes', 'took', 'taken', 'taking',
                'say', 'says', 'said', 'saying',
                'see', 'saw', 'seen', 'seeing',
                'go', 'goes', 'went', 'gone', 'going',
                'come', 'comes', 'came', 'coming',
                'know', 'knows', 'knew', 'known',
                'think', 'thinks', 'thought',
                'want', 'wants', 'wanted',
                'let', 'lets'
            ])
        };
    }

    static async init(dbUrl, collectionName, agentName, master, convId, userInt) {
        const contextStore = new ContextStore(dbUrl, collectionName);
        const anchorStore = new AnchorStore(dbUrl, summaryDefinitions.embed_model.dimensions, collectionName);

        await contextStore.init();

        await anchorStore.init();
        const anchorSeq = await anchorStore.getCurrentSequenceId();

        const returnCtxManager = new ContextManager(
            agentName, master, convId, userInt, anchorSeq, { contextStore, anchorStore }
        );

        return returnCtxManager;
    }

    async close() {
        try {
            if (this.#anchorStore) await this.#anchorStore.close();
            if (this.#contextStore) await this.#contextStore.close();  
        } catch (e) {}
    }

    #hashContent(c) {
        const contentForHash = JSON.stringify(c);
        return crypto.createHash('sha256').update(contentForHash).digest('hex').slice(0, 16);
    }

    #compactTimestamp(date) {
        const d = new Date(date);
        
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const seconds = String(d.getSeconds()).padStart(2, '0');
        
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }

    #exactTimeDiff(date1, date2) {
        const diffMs = date2.getTime() - date1.getTime();
        if (diffMs < 0) return '0s';

        const totalSeconds = Math.floor(diffMs / 1000);

        if (totalSeconds >= 86400) {
            return '> 1 day';
        }

        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const parts = [];

        if (hours > 0) parts.push(`${hours}h`);
        if (minutes > 0) parts.push(`${minutes}m`);
        if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

        return parts.join('');
    }

    #cosineSimilarity(a, b) {
        if (!a || !a.length || !b || !b.length || a.length !== b.length) return 0;
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        if (magA === 0 || magB === 0) return 0;
        return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    }

    #jaccardSimilarity(setA, setB) {
        const intersection = new Set([...setA].filter(x => setB.has(x)));
        const union = new Set([...setA, ...setB]);
        return union.size === 0 ? 0 : intersection.size / union.size;
    }

    #extractCurrentAnchorStatus(str) {
        const regex = /\[CTX_ANC_(\d+)\|STATUS:([A-Z_]+)\|RES_ANC:([A-Z0-9-]+)\|/;
        const match = str.match(regex);
        if (!match) return null;
        return {
            anchorId: match[1],
            status: match[2],
            resolutionAnchor: match[3]
        };
    }

    #extractAnchorFeatures(context, summaryData, embeddingData) {
        const kwConv = new Set(this.#extractKeywords(context));

        const simDense = embeddingData.convEmbedding.length ? this.#cosineSimilarity(embeddingData.denseEmbedding, embeddingData.convEmbedding) : 0;
        const kwDense = new Set(this.#extractKeywords(summaryData.denseSummary));
        const jaccDense = this.#jaccardSimilarity(kwConv, kwDense);
        const reliabilityDense = simDense * 0.7 + jaccDense * 0.3;

        const simTraj = embeddingData.convEmbedding.length ? this.#cosineSimilarity(embeddingData.trajEmbedding, embeddingData.convEmbedding) : 0;
        const kwTraj = new Set(this.#extractKeywords(summaryData.trajectorySummary));
        const jaccTraj = this.#jaccardSimilarity(kwConv, kwTraj);
        const reliabilityTraj = simTraj * 0.7 + jaccTraj * 0.3;

        const simSelf = embeddingData.convEmbedding.length ? this.#cosineSimilarity(embeddingData.denseEmbedding, embeddingData.trajEmbedding) : 0;

        return {
            kwDense : [ ...kwDense ], 
            kwTraj : [ ...kwTraj ], 
            kwConv : [ ...kwConv ],

            jaccDense: Number((jaccDense * 100).toFixed(3)),
            jaccTraj: Number((jaccTraj * 100).toFixed(3)),

            simDense: Number((simDense * 100).toFixed(3)),
            simTraj: Number((simTraj * 100).toFixed(3)),
            simSelf: Number((simSelf * 100).toFixed(3)),

            reliabilityDense: Number((reliabilityDense * 100).toFixed(3)),
            reliabilityTraj: Number((reliabilityTraj * 100).toFixed(3))
        };
    }

    #calculateTrustScore(anchorData, verifierTrust, consistency) {
        const safe = (val, def = 50) => (typeof val === 'number' && !isNaN(val) && val >= 0)
            ? Math.min(100, Math.max(0, val)) : def;

        const simDense = safe(anchorData.simDense);
        const simTraj = safe(anchorData.simTraj);
        const jaccDense = safe(anchorData.jaccDense);
        const jaccTraj = safe(anchorData.jaccTraj);
        const simSelf = safe(anchorData.simSelf);
        const relDense = safe(anchorData.reliabilityDense);
        const relTraj = safe(anchorData.reliabilityTraj);

        const consistencyScore = safe(consistency);

        const hasVerifier = (typeof verifierTrust === 'number' && !isNaN(verifierTrust));
        const verifierScore = hasVerifier ? Math.min(100, Math.max(0, verifierTrust)) : 0;

        const avgSim = (simDense + simTraj) / 2;
        const avgJacc = (jaccDense + jaccTraj) / 2;
        const relDelta = Math.abs(relDense - relTraj);
        const relHarmony = 100 - relDelta;

        const coherenceRaw = Math.max(0, 100 - Math.abs(simSelf - 75));
        const crossAgreementBonus = Math.pow(coherenceRaw / 100, 1.3) * 38;

        const semanticSynergy = Math.sqrt(simDense * simTraj) *
            (1 + 0.001 * Math.pow(Math.min(simDense, simTraj), 1.8));

        const keywordRobustness = Math.pow(avgJacc / 100, 0.85) * 100;

        const varianceProxy = (Math.abs(simDense - simTraj) + Math.abs(jaccDense - jaccTraj) + relDelta) / 3;
        const uncertaintyFactor = Math.exp(-varianceProxy / 45);
        const dataVolumeConfidence = Math.min(1, (simDense + simTraj + avgJacc) / 220);

        let baseWeights = {
            semantic: 0.39,
            keyword: 0.14,
            consistency: 0.13,
            coherence: 0.09,
            reliability: 0.08,
            synergy: 0.17
        };

        const signalStrength = (avgSim + keywordRobustness + consistencyScore) / 300;
        if (signalStrength > 0.72) {
            baseWeights.semantic += 0.04;
            baseWeights.synergy += 0.03;
        }

        const linearBase =
            baseWeights.semantic * semanticSynergy +
            baseWeights.keyword * keywordRobustness +
            baseWeights.consistency * consistencyScore +
            baseWeights.coherence * crossAgreementBonus +
            baseWeights.reliability * relHarmony +
            baseWeights.synergy * (semanticSynergy * keywordRobustness / 75);

        const interactionFactor = 1 + (0.00085 * avgSim * consistencyScore * relHarmony) / 10000;

        let internalScore = linearBase * interactionFactor * uncertaintyFactor * dataVolumeConfidence;

        let finalInternal = 100 / (1 + Math.exp(-0.068 * (internalScore - 67)));
        finalInternal = Math.min(99.7, finalInternal +
            ((relHarmony > 93 && coherenceRaw > 88) ? 2.5 : 0));

        if (!hasVerifier) {
            return Number(finalInternal.toFixed(3));
        }

        const verifierInfluence = Math.pow(verifierScore / 100, 0.75) * 100;
        const verifierWeight = 0.28;

        const blendedScore = (finalInternal * (1 - verifierWeight)) + 
                            (verifierInfluence * verifierWeight);

        const finalScore = 100 / (1 + Math.exp(-0.065 * (blendedScore - 70)));

        return Number(finalScore.toFixed(3));
    }

    #addBoostTerms(terms) {
        if (!terms) return;
        if (Array.isArray(terms)) {
            terms.forEach(term => {
                if (term) this.#keywordConfig.boostTerms.add(term.toLowerCase().trim());
            });
        } else if (typeof terms === 'string') {
            this.#keywordConfig.boostTerms.add(terms.toLowerCase().trim());
        }
    }

    #generateNGrams(text) {
        const clean = this.#cleanTextForKeywords(text);
        if (!clean) return [];

        const tokens = clean
            .split(/\s+/)
            .map(t => t.trim())
            .filter(t => t.length >= this.#keywordConfig.minWordLength);

        const ngrams = new Set();

        for (let n = 1; n <= this.#keywordConfig.ngramMax; n++) {
            for (let i = 0; i <= tokens.length - n; i++) {
                const gram = tokens.slice(i, i + n).join(' ').trim();
                if (gram.length < this.#keywordConfig.minWordLength) continue;

                if (this.#containsOnlyWeakWords(gram)) continue;

                ngrams.add(gram);
            }
        }

        return Array.from(ngrams);
    }

    #countOccurrences(text, phrase) {
        const escaped = this.#escapeRegExp(phrase);
        const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
        const matches = text.match(regex);
        return matches ? matches.length : 0;
    }

    #escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    #isWeakWord(word) {
        if (!word) return true;
        return this.#keywordConfig.weakWords.has(word.toLowerCase().trim());
    }

    #isPureWeakPhrase(phrase) {
        if (!phrase || typeof phrase !== 'string') return true;
        const words = phrase.toLowerCase().trim().split(/\s+/).filter(Boolean);
        if (words.length === 0) return true;
        return words.every(word => this.#isWeakWord(word));
    }

    #containsOnlyWeakWords(phrase) {
        return this.#isPureWeakPhrase(phrase);
    }

    #cleanTextForKeywords(text) {
        if (!text || typeof text !== 'string') return '';
        return text
            .toLowerCase()
            .replace(/[^\w\s'-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    #extractKeywords(text) {
        if (!text || typeof text !== 'string' || text.trim().length < 8) {
            return [];
        }

        return this.#generateNGrams(text);
    }

    #scoreKeywords(candidates, fullText) {
        const sentences = fullText.split(/[.!?]+/).filter(s => s.trim().length > 5);
        const totalSentences = Math.max(sentences.length, 1);

        return candidates.map(phrase => {
            const words = phrase.split(/\s+/);
            const tf = this.#countOccurrences(fullText, phrase);

            let docFreq = 0;
            const escapedPhrase = this.#escapeRegExp(phrase);
            const regex = new RegExp(`\\b${escapedPhrase}\\b`, 'i');

            for (const sent of sentences) {
                if (regex.test(sent)) docFreq++;
            }
            const idf = Math.log(1 + totalSentences / (docFreq || 1));

            let score = tf * idf;

            const isMultiWord = words.length > 1;
            const hasNumber = /\d/.test(phrase);
            const isEntityLike = /^[A-Z]/.test(phrase) || phrase === phrase.toUpperCase();

            if (isMultiWord) score *= 1.65;
            if (isEntityLike) score *= 1.25;
            if (hasNumber && words.length === 1) score *= 0.6;

            if (this.#containsOnlyWeakWords(phrase)) {
                score *= 0.05;
            } else if (words.some(w => this.#isWeakWord(w))) {
                score *= 0.45;
            }

            if (this.#keywordConfig.boostTerms.has(phrase)) {
                score *= 2.5;
            }

            return {
                phrase,
                score: Number(score.toFixed(4)),
                tf,
                length: words.length
            };
        }).sort((a, b) => b.score - a.score);
    }

    #rerankActiveKeywords(limit, activeKwList, currentText) {
        if (!activeKwList?.length) return [];

        const seen = new Map();

        for (const kw of activeKwList) {
            if (!kw) continue;
            const normalized = kw.toLowerCase().trim();
            const hash = this.#hashContent(normalized);
            if (!seen.has(hash)) {
                seen.set(hash, kw.trim());
            }
        }

        let candidates = Array.from(seen.values())
            .filter(kw => kw.length >= this.#keywordConfig.minWordLength)
            .filter(kw => !this.#containsOnlyWeakWords(kw))
            .filter(kw => {
                const words = kw.split(/\s+/);
                if (words.length <= 2) {
                    return words.some(w => !this.#isWeakWord(w));
                }
                return true;
            });

        if (!candidates.length) return [];

        const scored = this.#scoreKeywords(candidates, currentText.toLowerCase().trim());

        const finalScored = scored.map(item => {
            let score = item.score;

            if (this.#keywordConfig.boostTerms.has(item.phrase)) score *= 2.5;
            if (this.#countOccurrences(this.#pinnedUserIntent.toLowerCase(), item.phrase) > 0) {
                score *= 1.8;
            }

            return { ...item, score: Number(score.toFixed(4)) };
        }).sort((a, b) => b.score - a.score);

        const result = [];
        const used = new Set();

        for (const item of finalScored) {
            if (used.has(item.phrase)) continue;

            let isDuplicate = false;
            for (const kept of result) {
                if (this.#areKeywordsVerySimilar(kept, item.phrase)) {
                    isDuplicate = true;
                    break;
                }
            }

            if (!isDuplicate) {
                result.push(item.phrase);
                used.add(item.phrase);
            }

            if (result.length >= limit) break;
        }

        return result;
    }

    #areKeywordsVerySimilar(kw1, kw2) {
        if (kw1 === kw2) return true;

        const a = kw1.toLowerCase();
        const b = kw2.toLowerCase();

        if (a.length < 6 || b.length < 6) {
            return a.includes(b) || b.includes(a);
        }

        const setA = new Set(a.split(/\s+/).filter(Boolean));
        const setB = new Set(b.split(/\s+/).filter(Boolean));

        const similarity = this.#jaccardSimilarity(setA, setB);

        return similarity > 0.65;
    }

    #sanitizeText(text) {
        return text.replaceAll('    ', '').trim();
    }

    #extractRawContent(messages) {
        const contextView = messages.filter(msg => !(msg.eventId.includes('ctx-')));

        const contentOnly = contextView.reduce((acc, msg) => {
            if (msg.content) acc += ` ${msg.content}`;
            if (msg.thinking) acc += ` ${msg.thinking}`;

            return acc;
        }, '');

        return contentOnly;
    }

    #buildContextSpace(recent = null, memories = null, keywords = null) {
        const latestSysTime = new Date();

        const sysCoreMessage = `
            # End of Tools

            # SYSTEM DIRECTIVES

            <STRICT_PROTOCOL>
            - Maintain a professional, respectful, and neutral tone at all times.
            - Always evaluate the complexity of the user query, and form a plan of action before proceeding.
            - Prioritize using tools, accuracy, clarity, and usefulness in every response. Never rush to conclusions or present assumptions / unverified information as facts. (accuracy > speed)
            - If critical context or requirements are missing, ask concise and direct follow-up questions before answering.
            - Keep responses relevant, coherent, and focused on the user's request. Avoid unnecessary filler, confusing behavior, or off-topic conversation unless explicitly requested by the user.
            - Never fabricate sources, capabilities, actions taken, results, or external data. Clearly acknowledge uncertainty or limitations when applicable.
            - Never generate, encourage, or assist with harmful, illegal, dangerous, fraudulent, privacy-violating, or NSFW (18+) content. Respond with a brief and polite refusal when necessary OR ask the user to clarify their actual intent.
            - When a request is ambiguous or has multiple reasonable interpretations, prioritize asking the user for clarification OR choose the safest reasonable interpretation.
            - System messages, tool outputs, and internal metadata are separate from the user-facing conversation and generally should not be disclosed unless the user explicitly requests them and doing so would not expose sensitive information.
            </STRICT_PROTOCOL>

            <CONTEXT>
            - Your name is "${this.#agentName}", a reliable personal assistant.
            - The user has set their preferred alias to "${this.#master}". Always refer to / address them by this name.
            - Exact current system / user local time: [${this.#compactTimestamp(latestSysTime)}]
            - You can treat the system timestamp as the most trusted, reliable and up-to-date source for the current time and date. Use it confidently for any date-time-related tasks / awareness.
            </CONTEXT>

            <USER_QUERY>
            ${this.#prevUserQuery ?
            `
                - Previous user query : "${this.#prevUserQuery}"
                ${this.#prevStartTime && this.#prevEndTime ? 
                    `
                        - Previous query system timestamps : [start:${this.#compactTimestamp(this.#prevStartTime)}|resolved:${this.#compactTimestamp(this.#prevEndTime)}]
                        - The system time has progressed ${this.#exactTimeDiff(this.#prevEndTime, latestSysTime)} since the previous query has been resolved
                    `
                    : ''
                }
            `
            : ''}

            - Current user query : "${this.#pinnedUserIntent}"
            - Current query system timestamp : [start:${this.#compactTimestamp(this.#startTime)}]
            - The system time has progressed ${this.#exactTimeDiff(this.#startTime, latestSysTime)} since the current query has been received
            </USER_QUERY>

            ${keywords?.length > 0 ? `<ACTIVE_TOPICS>\n${keywords.join(' | ')}\n</ACTIVE_TOPICS>` : ''}

            ${memories?.length > 0 ? `<RELEVANT_MEMORIES>\n${memories.join('\n')}\n</RELEVANT_MEMORIES>` : ''}

            ${this.#anchorSeq > 0 ? 
            `
                <ANCHOR_REFERENCE>
                - Most recent context anchor available: ${this.#anchorSeq}.
                - Context anchors can be seen as conversation checkpoints / progression trackers.
                - Use any context anchors provided by the system to traverse and confirm the conversation flow.
                - Only you can see the anchors provided by the system to your current context window.

                ${this.#startingAnchor && this.#anchorSeq - this.#startingAnchor > 2 ? 
                    `- Context anchors for the current query range from : ${this.#startingAnchor} - ${this.#anchorSeq}`
                    : ''
                }

                - All anchors have the following labels:
                -- CTX_ANC_A... (Context anchor + id)
                -- STATUS (ACTIVE for anchors related to the current active user query, RESOLVED for any previous user queries)
                -- RES_ANC (Pointer to the resolution anchor that marks the resolved state of that user query. All RESOLVED anchors will have a resolution pointer)
                -- SYS_TIME (Exact system time at which the context anchor was created)

                -- U (user intent / goal, at the time of anchor creation)
                -- S (system / context state, at the time of anchor creation)
                -- P (key events / state changes, at the time of anchor creation)
                -- T (key topics / entities, at the time of anchor creation)
                </ANCHOR_REFERENCE>
            ` 
            : ''}

            # END OF SYSTEM DIRECTIVES

            # CONVERSATION HISTORY
        `;

        const newUserMessage = { role : 'user', eventId : crypto.randomUUID(), content : this.#pinnedUserIntent };

        const curatedContext = recent ? 
            [ { role : 'system', eventId : 'SYS-CORE', content : sysCoreMessage }, ...recent ] :
            [ { role : 'system', eventId : 'SYS-CORE', content : sysCoreMessage }, newUserMessage ];

        return curatedContext.map((m) => {
            if (m.content) m.content = this.#sanitizeText(m.content);
            if (m.thinking) m.thinking = this.#sanitizeText(m.thinking);

            return m;
        });
    }

    async #getContentEmbeddings(content) {
        try {
            const embeddings = await withRetry(async () => (await ollama.embed({ 
                model : summaryDefinitions.embed_model.model, 
                input : [ content ],
                options: summaryDefinitions.embed_model.options
            })).embeddings[0]);

            return embeddings;
        } catch (error) {
            return [];
        }
    }

    async #getContextSummary(type, context) {
        const selectedSumType = summaryDefinitions[type];

        let summaryContent = {};

        const response = await withRetry(async () => ollama.chat({
            model: selectedSumType.model,

            messages: [
                { role: 'system', content: selectedSumType.systemDirective },
                { role: 'user', content: `Strictly follow the create_dense_summary protocol and summarize this:\n${JSON.stringify(context)}` }
            ],

            think: false,
            stream: false,

            format: zodToJsonSchema(memTemplate),

            options: selectedSumType.options
        }));

        try {
            const fullContent = response.message?.content || '';

            if (fullContent) summaryContent = fullContent;

            summaryContent = memTemplate.parse(JSON.parse(summaryContent));

        } catch (err) {
            summaryContent = {};
        }

        return summaryContent;
    }

    async #getVerificationSummary(context, anchorData, summaries) {
        let verificationContent = {};

        const response = await withRetry(async () => ollama.chat({
            model: summaryDefinitions.verification_summary.model,

            messages: [
                { role: 'system', content: summaryDefinitions.verification_summary.systemDirective },

                {
                    role: 'user',
                    content: `
                        Strictly follow the verify_and_consolidate protocol and evaluate both summaries against the main conversation:

                        1. Dense style summary:
                        ${summaries.denseSummary}

                        2. Trajectory style summary:
                        ${summaries.trajectorySummary}

                        Semantic similarity:
                        - Dense vs Full conversation : ${anchorData.simDense} 
                        - Trajectory vs Full conversation : ${anchorData.simTraj} 
                        - Dense vs Trajectory : ${anchorData.simSelf}

                        Jaccard keyword similarity:
                        - Dense : ${anchorData.jaccDense} 
                        - Trajectory : ${anchorData.jaccTraj}

                        Reliability score:
                        - Dense : ${anchorData.reliabilityDense} 
                        - Trajectory : ${anchorData.reliabilityTraj}

                        Full conversation:
                        ${context}
                    `
                }
            ],

            think: false,
            stream: false,

            format: zodToJsonSchema(verifyTemplate),

            options: summaryDefinitions.verification_summary.options
        }));

        try {
            const fullContent = response.message?.content || '';

            if (fullContent) {
                verificationContent = fullContent;

                verificationContent = verifyTemplate.parse(JSON.parse(verificationContent))
            }
        } catch (err) {
            verificationContent = {};
        }

        return verificationContent;
    }

    async #addAnchor(trustScore, isLast, summaryData, rawData, result = null) {
        this.#anchorSeq++;

        if (!this.#startingAnchor) this.#startingAnchor = this.#anchorSeq;

        const anchorStatus = isLast ? 'RESOLVED' : 'ACTIVE';
        const resolutionPointer = isLast ? this.#anchorSeq : null;

        const anchorCreateTime = await this.#anchorStore.insertAnchor({
            sequenceId : this.#anchorSeq,
            status : anchorStatus,
            trustScore : Math.max(0, Math.min(100, trustScore)),

            resolverData : {
                isResolver: isLast,
                resolutionAnchor: resolutionPointer,
                queryAndResult: isLast ? { query: this.#pinnedUserIntent, result } : null,
            },

            summaryData : {
                dense : { 
                    hash : this.#hashContent(summaryData.dense.summary),
                    contentObj : summaryData.dense.summary
                },

                trajectory : {
                   hash :  this.#hashContent(summaryData.trajectory.summary),
                   contentObj : summaryData.trajectory.summary
                }
            },

            rawTurns : rawData.turns
        }, {
            dense : summaryData.dense.keywords,
            trajectory : summaryData.trajectory.keywords,
            raw : rawData.keywords
        }, {
            dense : summaryData.dense.embeddings,
            trajectory : summaryData.trajectory.embeddings,
            raw : rawData.embeddings
        });

        return {
            anchorId: this.#anchorSeq,
            anchorStatus: anchorStatus,
            anchorTime: anchorCreateTime,
            resolutionAnchor: resolutionPointer
        };
    }

    async #getContextMessages(fullMessages, isSummary = false, isLast = false) {
        if (isSummary) {
            const fullPurgedMessages = fullMessages.filter(msg => msg.eventId !== 'SYS-CORE' && !(msg.eventId.includes('ctx-')));

            const nameMappedMessages = fullPurgedMessages.slice(-this.#maxRecentTurns).map(msg => {
                if (msg.role === 'user' || msg.role === 'assistant') {
                    return {
                        name : msg.role === 'user' ? this.#master : this.#agentName,
                        ...JSON.parse(JSON.stringify(msg))
                    }
                }

                return msg;
            });

            return nameMappedMessages.map((m) => {
                if (m.content) m.content = this.#sanitizeText(m.content);
                if (m.thinking) m.thinking = this.#sanitizeText(m.thinking);

                return m;
            });
        };

        let curatedContext;

        const activeKeywords = this.#extractKeywords(this.#pinnedUserIntent);

        if (!fullMessages) {
            const systemBoostTerms = this.#rerankActiveKeywords(10, activeKeywords, this.#pinnedUserIntent);

            this.#addBoostTerms(systemBoostTerms);

            const restoredContext = await this.#contextStore.getLastSnapshot();

            if (!restoredContext.context || restoredContext.context?.length < 1 ) {
                curatedContext = this.#buildContextSpace(null, null, systemBoostTerms);
                return curatedContext;
            }

            if (restoredContext.start) this.#prevStartTime = restoredContext.start;
            if (restoredContext.end) this.#prevEndTime = restoredContext.end;

            if (restoredContext.lastQuery) {
                this.#prevUserQuery = restoredContext.lastQuery;

                const prevKeywords = this.#extractKeywords(this.#prevUserQuery);
                activeKeywords.push(...prevKeywords);
            };

            if (restoredContext?.boostTerms?.length > 0) this.#addBoostTerms(restoredContext.boostTerms);

            fullMessages = restoredContext.context;
            fullMessages.push({ role : 'user', eventId : crypto.randomUUID(), content : this.#sanitizeText(this.#pinnedUserIntent) })
        }

        if (isLast) this.#endTime = await this.#anchorStore.resolveActiveAnchors(this.#startingAnchor, this.#anchorSeq);

        fullMessages = fullMessages.filter(msg => msg.eventId !== 'SYS-CORE');

        const anchorCount = () => fullMessages.filter(x => x.eventId.includes('ctx-')).length;
        const speakersCount = () => fullMessages.filter(x => x.role === 'user' || x.role === 'assistant').length;

        while (anchorCount() > this.#maxVisibleAnchors || speakersCount() > this.#maxRecentTurns) {
            const newMsgChunk = fullMessages.shift();

            const rawChunkContent = this.#extractRawContent([newMsgChunk]);

            const chunkKeywords = this.#extractKeywords(rawChunkContent);

            const bestChunkWords = this.#rerankActiveKeywords(10, chunkKeywords, rawChunkContent);

            if (chunkKeywords.length > 0) this.#addBoostTerms(bestChunkWords);
        }

        const visibleAnchorIds = fullMessages.filter(x => x.eventId.includes('ctx-')).map(i => Number(i.eventId.slice(4)));

        const actualAnchorStatus = await this.#anchorStore.getAnchorStatus(visibleAnchorIds);

        for (const msg of fullMessages) {
            if (msg.eventId.includes('ctx-')) {
                const anchorInfo = this.#extractCurrentAnchorStatus(msg.content);
                
                if (anchorInfo && anchorInfo.anchorId) {
                    const actualAnchorData = actualAnchorStatus[anchorInfo.anchorId];

                    if (actualAnchorData && anchorInfo.status !== actualAnchorData.status) {
                        msg.content = msg.content.replace(
                            `STATUS:${anchorInfo.status}|RES_ANC:${anchorInfo.resolutionAnchor}`,
                            `STATUS:${actualAnchorData.status}|RES_ANC:A${actualAnchorData.resolutionAnchor}`
                        );
                    }

                    if (actualAnchorData && actualAnchorData.keywords?.length > 0) {
                        activeKeywords.push(...actualAnchorData.keywords)
                    }
                }
            }
        };

        const tempContentOnly = this.#extractRawContent(fullMessages);

        const tempEmbeddings = await this.#getContentEmbeddings(tempContentOnly);

        const tempKeyWords = [ ...new Set(activeKeywords) ];

        const tempRankedWords = this.#rerankActiveKeywords(
            Math.max(25, Math.round(tempKeyWords.length * 0.15)),
            tempKeyWords, tempContentOnly
        );

        const recalledAnchors = await this.#anchorStore.searchAnchors(tempEmbeddings, tempRankedWords, {
            limit : this.#maxMemoryAnchors,
            maxSequenceId : Math.min(visibleAnchorIds),
        });

        if (recalledAnchors.length > 0) {
            const relevantMemories = recalledAnchors.map((m) => {
                const resAnc = !m.resolverData.resolutionAnchor ? '-' : `A${m.resolverData.resolutionAnchor}`;
                const compactTimeStamp = this.#compactTimestamp(m.created);

                const { U, S, P, T } = m.summary;

                return `[CTX_ANC_${m.id}|STATUS:${m.status}|RES_ANC:${resAnc}|SYS_TIME:${compactTimeStamp}]=[U:${U}][S:${S}][P:${P}][T:${T}]`;
            });

            const allRecalledKeywords = [ ...new Set((recalledAnchors.map(m => m.keywords)).flat()) ];
            activeKeywords.push(...allRecalledKeywords);

            const finalActiveKeywords = this.#rerankActiveKeywords(
                10, activeKeywords,
                this.#extractRawContent(fullMessages) 
            );

            curatedContext = this.#buildContextSpace(fullMessages, relevantMemories, finalActiveKeywords);
        } else {
            const finalActiveKeywords = this.#rerankActiveKeywords(
                10, activeKeywords,
                this.#extractRawContent(fullMessages) 
            );

            curatedContext = this.#buildContextSpace(fullMessages, null, finalActiveKeywords);
        }

        await this.#contextStore.newSnapshot(curatedContext, {
            lastQuery : this.#pinnedUserIntent,
            start : this.#startTime,
            end : this.#endTime,
            boostTerms : [ ...this.#keywordConfig.boostTerms ]
        });

        return curatedContext;
    }

    async getContextUpdate(messages, isLast = false, finalResult = null) {
        if (!messages) {
            const contextRecovery = await this.#getContextMessages(null, false, isLast);
            return contextRecovery;
        }

        const summaryContext = await this.#getContextMessages(messages, true, isLast);
        const modelSummaryContext = JSON.stringify(stripEventIds(summaryContext));
        const summaryContent = this.#extractRawContent(summaryContext);

        const denseSummaryObject = await this.#getContextSummary('dense_summary', modelSummaryContext);
        const denseSummary = JSON.stringify(denseSummaryObject);
        const denseContent = Object.values(denseSummaryObject).reduce((acc, val) => `${acc} ${val}`, '');

        const trajectorySummaryObject = await this.#getContextSummary('trajectory_summary', modelSummaryContext);
        const trajectorySummary = JSON.stringify(trajectorySummaryObject);
        const trajectoryContent = Object.values(trajectorySummaryObject).reduce((acc, val) => `${acc} ${val}`, '');

        const allEmbeddings = await withRetry(async () => (await ollama.embed({ 
            model : summaryDefinitions.embed_model.model, 
            input : [summaryContent, denseContent, trajectoryContent],
            options: summaryDefinitions.embed_model.options
        })).embeddings);

        const [ convEmbedding, denseEmbedding, trajEmbedding ] = allEmbeddings;

        const fullAnchorData = this.#extractAnchorFeatures(
            summaryContent,
            { denseSummary : denseContent, trajectorySummary : trajectoryContent },
            { convEmbedding, denseEmbedding, trajEmbedding },
        );

        const verificationJson = await this.#getVerificationSummary(modelSummaryContext, fullAnchorData, { denseSummary, trajectorySummary });

        const verifierTrustScore = verificationJson?.trust_score ? verificationJson.trust_score : 0;
        const consistency = verificationJson?.consistency_between_summaries ? verificationJson.consistency_between_summaries : 0;

        const bestSummary = fullAnchorData.reliabilityDense >= fullAnchorData.reliabilityTraj ? denseSummaryObject : trajectorySummaryObject;

        const { U, S, P, T } = bestSummary;

        const anchorTrustScore = this.#calculateTrustScore(fullAnchorData, verifierTrustScore, consistency);

        const { anchorId, anchorStatus, anchorTime, resolutionAnchor } = await this.#addAnchor(
            anchorTrustScore, isLast, {
                dense : {
                    summary : denseSummaryObject,
                    keywords : [ ...fullAnchorData.kwDense ],
                    embeddings : denseEmbedding
                },

                trajectory : {
                    summary : trajectorySummaryObject,
                    keywords : [ ...fullAnchorData.kwTraj ],
                    embeddings : trajEmbedding
                }
            }, {
                turns : stripEventIds(summaryContext),
                keywords : [ ...fullAnchorData.kwConv ],
                embeddings : convEmbedding
            },
            finalResult
        );

        const compactTimeStamp = this.#compactTimestamp(anchorTime);

        const finalInjection = `
            [CTX_ANC_${anchorId}|STATUS:${anchorStatus}|RES_ANC:${!resolutionAnchor ? '-' : `A${resolutionAnchor}`}|SYS_TIME:${compactTimeStamp}]=[U:${U}][S:${S}][P:${P}][T:${T}]
        `.trim();

        if (anchorTrustScore >= 50) messages.push({role: 'system', eventId: `ctx-${anchorId}`, content:finalInjection});

        const prunedMessages = await this.#getContextMessages(messages, false, isLast);

        return prunedMessages;
    }
}