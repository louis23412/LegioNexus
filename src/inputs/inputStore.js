import { EventEmitter } from 'node:events';

export class InputStore extends EventEmitter {
    constructor() {
        super();
        this.structures = new Map();
        this.notes = new Map();
        this._initializeDefaultData();
    }

    _initializeDefaultData() {
        this.register('testArray', new Array(12345).fill('test item'), {
            description: 'Large test array for length and sampling demonstrations',
            category: 'demo'
        });

        this.register('testObject', {
            id: 42,
            name: 'demo-object',
            tags: ['data', 'structure', 'agent'],
            nested: { count: 123, active: true },
            items: [10, 20, 30]
        }, {
            description: 'Sample nested object for deep analysis',
            category: 'demo'
        });

        this.register('testSet', new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 'a', 'b', 'c']), {
            description: 'Test Set with mixed numeric and string values',
            category: 'demo'
        });

        this.register('testMap', new Map([
            ['key1', 'value1'],
            ['key2', { sub: 'nested-object' }],
            ['num', 999],
            ['flag', true]
        ]), {
            description: 'Test Map with primitive and object values',
            category: 'demo'
        });
    }

    createNote(agentName, title, body) {
        if (!agentName) throw new Error('agentName is required');
        if (!this.notes.has(agentName)) {
            this.notes.set(agentName, []);
        }
        const notesList = this.notes.get(agentName);
        const id = `note_${Date.now()}_${Math.floor(Math.random() * 99999)}`;

        const note = {
            id,
            title: String(title || 'Untitled Note').trim(),
            body: String(body || '').trim(),
            createdAt: new Date().toISOString()
        };

        notesList.push(note);
        this.emit('note_created', { agentName, noteId: id, title: note.title });
        return note;
    }

    deleteNote(agentName, noteId) {
        if (!agentName || !this.notes.has(agentName)) return false;

        const notesList = this.notes.get(agentName);
        const index = notesList.findIndex(n => n.id === noteId);
        if (index === -1) return false;

        const deleted = notesList[index];
        notesList.splice(index, 1);
        this.emit('note_deleted', { agentName, noteId, title: deleted.title });

        if (notesList.length === 0) this.notes.delete(agentName);
        return true;
    }

    getMyNotes(agentName) {
        if (!agentName) return [];
        return this.notes.get(agentName) || [];
    }

    getNote(agentName, noteId) {
        const notesList = this.getMyNotes(agentName);
        return notesList.find(n => n.id === noteId) || null;
    }

    _detectType(value) {
        if (Array.isArray(value)) return 'array';
        if (value instanceof Set) return 'set';
        if (value instanceof Map) return 'map';
        if (value && typeof value === 'object') return 'object';
        return typeof value;
    }

    _deepClone(value) {
        if (value instanceof Set) return new Set(value);
        if (value instanceof Map) return new Map(value);
        if (Array.isArray(value)) return [...value];
        if (value && typeof value === 'object') return JSON.parse(JSON.stringify(value));
        return value;
    }

    register(name, value, metadata = {}) {
        if (this.structures.has(name)) {
            console.warn(`[InputStore] Overwriting existing structure: ${name}`);
        }
        const type = this._detectType(value);
        const entry = {
            type,
            value: this._deepClone(value),
            metadata: {
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                ...metadata
            }
        };
        this.structures.set(name, entry);
        this.emit('registered', { name, type });
        return this;
    }

    get(name) {
        const entry = this.structures.get(name);
        if (!entry) {
            throw new Error(`Data structure "${name}" not found. Available: ${this.list().join(', ')}`);
        }
        return entry.value;
    }

    getEntry(name) {
        return this.structures.get(name) || null;
    }

    update(name, newValue) {
        const entry = this.structures.get(name);
        if (!entry) throw new Error(`Cannot update unknown structure: ${name}`);
        entry.value = this._deepClone(newValue);
        entry.metadata.lastUpdated = new Date().toISOString();
        this.emit('updated', { name });
        return this;
    }

    list() {
        return Array.from(this.structures.keys());
    }

    getInfo(name) {
        const entry = this.structures.get(name);
        if (!entry) return null;
        const extra = {};
        if (entry.type === 'array') extra.length = entry.value.length;
        else if (entry.type === 'set' || entry.type === 'map') extra.size = entry.value.size;
        else if (entry.type === 'object') extra.keyCount = Object.keys(entry.value).length;
        return {
            name,
            type: entry.type,
            ...extra,
            metadata: entry.metadata
        };
    }

    toJSON() {
        const obj = {};
        for (const [name, entry] of this.structures) {
            obj[name] = {
                type: entry.type,
                value: entry.value,
                metadata: entry.metadata
            };
        }

        obj._notes = {};
        for (const [agent, notesList] of this.notes) {
            obj._notes[agent] = notesList;
        }
        return obj;
    }
}