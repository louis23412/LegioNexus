export class Chatroom {
    constructor(sizeLimit) {
        this.messages = [];
        this.reactions = new Map();
        this.threads = new Map();
        this.topics = new Set(['general']);
        this.sizeLimit = sizeLimit;
        this.currentTopic = 'general';
        this.onPersist = null;
    }

    sendMessage(speaker, content, options = {}) {
        const message = {
            id: `msg_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
            timestamp: new Date().toISOString(),
            speaker: String(speaker).trim(),
            content: String(content).trim(),
            topic: options.topic || this.currentTopic,
            replyTo: options.replyTo || null,
            type: options.type || 'text',
            metadata: options.metadata || {},
            edited: false,
            deleted: false
        };

        this.messages.push(message);
        if (this.messages.length > this.sizeLimit) {
            this.messages.shift();
        }

        if (message.replyTo) {
            if (!this.threads.has(message.replyTo)) this.threads.set(message.replyTo, []);
            this.threads.get(message.replyTo).push(message.id);
        }

        if (options.topic && !this.topics.has(options.topic)) {
            this.topics.add(options.topic);
        }

        if (this.onPersist) this.onPersist(this.getStatusSummary());
        return message;
    }

    deleteMessage(messageId, deleter) {
        const index = this.messages.findIndex(m => m.id === messageId);
        if (index === -1) return { success: false, reason: 'Message not found' };

        const msg = this.messages[index];
        if (deleter !== 'team-leader' && msg.speaker !== deleter) {
            return { success: false, reason: 'Permission denied' };
        }

        this.messages.splice(index, 1);
        this.reactions.delete(messageId);
        if (this.threads.has(messageId)) this.threads.delete(messageId);

        return { success: true, deletedBy: deleter, messageId };
    }

    addReaction(messageId, emoji, reactor) {
        if (!this.reactions.has(messageId)) {
            this.reactions.set(messageId, {});
        }
        const msgReactions = this.reactions.get(messageId);
        if (!msgReactions[emoji]) msgReactions[emoji] = [];
        
        msgReactions[emoji].push({
            reactor: String(reactor),
            timestamp: new Date().toISOString()
        });
        return true;
    }

    search(options = {}) {
        const { keyword, speaker, topic, since, until, replyTo, limit = 30 } = options;
        let results = [...this.messages].filter(m => !m.deleted);

        if (keyword) {
            const lower = keyword.toLowerCase();
            results = results.filter(m => 
                m.content.toLowerCase().includes(lower) || 
                m.speaker.toLowerCase().includes(lower)
            );
        }
        if (speaker) results = results.filter(m => m.speaker.toLowerCase() === speaker.toLowerCase());
        if (topic) results = results.filter(m => m.topic === topic);
        if (since) {
            const sinceDate = new Date(since);
            results = results.filter(m => new Date(m.timestamp) >= sinceDate);
        }
        if (until) {
            const untilDate = new Date(until);
            results = results.filter(m => new Date(m.timestamp) <= untilDate);
        }
        if (replyTo) results = results.filter(m => m.replyTo === replyTo);

        return results.slice(-limit).reverse();
    }

    getChatView(topic = null, limit = 40) {
        let msgs = topic ? this.messages.filter(m => m.topic === topic && !m.deleted) : this.messages.filter(m => !m.deleted);
        msgs = msgs.slice(-limit);

        if (msgs.length === 0) return '=== CHATROOM IS EMPTY - Start chatting! ===';

        let output = `=== TEAM CHATROOM ${topic ? `(${topic.toUpperCase()})` : '(GENERAL)'} ===\n\n`;

        msgs.forEach(msg => {
            const time = new Date(msg.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
            let line = `[${time}] ${msg.speaker}: ${msg.content}`;

            if (msg.replyTo) line = `  ↳ ${line}`;
            if (msg.edited) line += ' (edited)';

            if (this.reactions.has(msg.id)) {
                const reacts = this.reactions.get(msg.id);
                const reactSummary = Object.entries(reacts)
                    .map(([emoji, users]) => `${emoji}(${users.length})`)
                    .join(' ');
                if (reactSummary) line += `  ${reactSummary}`;
            }
            output += line + '\n';
        });

        output += `\n=== END OF CHAT (${msgs.length} messages shown) ===`;
        return output;
    }

    getStatusSummary(topic = null) {
        const filtered = topic ? this.messages.filter(m => m.topic === topic && !m.deleted) : this.messages.filter(m => !m.deleted);
        const consulted = [...new Set(filtered.map(e => e.speaker))];
        return {
            totalMessages: filtered.length,
            activeTopics: Array.from(this.topics),
            consultedMembers: consulted,
            reactionsCount: this.reactions.size,
            topic: topic || 'all'
        };
    }

    clear() {
        this.messages = [];
        this.reactions.clear();
        this.threads.clear();
    }

    dump() {
        return this.messages
    }
}