import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { AnchorStore } from './anchorStore.js';
import { ContextStore } from './contextStore.js';

export class ContextManager {
    #agentName; #master; #convId;
    #systemDirectives; #pinnedUserIntent; #pinnedToolHeader;
    #maxRecentTurns; #maxAnchors;
    #anchorSeq; #startingAnchor;
    #anchorStore; #contextStore;
    #startingEmbed; #startingKeywords;
    #prevUserQuery; #keywordConfig;

    constructor(agentName, master, convId, sysDir, userInt, toolHead, seq, startEmbed, stores) {
        this.#agentName = agentName;
        this.#master = master;
        this.#convId = convId;

        this.#maxRecentTurns = 25;
        this.maxAnchors = 10;

        this.#anchorSeq = seq;

        this.#startingAnchor = null;
        this.#prevUserQuery = null;

        this.#systemDirectives = sysDir;
        this.#pinnedUserIntent = userInt;
        this.#pinnedToolHeader = toolHead;

        this.#startingEmbed = startEmbed;

        this.#anchorStore = stores.anchorStore;
        this.#contextStore = stores.contextStore;

        this.#keywordConfig = {
            minWordLength: 3,
            maxKeywordsPerText: 20,
            ngramMax: 3,
            tfThreshold: 1,
            coreStopWords: new Set([
                'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
                'by', 'from', 'up', 'into', 'over', 'after', 'before', 'is', 'are', 'was', 'were',
                'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
                'can', 'could', 'may', 'might', 'shall', 'should', 'must'
            ]),
            boostTerms: new Set()
        };

        const systemBoostTerms = this.#extractKeyTerms();
        this.#addBoostTerms(systemBoostTerms);

        this.#startingKeywords = this.#extractKeywords(this.#pinnedUserIntent);
    }

    static async init(dbUrl, embedDim, collectionName, agentName, master, convId, sysDir, userInt, toolHead, startEmbed) {
        const contextStore = new ContextStore(dbUrl, collectionName);
        const anchorStore = new AnchorStore(dbUrl, embedDim, collectionName);

        await contextStore.init();

        await anchorStore.init();
        const anchorSeq = await anchorStore.getCurrentSequenceId();

        const returnCtxManager = new ContextManager(
            agentName, master, convId, sysDir, userInt, toolHead, 
            anchorSeq, startEmbed, { contextStore, anchorStore }
        );

        return returnCtxManager;
    }

    async close() {
        try {
            if (this.#anchorStore) await this.#anchorStore.close();
            if (this.#contextStore) await this.#contextStore.close();  
        } catch (e) {}
    }

    #extractKeyTerms() {
        const text = `
            ${this.#master.toLowerCase()}
            ${this.#agentName.toLowerCase()}
            ${this.#systemDirectives.toLowerCase()}
            ${this.#pinnedToolHeader.toLowerCase()}
            ${this.#pinnedUserIntent.toLowerCase()}
        `;

        const tokens = text
            .replace(/[^\w\s'-]/g, ' ')
            .split(/\s+/)
            .map(t => t.trim())
            .filter(t => t.length >= 4);

        const candidates = new Set();

        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].length >= 5) {
                candidates.add(tokens[i]);
            }
            if (i < tokens.length - 1) {
                const bigram = `${tokens[i]} ${tokens[i + 1]}`;
                if (bigram.length >= 8) {
                    candidates.add(bigram);
                }
            }
        }

        const scored = Array.from(candidates).map(term => {
            const words = term.split(' ');
            let score = words.length;

            if (term.length > 12) score += 2;
            if (words.length === 2) score += 1.5;

            const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\b${escapedTerm.replace(/ /g, '\\s+')}\\b`, 'g');
            const occurrences = (text.match(regex) || []).length;

            if (occurrences > 1) score += 3;

            const generic = new Set(['your', 'task', 'role', 'you', 'will', 'must', 'should', 'can', 'help', 'user', 'respond']);
            if (words.some(w => generic.has(w))) score -= 1.5;

            return { term, score };
        });

        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, 12)
            .map(item => item.term);
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
        const tokens = text
            .replace(/[^\w\s'-]/g, ' ')
            .split(/\s+/)
            .map(t => t.trim())
            .filter(t => t.length >= this.#keywordConfig.minWordLength);

        const ngrams = new Set();

        for (let n = 1; n <= this.#keywordConfig.ngramMax; n++) {
            for (let i = 0; i <= tokens.length - n; i++) {
                const gram = tokens.slice(i, i + n).join(' ').trim();
                if (gram.length >= this.#keywordConfig.minWordLength) {
                    ngrams.add(gram);
                }
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

            if (isMultiWord) score *= 1.45;
            if (isEntityLike) score *= 1.25;
            if (hasNumber && words.length === 1) score *= 0.6;

            if (words.length === 1 && this.#keywordConfig.coreStopWords.has(phrase)) {
                score *= 0.25;
            }

            if (this.#keywordConfig.boostTerms.has(phrase)) {
                score *= 2.0;
            }

            return {
                phrase,
                score: Number(score.toFixed(4)),
                tf,
                length: words.length
            };
        }).sort((a, b) => b.score - a.score);
    }

    #rerankRecalledKeywords(recalledKwList, currentText) {
        if (!recalledKwList?.length) return [];

        let candidates = recalledKwList
            .filter(kw => kw && kw.length >= this.#keywordConfig.minWordLength)
            .filter(kw => !this.#keywordConfig.coreStopWords.has(kw.toLowerCase()));

        const scored = this.#scoreKeywords(candidates, currentText.toLowerCase().trim());

        const finalScored = scored.map(item => {
            let score = item.score;

            if (this.#keywordConfig.boostTerms.has(item.phrase)) {
                score *= 2.5;
            }

            if (this.#countOccurrences(this.#pinnedUserIntent.toLowerCase(), item.phrase) > 0) {
                score *= 1.8;
            }

            return { ...item, score: Number(score.toFixed(4)) };
        });

        return finalScored
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)
            .map(item => item.phrase);
    }

    #extractKeywords(text) {
        if (!text || typeof text !== 'string' || text.trim().length < 8) {
            return [];
        }

        const lowerText = text.toLowerCase().trim();
        const candidates = this.#generateNGrams(lowerText);
        const scoredKeywords = this.#scoreKeywords(candidates, lowerText);

        return scoredKeywords
            .filter(item => item.score > 0.5)
            .slice(0, this.#keywordConfig.maxKeywordsPerText)
            .map(item => item.phrase);
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

    #hashContent(c) {
        const contentForHash = JSON.stringify(c);
        return crypto.createHash('sha256').update(contentForHash).digest('hex').slice(0, 16);
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

    #buildContextSpace(recent, memories = null, keywords = null) {
        const sysCoreMessage = `
            SYSTEM DIRECTIVES (High priority):
            ${this.#systemDirectives}
            ${this.#pinnedToolHeader}

            MISSION / TASK / USER INTENT (High priority):
            ${this.#prevUserQuery ? `Previous user query: ${this.#prevUserQuery}` : ''}
            ${`Current user query: ${this.#pinnedUserIntent}`}

            ${keywords ? 'ACTIVE TOPICS / RELEVANT KEYWORDS:' : ''}
            ${keywords ? keywords.join(' - ') : ''}

            ${memories ? 'RECALLED MEMORIES / HISTORICAL ANCHORS:' : ''}
            ${memories ? memories.join('\n') : ''}

            Most recent context anchor available: ${this.#anchorSeq}
            Use any context anchors provided by the system to traverse and confirm the conversation flow.

            UNCOMPRESSED LATEST CONVERSATION MESSAGES:
        `;

        const curatedContext = [
            { role : 'system', eventId : 'SYS-CORE', content : sysCoreMessage }, 
            ...recent
        ];

        return curatedContext;
    }

    extractAnchorFeatures(context, embeddingData, summaryData) {
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
            kwDense, 
            kwTraj, 
            kwConv,

            denseSummary: summaryData.denseSummary,
            trajectorySummary: summaryData.trajectorySummary,

            jaccDense: Number((jaccDense * 100).toFixed(3)),
            jaccTraj: Number((jaccTraj * 100).toFixed(3)),

            simDense: Number((simDense * 100).toFixed(3)),
            simTraj: Number((simTraj * 100).toFixed(3)),
            simSelf: Number((simSelf * 100).toFixed(3)),

            reliabilityDense: Number((reliabilityDense * 100).toFixed(3)),
            reliabilityTraj: Number((reliabilityTraj * 100).toFixed(3))
        };
    }

    async addAnchor(trustScore, isLast, summaryData, rawData, result = null) {
        this.#anchorSeq++;

        if (!this.#startingAnchor) this.#startingAnchor = this.#anchorSeq;

        const anchorCreateTime = Date.now();
        const anchorStatus = isLast ? 'RESOLVED' : 'ACTIVE';
        const resolutionPointer = isLast ? this.#anchorSeq : null;

        await this.#anchorStore.insertAnchor({
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
        })

        return {
            anchorId: this.#anchorSeq,
            anchorStatus: anchorStatus,
            anchorTime: anchorCreateTime,
            resolutionAnchor: resolutionPointer
        };
    }

    async getContextMessages(fullMessages, isSummary = false, isLast = false) {
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

            return nameMappedMessages;
        };

        if (!fullMessages) {
            const restoredContext = await this.#contextStore.getLastSnapshot();

            if (!restoredContext.context || restoredContext.context?.length < 1 ) {
                return [
                    { role : 'system', eventId : 'SYS-CORE', content : `${this.#systemDirectives}\n${this.#pinnedToolHeader}` },
                    { role : 'user', eventId : crypto.randomUUID(), content : this.#pinnedUserIntent }
                ]
            }

            if (restoredContext.lastQuery) this.#prevUserQuery = restoredContext.lastQuery;

            fullMessages = restoredContext.context;
            fullMessages.push({ role : 'user', eventId : crypto.randomUUID(), content : this.#pinnedUserIntent })
        }

        if (isLast) await this.#anchorStore.resolveActiveAnchors(this.#startingAnchor, this.#anchorSeq);

        fullMessages = fullMessages.filter(msg => msg.eventId !== 'SYS-CORE');

        const anchorCount = () => fullMessages.filter(x => x.eventId.includes('ctx-')).length;
        const speakersCount = () => fullMessages.filter(x => x.role === 'user' || x.role === 'assistant').length;

        while (anchorCount() > this.#maxAnchors || speakersCount() > this.#maxRecentTurns) {
            const newMsgChunk = fullMessages.shift();

            const chunkKeywords = this.#extractKeywords(
                `${newMsgChunk.content ? newMsgChunk.content : ''} ${newMsgChunk.thinking ? newMsgChunk.thinking : ''}`
            );

            this.#addBoostTerms(chunkKeywords);
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
                }
            }
        };

        let curatedContext;

        const recalledAnchors = await this.#anchorStore.searchAnchors(this.#startingEmbed, this.#startingKeywords);

        if (recalledAnchors.length > 0) {
            const relevantMemories = recalledAnchors.map((m) => {
                const resAnc = !m.resolverData.resolutionAnchor ? '-' : `A${m.resolverData.resolutionAnchor}`
                const compactTimeStamp = (new Date(m.created).toLocaleString()).replaceAll(' ', '');

                const { U, S, P, T } = m.summary;

                return `[CTX_ANC_${m.id}|STATUS:${m.status}|RES_ANC:${resAnc}|SYS_TIME:${compactTimeStamp}]=[U:${U}][S:${S}][P:${P}][T:${T}]`;
            });

            const allRecalledKeywords = [...new Set((recalledAnchors.map(m => m.keywords)).flat())];

            const currentQueryText = this.#pinnedUserIntent + (this.#prevUserQuery ? ` ${this.#prevUserQuery}` : '');

            const relevantKeywords = this.#rerankRecalledKeywords(allRecalledKeywords, currentQueryText);

            curatedContext = this.#buildContextSpace(fullMessages, relevantMemories, relevantKeywords);
        } else {
            curatedContext = this.#buildContextSpace(fullMessages, null, null);
        }

        await this.#contextStore.newSnapshot(curatedContext, {
            lastQuery : this.#pinnedUserIntent
        });

        return curatedContext;
    }
}