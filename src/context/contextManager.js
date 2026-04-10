export class ContextManager {
    constructor(agentName, master, maxRecentTurns = 15, maxAnchors = 5) {
        this.agentName = agentName;
        this.master = master;
        this.maxRecentTurns = maxRecentTurns;
        this.maxAnchors = maxAnchors;
        this.anchorSeq = 0;
        this.anchors = [];
        this.systemDirectives = {};
        this.pinnedUserIntent = {};
        this.pinnedToolHeader = {};

        this.clarityDirective = {
            role : 'system',
            name : 'system',
            eventId : 'sys-clarity-reminder',
            content : 'CLARITY: MAX internal density. Anchor refs by ID only. Accuracy > speed. No fluff.'
        };
    }

    setCore(initialMessages) {
        this.systemDirectives = { role : 'system', name: 'system', eventId : initialMessages[0].eventId, content : initialMessages[0].content };
        this.pinnedUserIntent = { role : 'user', name: this.master, eventId : initialMessages[1].eventId, content : initialMessages[1].content };
        this.pinnedToolHeader = { role : 'system', name: 'system', eventId : initialMessages[2].eventId, content : initialMessages[2].content };
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

        return this.anchorSeq;
    }

    getContextMessages(fullMessages) {
        const memPurgedMessages = fullMessages.filter(msg => msg?.eventId !== 'SYS-MEM');
        const recent = memPurgedMessages.slice(-this.maxRecentTurns);

        const visibleAnchorIds = recent.filter((x) => x.eventId.includes('ctx-')).map((i) => Number(i.eventId.slice(4)));
        const historyOnlyAnchors = this.anchors.filter((a) => !visibleAnchorIds.includes(a.id));

        const currentAnchorHistory = historyOnlyAnchors.slice(-this.maxAnchors);

        const memoryContent = `[CTX_MEM:${this.agentName} PRI:1U 2S 3A. ID route only. No halluc.] ` +
            currentAnchorHistory.map(a => `A${a.id}(${a.trustScore}):${a.summary}...`).join(' | ');
        
        const memoryAwareness = { role: 'system', name: 'system-context-memory', eventId: 'SYS-MEM', content: memoryContent };
        
        const curatedContext = currentAnchorHistory.length > 0 
            ? [this.systemDirectives, this.pinnedUserIntent, this.pinnedToolHeader, this.clarityDirective, memoryAwareness, ...recent] 
            : [this.systemDirectives, this.pinnedUserIntent, this.pinnedToolHeader, ...recent];

        const seen = new Set();
        return curatedContext.filter(msg => {
            const key = msg.eventId;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
}