import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export class ContextManager {
    constructor(agentName, master, conversationFolder, maxRecentTurns = 25, maxAnchors = 10) {
        this.agentName = agentName;
        this.master = master;

        this.maxRecentTurns = maxRecentTurns;
        this.maxAnchors = maxAnchors;

        this.anchorSeq = 0;
        this.anchors = [];

        this.systemDirectives = '';
        this.pinnedUserIntent = '';
        this.pinnedToolHeader = '';

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
            tokenSize : this.estimateTokens(this.stripEventIds(latestContext)),
            contextSpace : latestContext
        }

        const fileName = `${this.master}-${this.agentName}.json`;
        const fileToWrite = path.join(this.contextFolder, fileName);

        try { fs.writeFileSync(fileToWrite, JSON.stringify(agentContextSpace, null, 2), 'utf8'); } 
        catch (err) {}
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
            const freshContext = this.getContextMessages(null);
            return freshContext;
        }

        const restoredContext = startingContext.contextSpace;

        restoredContext.push({
            role : 'user',
            eventId : crypto.randomUUID(),
            content : this.pinnedUserIntent
        })

        const finalReturnContext = this.getContextMessages(restoredContext);
        return finalReturnContext;
    }

    stripEventIds(messagesArray) {
        return messagesArray.map(msg => {
            if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
                const { eventId, ...cleanMsg } = msg;
                return cleanMsg;
            }
            return msg;
        });
    }

    setCore(sysDir, userInt, toolHead) {
        this.systemDirectives = sysDir;
        this.pinnedUserIntent = userInt;
        this.pinnedToolHeader = toolHead;
    }

    estimateTokens(messages) {
        return Math.ceil(messages.reduce((acc, msg) => {
            let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || {});
            const multiplier = (msg.role === 'tool' || msg.name?.includes('anchor') || msg.name?.includes('memory')) ? 1.5 : 1.0;
            return acc + (content.length / 3.7) * multiplier;
        }, 0));
    }

    addAnchor(summary, trustScore, type = 'dense') {
        this.anchorSeq++;

        const entry = {
            type,
            summary: summary.trim(),
            trustScore: Math.max(0, Math.min(100, trustScore)),
            timestamp: Date.now(),
            id: this.anchorSeq
        };

        this.anchors.push(entry);

        this.#saveAnchors();

        return this.anchorSeq;
    }

    getContextMessages(fullMessages) {
        const starterCore = {
            role : 'system',
            eventId : 'SYS-CORE',
            content : `SYS-REMINDER:\n${this.systemDirectives}\n${this.pinnedToolHeader}\nUser query:\n${this.pinnedUserIntent}`
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

        const memoryContent = `[CTX_MEM:${this.agentName} PRI:1U 2S 3A. ID route only] ` +
            currentAnchorHistory.map(a => `A${a.id}(${a.trustScore}):${a.summary}`).join('|');
        
        const memoryAwareness = { role: 'system', eventId: 'SYS-MEM', content: memoryContent };
        
        const curatedContext = currentAnchorHistory.length > 0 
            ? [starterCore, memoryAwareness, ...recent] 
            : [starterCore, ...recent];

        const seen = new Set();

        const returnContext = curatedContext.filter(msg => {
            const key = msg.eventId;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        this.#saveContext(returnContext);

        return returnContext;
    }
}