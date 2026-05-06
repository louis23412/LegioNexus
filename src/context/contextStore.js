import { MongoClient } from 'mongodb';

export class ContextStore {
    #db; #client;
    #collectionName; 
    #dbCollection;

    constructor(dbUrl, collectionName) {
        this.#collectionName = collectionName;
        this.#client = new MongoClient(dbUrl);
    }

    async init() {
        await this.#client.connect();

        this.#db = await this.#client.db('context');
        await this.#db.createCollection(this.#collectionName).catch((e) => {console.log(e)});
        this.#dbCollection = this.#db.collection(this.#collectionName);
    }

    async close() {
        await this.#client.close().catch(() => {});
    }

    async newSnapshot(context, metadata) {
        const nowDate = new Date()

        const document = {
            createdAt: nowDate,
            updatedAt: nowDate,

            ...metadata,
            context
        };

        const result = await this.#dbCollection.insertOne(document);

        return result.insertedId;
    }

    async getLastSnapshot() {
        try {
            const result = await this.#dbCollection.findOne(
                {},
                {
                    sort: { createdAt: -1 },
                    projection: { 
                        lastQuery: 1,
                        context: 1
                    }
                }
            );

            return {
                lastQuery : result?.lastQuery ?? null,
                context : result?.context ?? []
            }
        } catch (error) {
            console.error('[ContextStore] getLastSnapshot failed:', error);
            
            return {
                lastQuery : null,
                context : []
            };
        }
    }
}