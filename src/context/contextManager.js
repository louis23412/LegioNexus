import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export class ContextManager {
    #agentName; #master;
    #maxRecentTurns; #maxAnchors;
    #anchorSeq; #anchors;
    #startingAnchor; #prevUserQuery;
    #systemDirectives; #pinnedUserIntent; #pinnedToolHeader;
    #keywordConfig;
    #anchorsFile; #contextFolder;

    constructor(agentName, master, conversationFolder, sysDir, userInt, toolHead, maxRecentTurns = 25, maxAnchors = 10) {
        this.#agentName = agentName;
        this.#master = master;

        this.#maxRecentTurns = maxRecentTurns;
        this.maxAnchors = maxAnchors;

        this.#anchorSeq = 0;
        this.#anchors = [];

        this.#startingAnchor = null;
        this.#prevUserQuery = null;

        this.#systemDirectives = sysDir;
        this.#pinnedUserIntent = userInt;
        this.#pinnedToolHeader = toolHead;

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

        const anchorsFolder = path.join(conversationFolder, 'anchors');
        if (!fs.existsSync(anchorsFolder)) fs.mkdirSync(anchorsFolder);

        this.#anchorsFile = path.join(anchorsFolder, `${this.#agentName}.json`);

        const contextFolder = path.join(conversationFolder, 'context');
        if (!fs.existsSync(contextFolder)) fs.mkdirSync(contextFolder);

        const agentCtxFolder = path.join(contextFolder, this.#agentName);
        if (!fs.existsSync(agentCtxFolder)) fs.mkdirSync(agentCtxFolder);

        this.#contextFolder = agentCtxFolder;

        this.#loadAnchors();
    }

    #loadAnchors() {
        try {
            const data = fs.readFileSync(this.#anchorsFile, 'utf8');
            const anchorData = JSON.parse(data);
            this.#anchors = anchorData.anchors;
            this.#anchorSeq = anchorData.anchorSeq;
        } catch (err) {
            this.#anchors = [];
            this.#anchorSeq = 0;
        }
    }

    #saveAnchors() {
        const saveObj = {
            anchorSeq: this.#anchorSeq,
            anchors: this.#anchors
        };
        try {
            fs.writeFileSync(this.#anchorsFile, JSON.stringify(saveObj, null, 2), 'utf8');
        } catch (err) {}
    }

    #saveContext(latestContext) {
        const agentContextSpace = {
            csId: crypto.randomUUID(),
            lastQuery: this.#pinnedUserIntent,
            contextSpace: latestContext
        };

        const fileName = `${this.#master}-${this.#agentName}.json`;
        const fileToWrite = path.join(this.#contextFolder, fileName);

        try {
            fs.writeFileSync(fileToWrite, JSON.stringify(agentContextSpace, null, 2), 'utf8');
        } catch (err) {}
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

    #resolveActiveAnchors() {
        if (!this.#startingAnchor) return;

        const startIndex = this.#startingAnchor - 1;
        if (startIndex < 0 || startIndex >= this.#anchors.length) {
            this.#saveAnchors();
            return;
        }

        const anchorsToUpdate = this.#anchors.slice(startIndex);

        for (const anc of anchorsToUpdate) {
            anc.status = 'RESOLVED';
            anc.resolutionAnchor = this.#anchorSeq;
        }

        this.#anchors.length = startIndex;
        this.#anchors.push(...anchorsToUpdate);

        this.#saveAnchors();
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

    addAnchor(trustScore, isLast, summaryData, rawData, result = null) {
        this.#anchorSeq++;

        if (!this.#startingAnchor) this.#startingAnchor = this.#anchorSeq;

        const anchorCreateTime = Date.now();
        const anchorStatus = isLast ? 'RESOLVED' : 'ACTIVE';
        const resolutionPointer = isLast ? this.#anchorSeq : null;

        const entry = {
            id: this.#anchorSeq,
            timestamp: anchorCreateTime,
            status: anchorStatus,
            trustScore: Math.max(0, Math.min(100, trustScore)),
            isResolver: isLast,
            resolutionAnchor: resolutionPointer,
            queryAndResult: isLast ? { query: this.#pinnedUserIntent, result } : null,

            summaryData: {
                dense: {
                    summary: summaryData.dense.summary,
                    hash: this.#hashContent(summaryData.dense.summary),
                    keywords: summaryData.dense.keywords,
                    embeddings: summaryData.dense.embeddings
                },
                trajectory: {
                    summary: summaryData.trajectory.summary,
                    hash: this.#hashContent(summaryData.trajectory.summary),
                    keywords: summaryData.trajectory.keywords,
                    embeddings: summaryData.trajectory.embeddings
                }
            },

            rawData: {
                turns: rawData.turns,
                keywords: rawData.keywords,
                embeddings: rawData.embeddings
            }
        };

        this.#anchors.push(entry);
        this.#saveAnchors();

        return {
            anchorId: this.#anchorSeq,
            anchorStatus: anchorStatus,
            anchorTime: anchorCreateTime,
            resolutionAnchor: resolutionPointer
        };
    }

    getStarterContext() {
        let startingContext = null;

        try {
            const fileName = `${this.#master}-${this.#agentName}.json`;
            const fileToRead = path.join(this.#contextFolder, fileName);
            const data = fs.readFileSync(fileToRead, 'utf8');
            startingContext = JSON.parse(data);
        } catch (err) {
            startingContext = null;
        }

        if (!startingContext) {
            return this.getContextMessages(null, false, false);
        }

        const restoredContext = startingContext.contextSpace;
        this.#prevUserQuery = startingContext.lastQuery;

        restoredContext.push({
            role: 'user',
            eventId: crypto.randomUUID(),
            content: this.#pinnedUserIntent
        });

        return this.getContextMessages(restoredContext, false, false);
    }

    getContextMessages(fullMessages, isSummary = false, isLast = false) {
        if (isSummary) {
            const fullPurgedMessages = fullMessages.filter(msg => {
                if (msg?.eventId === 'SYS-CORE' || msg?.eventId === 'SYS-MEM' || msg?.eventId?.includes('ctx-')) {
                    return false;
                }
                return true;
            });
            return fullPurgedMessages.slice(-this.#maxRecentTurns);
        }

        const starterCore = {
            role: 'system',
            eventId: 'SYS-CORE',
            content: `SYS-REMINDER:\n${this.#systemDirectives}\n${this.#pinnedToolHeader}${this.#prevUserQuery ? `\nPrevious user query:${this.#prevUserQuery}` : ''}\nCurrent user query:\n${this.#pinnedUserIntent}`
        };

        if (!fullMessages) {
            return [
                starterCore,
                {
                    role: 'user',
                    eventId: crypto.randomUUID(),
                    content: this.#pinnedUserIntent
                }
            ];
        }

        const sysPurgedMessages = fullMessages.filter(msg => {
            if (msg?.eventId === 'SYS-CORE' || msg?.eventId === 'SYS-MEM') return false;
            return true;
        });

        const recent = sysPurgedMessages.slice(-this.#maxRecentTurns);

        const visibleAnchorIds = recent
            .filter(x => x.eventId.includes('ctx-'))
            .map(i => Number(i.eventId.slice(4)));

        const historyOnlyAnchors = this.#anchors.filter(a => !visibleAnchorIds.includes(a.id));
        const currentAnchorHistory = historyOnlyAnchors.slice(-this.maxAnchors);

        if (isLast) this.#resolveActiveAnchors();

        for (const msg of recent) {
            if (msg.eventId.includes('ctx-')) {
                const anchorInfo = this.#extractCurrentAnchorStatus(msg.content);
                if (anchorInfo && anchorInfo.anchorId) {
                    const actualAnchorData = this.#anchors[anchorInfo.anchorId - 1];
                    if (actualAnchorData && anchorInfo.status !== actualAnchorData.status) {
                        msg.content = msg.content.replace(
                            `STATUS:${anchorInfo.status}|RES_ANC:${anchorInfo.resolutionAnchor}`,
                            `STATUS:${actualAnchorData.status}|RES_ANC:A${actualAnchorData.resolutionAnchor}`
                        );
                    }
                }
            }
        }

        const memoryContent = `[CTX_MEM:${this.#agentName} PRI:1U 2S 3A. ID route only] ` +
            currentAnchorHistory.map(a => `A${a.id}(${a.trustScore}):${JSON.stringify(a.summaryData?.dense?.summary || {})}`).join('|');

        const memoryAwareness = { role: 'system', eventId: 'SYS-MEM', content: memoryContent };

        const curatedContext = currentAnchorHistory.length > 0
            ? [starterCore, memoryAwareness, ...recent]
            : [starterCore, ...recent];

        this.#saveContext(curatedContext);

        return curatedContext;
    }
}