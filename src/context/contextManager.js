export class ContextManager {
    constructor(agentName, maxRecentTurns = 12, maxAnchors = 4) {
        this.agentName = agentName;
        this.maxRecentTurns = maxRecentTurns;
        this.maxAnchors = maxAnchors;
        this.anchors = [];
        this.systemDirectives = {};
        this.pinnedUserIntent = {};
        this.pinnedToolHeader = {};

        this.clarityDirective = {
            role : 'system',
            content : 'CLARITY: MAX internal density. Anchor refs by index only. Accuracy > speed. No fluff.'
        };
    }

    setCore(initialMessages) {
        this.systemDirectives = { role : 'system', eventId : initialMessages[0].eventId, content : initialMessages[0].content };
        this.pinnedUserIntent = { role : 'user', eventId : initialMessages[1].eventId, content : initialMessages[1].content };
        this.pinnedToolHeader = { role : 'system', eventId : initialMessages[2].eventId, content : initialMessages[2].content };
    }

    estimateTokens(messages) {
        return Math.ceil(messages.reduce((acc, msg) => {
            let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || {});
            const multiplier = (msg.role === 'tool' || msg.name?.includes('anchor') || msg.name?.includes('memory')) ? 1.5 : 1.0;
            return acc + (content.length / 3.7) * multiplier;
        }, 0));
    }

    addAnchor(summary, trustScore, type = 'dense') {
        const entry = {
            type,
            summary: summary.trim(),
            trustScore: Math.max(0, Math.min(100, trustScore)),
            timestamp: Date.now(),
            index: this.anchors.length
        };

        this.anchors.push(entry);

        if (this.anchors.length > this.maxAnchors) {
            this.anchors.sort((a, b) => (b.trustScore - a.trustScore) || (b.timestamp - a.timestamp));
            this.anchors.pop();
        }
    }

    getContextMessages(fullMessages) {
        const memPurgedMessages = fullMessages.filter(msg => msg?.name !== 'MEM');
        const recent = memPurgedMessages.slice(-this.maxRecentTurns);

        const memoryContent = `MEM:${this.agentName} Ldr. PRI:1U 2S 3A. Idx route. No halluc. ` +
            this.anchors.map((a, i) => `A${i}(${a.trustScore}):${a.summary}...`).join(' | ');
        const memoryAwareness = { role: 'system', eventId: 'SYS-MEM', content: memoryContent };
        
        const curatedContext = this.anchors.length > 0 
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