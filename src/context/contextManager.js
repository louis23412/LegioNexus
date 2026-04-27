import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export class ContextManager {
    constructor(agentName, master, conversationFolder, sysDir, userInt, toolHead, maxRecentTurns = 25, maxAnchors = 10) {
        this.agentName = agentName;
        this.master = master;

        this.maxRecentTurns = maxRecentTurns;
        this.maxAnchors = maxAnchors;

        this.anchorSeq = 0;
        this.anchors = [];

        this.startingAnchor = null;
        this.prevUserQuery = null;

        this.systemDirectives = sysDir;
        this.pinnedUserIntent = userInt;
        this.pinnedToolHeader = toolHead;

        const anchorsFolder = path.join(conversationFolder, 'anchors');
        if (!fs.existsSync(anchorsFolder)) fs.mkdirSync(anchorsFolder);

        this.anchorsFile = path.join(anchorsFolder, `${agentName}.json`);

        const contextFolder = path.join(conversationFolder, 'context');
        if (!fs.existsSync(contextFolder)) fs.mkdirSync(contextFolder);

        const agentCtxFolder = path.join(contextFolder, agentName);
        if (!fs.existsSync(agentCtxFolder)) fs.mkdirSync(agentCtxFolder);

        this.contextFolder = agentCtxFolder;

        this.#loadAnchors();
    }

    #loadAnchors() {
        try {
            const data = fs.readFileSync(this.anchorsFile, 'utf8');

            const anchorData = JSON.parse(data);

            this.anchors = anchorData.anchors;
            this.anchorSeq = anchorData.anchorSeq;
        } 
        catch (err) { this.anchors = []; this.anchorSeq = 0; }
    }

    #saveAnchors() {
        const saveObj = {
            anchorSeq : this.anchorSeq,
            anchors : this.anchors
        }

        try { fs.writeFileSync(this.anchorsFile, JSON.stringify(saveObj, null, 2), 'utf8'); } 
        catch (err) {}
    }

    #saveContext(latestContext) {
        const agentContextSpace = {
            csId : crypto.randomUUID(),
            lastQuery : this.pinnedUserIntent,
            contextSpace : latestContext
        }

        const fileName = `${this.master}-${this.agentName}.json`;
        const fileToWrite = path.join(this.contextFolder, fileName);

        try { fs.writeFileSync(fileToWrite, JSON.stringify(agentContextSpace, null, 2), 'utf8'); } 
        catch (err) {}
    }

    #extractAnchorInfo(str) {
        const regex = /\[CTX_ANC_(\d+)\|STATUS:([A-Z_]+)\|RES_ANC:([A-Z0-9-]+)\|/;

        const match = str.match(regex);

        return {
            anchorId: match[1],
            status: match[2],
            resolutionAnchor: match[3]
        };
    }

    #resolveActiveAnchors() {
        if (!this.startingAnchor) return;

        const startIndex = this.startingAnchor - 1;
        if (startIndex < 0 || startIndex >= this.anchors.length) {
            this.#saveAnchors();
            return;
        }

        const anchorsToUpdate = this.anchors.slice(startIndex);

        for (const anc of anchorsToUpdate) {
            anc.status = 'RESOLVED';
            anc.resolutionAnchor = this.anchorSeq;
        }

        this.anchors.length = startIndex;
        this.anchors.push(...anchorsToUpdate);

        this.#saveAnchors();
    }

    addAnchor(summary, trustScore, type, isLast, summaryData, result = null) {
        this.anchorSeq++;

        if (!this.startingAnchor) this.startingAnchor = this.anchorSeq;

        const anchorCreateTime = Date.now();
        const anchorStatus = isLast ? 'RESOLVED' : 'ACTIVE';
        const resolutionPointer = isLast ? this.anchorSeq : null;

        const entry = {
            type,
            status : anchorStatus,
            trustScore: Math.max(0, Math.min(100, trustScore)),
            timestamp: anchorCreateTime,
            id: this.anchorSeq,
            resolutionAnchor: resolutionPointer,
            summary: summary.trim(),
            queryAndResult : isLast ? { query : this.pinnedUserIntent, result } : null,
            summaryData
        };

        this.anchors.push(entry);

        this.#saveAnchors();

        return { 
            anchorId : this.anchorSeq,
            anchorStatus : anchorStatus,
            anchorTime : anchorCreateTime,
            resolutionAnchor : resolutionPointer
        };
    }

    getStarterContext() {
        let startingContext = null;

        try {
            const fileName = `${this.master}-${this.agentName}.json`;
            const fileToRead = path.join(this.contextFolder, fileName);

            const data = fs.readFileSync(fileToRead, 'utf8');

            startingContext = JSON.parse(data);
        } 
        catch (err) { startingContext = null }

        if (!startingContext) {
            const freshContext = this.getContextMessages(null, false, false);
            return freshContext;
        }

        const restoredContext = startingContext.contextSpace;

        this.prevUserQuery = startingContext.lastQuery

        restoredContext.push({
            role : 'user',
            eventId : crypto.randomUUID(),
            content : this.pinnedUserIntent
        })

        const finalReturnContext = this.getContextMessages(restoredContext, false, false);

        return finalReturnContext;
    }

    getContextMessages(fullMessages, isSummary = false, isLast = false) {
        if (isSummary) {
            const fullPurgedMessages = fullMessages.filter(msg => {
                if (msg?.eventId === 'SYS-CORE' || msg?.eventId === 'SYS-MEM' || msg?.eventId?.includes('ctx-')) {
                    return false;
                }

                return true;
            })

            return fullPurgedMessages.slice(-this.maxRecentTurns);
        }

        const starterCore = {
            role : 'system',
            eventId : 'SYS-CORE',
            content : `SYS-REMINDER:\n${this.systemDirectives}\n${this.pinnedToolHeader}${this.prevUserQuery ? `\nPrevious user query:${this.prevUserQuery}` : ''}\nCurrent user query:\n${this.pinnedUserIntent}`
        }

        if (!fullMessages) { 
            return [
                starterCore,
                {
                    role : 'user',
                    eventId : crypto.randomUUID(),
                    content : this.pinnedUserIntent
                }
            ] 
        };

        const sysPurgedMessages = fullMessages.filter(msg => {
            if (
                msg?.eventId === 'SYS-CORE' || msg?.eventId === 'SYS-MEM'
            ) { return false }

            return true;
        });

        const recent = sysPurgedMessages.slice(-this.maxRecentTurns);

        const visibleAnchorIds = recent.filter((x) => x.eventId.includes('ctx-')).map((i) => Number(i.eventId.slice(4)));
        const historyOnlyAnchors = this.anchors.filter((a) => !visibleAnchorIds.includes(a.id));

        const currentAnchorHistory = historyOnlyAnchors.slice(-this.maxAnchors);

        if (isLast) this.#resolveActiveAnchors();

        for (const msg of recent) {
            if (msg.eventId.includes('ctx-')) {
                const anchorInfo = this.#extractAnchorInfo(msg.content);
                const actualAnchorData = this.anchors[anchorInfo.anchorId - 1];

                if (anchorInfo.status !== actualAnchorData.status) {
                    msg.content = msg.content.replace(
                        `STATUS:${anchorInfo.status}|RES_ANC:${anchorInfo.resolutionAnchor}`,
                        `STATUS:${actualAnchorData.status}|RES_ANC:A${actualAnchorData.resolutionAnchor}`
                    )
                }
            }
        }

        const memoryContent = `[CTX_MEM:${this.agentName} PRI:1U 2S 3A. ID route only] ` +
            currentAnchorHistory.map(a => `A${a.id}(${a.trustScore}):${a.summary}`).join('|');
        
        const memoryAwareness = { role: 'system', eventId: 'SYS-MEM', content: memoryContent };
        
        const curatedContext = currentAnchorHistory.length > 0 
            ? [starterCore, memoryAwareness, ...recent] 
            : [starterCore, ...recent];

        this.#saveContext(curatedContext);

        return curatedContext;
    }
}