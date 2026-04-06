export class ContextManager {
    constructor(agentName, maxRecentTurns = 12, maxAnchors = 4) {
        this.agentName = agentName;
        this.maxRecentTurns = maxRecentTurns;
        this.maxAnchors = maxAnchors;
        this.anchors = [];
    }

    estimateTokens(messages) {
        return Math.ceil(messages.reduce((acc, msg) => {
            let content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || {});
            const multiplier = (msg.role === 'tool' || msg.name?.includes('anchor') || msg.name?.includes('memory')) ? 1.5 : 1.0;

            return acc + (content.length / 3.7) * multiplier;
        }, 0));
    }

    addAnchor(summary, trustScore, type = 'ultra-dense') {
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

    pruneAndCompact(messages) {
        const tokenCount = this.estimateTokens(messages);
        if (tokenCount < 9000) return messages;

        console.log(`\x1b[33m[CONTEXT MANAGER] ${this.agentName} - pruning (${messages.length} msgs / ~${tokenCount} tokens)\x1b[0m`);

        const system = messages[0];
        const recent = messages.slice(-this.maxRecentTurns);

        const memoryAwareness = {
            role: 'tool',
            name: 'memory_surface',
            content: `MEMORY_SURFACE (H-MEM 2026 PROTOCOL):\n` +
                `You have full indexed read access to the following hierarchical anchors.\n` +
                `Use index-based routing when referencing.\n` +
                this.anchors.map((a, i) => 
                    `[${a.index}] ${a.type.toUpperCase()} (trust ${a.trustScore}/100): ${a.summary.substring(0, 280)}...`
                ).join('\n') + 
                `\nNever hallucinate missing context. Reference by index or type when needed.
            `
        };

        return [
            system,
            ...this.anchors.map(a => ({
                role: 'tool',
                name: `context_anchor_${a.type}`,
                content: `ANCHOR [${a.type}] (trust ${a.trustScore}/100) [index ${a.index}]: ${a.summary}`
            })),
            memoryAwareness,
            ...recent
        ];
    }
}