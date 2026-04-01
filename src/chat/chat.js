export class Chatroom {
    constructor(sizeLimit = 200) {
        this.log = [];
        this.reactions = {};
        this.sizeLimit = sizeLimit;
        this.onPersist = null;
    }

    add(speaker, content, metadata = {}) {
        const entry = {
            id: `msg_${Date.now()}_${Math.floor(Math.random() * 9999)}`,
            timestamp: new Date().toISOString(),
            speaker,
            content: String(content),
            ...metadata,
            topic: metadata.topic ?? 'main'
        };
        this.log.push(entry);

        if (this.log.length > this.sizeLimit) {
            this.log = this.log.slice(-this.sizeLimit);
        }

        if (this.onPersist) this.onPersist(this.getStatusSummary());
        return this;
    }

    addReaction(messageId, emoji, reactor) {
        if (!this.reactions[messageId]) this.reactions[messageId] = [];
        this.reactions[messageId].push({ emoji, reactor, timestamp: new Date().toISOString() });
        return true;
    }

    searchMessages(keyword, { speakerFilter, topicFilter, limit = 10 } = {}) {
        if (!keyword) return [];
        const lower = keyword.toLowerCase();
        return this.log
            .filter(e => 
                (!speakerFilter || e.speaker === speakerFilter) &&
                (!topicFilter || e.topic === topicFilter) &&
                (e.content.toLowerCase().includes(lower) || e.speaker.toLowerCase().includes(lower))
            )
            .slice(0, limit);
    }

    getMessagesByTopic(topic) {
        if (!topic) return this.log;
        return this.log.filter(e => e.topic === topic);
    }

    getFormattedChatMessages(topic = null, maxMessages = 20) {
        const msgs = topic ? this.getMessagesByTopic(topic) : this.log;
        const recentMsgs = msgs.slice(-maxMessages);
        if (recentMsgs.length === 0) {
            return '=== CLEAN CHATROOM (no messages) ===';
        }
        return recentMsgs
            .map(e => `${e.speaker}: ${e.content.trim()}`)
            .join('\n\n');
    }

    getP2PContext(topic = null, maxMessages = 5) {
        const msgs = topic ? this.getMessagesByTopic(topic) : this.log;
        const recentMsgs = msgs.slice(-maxMessages);
        if (recentMsgs.length === 0) {
            return 'No prior context.';
        }
        return recentMsgs
            .map(e => `${e.speaker}: ${e.content.trim()}`)
            .join('\n\n');
    }

    getHistory(topic = null) {
        const filtered = topic ? this.getMessagesByTopic(topic) : this.log;
        if (filtered.length === 0) {
            return `=== TEAM CHATROOM HISTORY${topic ? ` (TOPIC: ${topic})` : ''} ===\n(No messages yet)\n=== END OF HISTORY ===\n\n`;
        }

        const formatted = filtered
            .map(e => `[${e.speaker}]: ${e.content}`)
            .join('\n\n');

        const header = topic ? `=== TEAM CHATROOM HISTORY (TOPIC: ${topic}) ===` : '=== TEAM CHATROOM HISTORY ===';
        return `${header}\n${formatted}\n\n=== END OF HISTORY ===\n\n`;
    }

    getCompressedSummary(topic = null) {
        const filtered = topic ? this.getMessagesByTopic(topic) : this.log;
        if (filtered.length === 0) {
            return `=== CHATROOM COMPRESSED SUMMARY${topic ? ` (TOPIC: ${topic})` : ''} ===\n(No messages yet)\n=== END COMPRESSED SUMMARY ===\n\n`;
        }

        const summary = this.getStatusSummary(topic);

        let compressed = `=== CHATROOM COMPRESSED SUMMARY${topic ? ` (TOPIC: ${topic})` : ''} ===\n`;
        compressed += `Total messages: ${summary.totalMessages}\n`;
        compressed += `Consulted members: ${summary.consultedMembers.join(', ')}\n\n`;
        compressed += `Recent activity:\n`;
        compressed += summary.recentActivity.join('\n') + '\n\n';
        compressed += `Note: Call get_team_status(use_summary=false${topic ? `, topic="${topic}"` : ''}) for full detailed history if critical.\n`;
        compressed += `=== END COMPRESSED SUMMARY ===\n\n`;

        return compressed;
    }

    getStatusSummary(topic = null) {
        const filtered = topic ? this.getMessagesByTopic(topic) : this.log;
        const consulted = [...new Set(filtered.map(e => e.speaker))];
        return {
            totalMessages: filtered.length,
            consultedMembers: consulted,
            recentActivity: filtered.slice(-3).map(e => `${e.speaker}: ${e.content.substring(0, 80)}...`),
            reactionsCount: Object.keys(this.reactions).length,
            topic: topic || 'all'
        };
    }

    clear() {
        this.log = [];
        this.reactions = {};
    }
}