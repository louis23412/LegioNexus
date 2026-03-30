// ====================== chat.js ======================
/**
 * Chatroom Module
 * Purpose: Manages the shared team chatroom (unified memory and communication hub)
 *          for the entire multi-agent collaboration system.
 *
 * Enhancements added:
 * - Timestamps + unique message IDs on every entry
 * - Auto-pruning with configurable size limit (default 200) to prevent memory/context bloat
 * - Emoji reactions support (addReaction)
 * - Keyword-based message search/filtering (searchMessages) - enables "search if needed"
 * - Basic threading support via metadata
 * - Persistence hook (onPersist callback for DB/file integration)
 * - Improved getStatusSummary with extra metrics
 * - All original method signatures & exact output formats preserved for 100% behavioral compatibility
 * - NEW: Full topic/thread support (default 'main', easy search by topic)
 * - NEW: getFormattedChatMessages - returns clean "Speaker: direct final answer" only (eliminates bloat)
 * - General speed ups: limit recent messages in formatted view, filtered operations on small arrays
 * - NEW: getP2PContext(topic, maxMessages=5) - short recent context snippet exclusively for P2P side channels.
 *   This keeps side conversations context-aware and meaningfully tied to the main thread while preventing
 *   circular loops, repeated questions, and context bloat. Only the most recent messages are passed.
 * - 4-space indentation throughout
 */

export class Chatroom {
    constructor(sizeLimit = 200) {
        this.log = [];
        this.reactions = {}; // messageId -> reactions
        this.sizeLimit = sizeLimit;
        this.onPersist = null; // optional callback for persistence
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

        // Auto-prune to enforce size limit
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

    // Enhanced: now supports topicFilter
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

    // NEW: Topic/Thread support
    getMessagesByTopic(topic) {
        if (!topic) return this.log;
        return this.log.filter(e => e.topic === topic);
    }

    // NEW: Clean bloat-free formatter (exactly what was requested)
    // Only "Speaker: direct clean final answer" - no long explanations
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

    // NEW ENHANCEMENT FOR THIS REQUEST: Short context for P2P only
    // Delivers just enough recent history to keep side-channel conversations
    // context-aware and meaningfully linked to the main discussion.
    // Prevents circular loops and repeating questions already present in recent context.
    // Uses the exact same clean "Speaker: answer" format as getFormattedChatMessages
    // but limited to the most recent messages for efficiency.
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

    // Updated: supports optional topic filter (backward compatible)
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

    // Updated: supports optional topic filter + uses new status summary
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

    clear() {
        this.log = [];
        this.reactions = {};
    }

    // Updated: supports optional topic filter for clean stats
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
}