export class ContextManager {
    constructor(agentName, maxRecentTurns = 12, maxAnchors = 4) {
        this.agentName = agentName;
        this.maxRecentTurns = maxRecentTurns;
        this.maxAnchors = maxAnchors;
        this.anchors = [];
        this.systemDirectives = '';
        this.pinnedUserIntent = '';
        this.pinnedToolHeader = '';

        this.clarityDirective = 'CLARITY: MAX internal density. Anchor refs by index only. Accuracy > speed. No fluff.';
    }

    setCore(initialMessages) {
        this.systemDirectives = initialMessages[0]?.content || '';
        this.pinnedUserIntent = initialMessages[1]?.content || '';
        this.pinnedToolHeader = initialMessages[2]?.content || '';
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
        const pinnedSystem = { role: 'system', name: 'S', content: this.systemDirectives };
        const pinnedUser = { role: 'user', name: 'U', content: this.pinnedUserIntent };
        const pinnedTool = { role: 'tool', name: 'S', content: this.pinnedToolHeader };
        const clarityMessage = { role: 'tool', name: 'CLARITY', content: this.clarityDirective };

        const anchorMessages = this.anchors.map(a => ({
            role: 'tool',
            name: `A${a.type[0]}`,
            content: `A${a.index}(${a.trustScore}):${a.summary.substring(0, 220)}`
        }));

        const memoryContent = `MEM:${this.agentName} Ldr. PRI:1U 2S 3A. Idx route. No halluc. ` +
            this.anchors.map((a, i) => `A${i}(${a.trustScore}):${a.summary.substring(0, 180)}...`).join(' | ');
        const memoryAwareness = { role: 'tool', name: 'MEM', content: memoryContent };

        const recent = fullMessages.slice(-this.maxRecentTurns);
        
        const curatedContext = [pinnedSystem, pinnedUser, pinnedTool, clarityMessage, ...anchorMessages, memoryAwareness, ...recent];

        const uniqueByRef = [...new Set(curatedContext)];
        const seen = new Set();
        
        return uniqueByRef.filter(msg => {
            const key = JSON.stringify(msg);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
}