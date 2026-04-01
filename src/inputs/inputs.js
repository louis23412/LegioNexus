import { EventEmitter } from 'node:events';

export class InputStore extends EventEmitter {
    constructor() {
        super();
        this.structures = new Map(); // name → {type, value, metadata}
        this._initializeDefaultData();
    }

    _initializeDefaultData() {
        // ── Handful of data structures agents can work with ──
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
        return obj;
    }
}

// Singleton instance used everywhere
export const inputStore = new InputStore();