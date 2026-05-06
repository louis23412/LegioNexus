import { MongoClient } from 'mongodb';

export class AnchorStore {
    #db; #client;
    #collectionName; 
    #dbCollection;
    #numDimensions;

    constructor(dbUrl, numDimensions, collectionName) {
        this.#collectionName = collectionName;
        this.#client = new MongoClient(dbUrl);
        this.#numDimensions = numDimensions;
    }

    async #createIndexes() {
        const vectorIndexDefinition = {
            name: 'vector_index',
            type: 'vectorSearch',
            definition: {
                fields: [
                    {
                        type: 'vector',
                        path: 'dense_embedding',
                        numDimensions: this.#numDimensions,
                        similarity: 'cosine',
                        quantization: 'scalar'
                    },

                    {
                        type: 'vector',
                        path: 'trajectory_embedding',
                        numDimensions: this.#numDimensions,
                        similarity: 'cosine',
                        quantization: 'scalar'
                    },

                    {
                        type: 'vector',
                        path: 'raw_embedding',
                        numDimensions: this.#numDimensions,
                        similarity: 'cosine',
                        quantization: 'scalar'
                    }
                ]
            }
        };

        const searchIndexDefinition = {
            name: 'keyword_index',
            type: 'search',
            definition: {
                mappings: {
                    dynamic: false,
                    fields: {
                        dense_keywords: [
                            {
                                type: "token",
                                normalizer: "lowercase"
                            },
                            {
                                type: "string",
                                analyzer: "lucene.standard"
                            },
                            {
                                type: "autocomplete",
                                tokenization: "edgeGram",
                                minGrams: 2,
                                maxGrams: 15,
                                foldDiacritics: true
                            }
                        ],

                        trajectory_keywords: [
                            {
                                type: "token",
                                normalizer: "lowercase"
                            },
                            {
                                type: "string",
                                analyzer: "lucene.standard"
                            },
                            {
                                type: "autocomplete",
                                tokenization: "edgeGram",
                                minGrams: 2,
                                maxGrams: 15,
                                foldDiacritics: true
                            }
                        ],

                        raw_keywords: [
                            {
                                type: "token",
                                normalizer: "lowercase"
                            },
                            {
                                type: "string",
                                analyzer: "lucene.standard"
                            },
                            {
                                type: "autocomplete",
                                tokenization: "edgeGram",
                                minGrams: 2,
                                maxGrams: 15,
                                foldDiacritics: true
                            }
                        ]
                    }
                }
            }
        };

        try {
            await this.#dbCollection.createIndex({ sequenceId: 1 });

            await this.#dbCollection.createSearchIndex(vectorIndexDefinition);
            await this.#dbCollection.createSearchIndex(searchIndexDefinition);
        } 
        
        catch (e) { console.error('Failed to create search indexes:', e); }
    }

    async init() {
        await this.#client.connect();

        this.#db = await this.#client.db('anchors');
        await this.#db.createCollection(this.#collectionName).catch(() => {});
        this.#dbCollection = this.#db.collection(this.#collectionName);

        await this.#createIndexes();
    }

    async close() {
        await this.#client.close().catch(() => {});
    }

    async getCurrentSequenceId() {
        try {
            const result = await this.#dbCollection.findOne(
                {},
                {
                    sort: { sequenceId: -1 },
                    projection: { sequenceId: 1 }
                }
            );

            return result?.sequenceId ?? 0;
        } catch (error) {
            console.error('[AnchorStore] getCurrentSequenceId failed:', error);
            return 0;
        }
    }

    async getAnchorStatus(aList) {
        try {
            const result = await this.#dbCollection.find(
                { sequenceId : { $in : aList } },
                {
                    projection: {
                        sequenceId : 1,
                        status: 1,
                        resolverData : {
                            resolutionAnchor : 1
                        }
                    }
                }
            ).toArray();

            const obj = result ? Object.fromEntries(
                result.map((val) => [ 
                    Number(val.sequenceId), 
                    { 
                        status : val.status, 
                        resolutionAnchor : val.resolverData?.resolutionAnchor ?? null
                    } 
                ])
            ) : {};

            return obj;
        } catch (error) {
            console.error('[AnchorStore] getAnchorStatus failed:', error);

            return {};
        }
    }

    async insertAnchor(anchorData, keywordData, embeddingData) {
        const nowDate = new Date()

        const document = {
            createdAt: nowDate,
            updatedAt: nowDate,

            ...anchorData,

            dense_embedding: embeddingData.dense,
            trajectory_embedding: embeddingData.trajectory,
            raw_embedding: embeddingData.raw,

            dense_keywords: keywordData.dense,
            trajectory_keywords: keywordData.trajectory,
            raw_keywords: keywordData.raw
        };

        const result = await this.#dbCollection.insertOne(document);

        return result.insertedId;
    }

    async searchAnchors(queryEmbedding, keywords, options = {}) {
        if (!Array.isArray(queryEmbedding) || queryEmbedding.length !== this.#numDimensions) {
            throw new Error(`queryEmbedding must be an array of exactly ${this.#numDimensions} numbers`);
        }
        if (!Array.isArray(keywords) || keywords.length === 0) {
            throw new Error('keywords must be a non-empty array');
        }

        const {
            limit = 15,
            numCandidates = 400,
            minHybridScore = 0,
            weights = {
                denseVector: 0.40,
                trajectoryVector: 0.30,
                rawVector: 0.18,
                keywordText: 0.12
            }
        } = options;

        const textQuery = {
            compound: {
                should: [
                    {
                        text: {
                            query: keywords,
                            path: ["dense_keywords", "trajectory_keywords", "raw_keywords"],
                            fuzzy: { maxEdits: 1, prefixLength: 2 }
                        }
                    },
                    {
                        phrase: {
                            query: keywords.join(" "),
                            path: ["dense_keywords", "trajectory_keywords", "raw_keywords"],
                            slop: 3
                        }
                    }
                ],
                minimumShouldMatch: 1
            }
        };

        const pipeline = [
            {
                $rankFusion: {
                    input: {
                        pipelines: {
                            denseVector: [
                                {
                                    $vectorSearch: {
                                        index: "vector_index",
                                        path: "dense_embedding",
                                        queryVector: queryEmbedding,
                                        numCandidates: Math.max(numCandidates, limit * 6),
                                        limit: limit * 4
                                    }
                                }
                            ],
                            trajectoryVector: [
                                {
                                    $vectorSearch: {
                                        index: "vector_index",
                                        path: "trajectory_embedding",
                                        queryVector: queryEmbedding,
                                        numCandidates: Math.max(numCandidates, limit * 6),
                                        limit: limit * 4
                                    }
                                }
                            ],
                            rawVector: [
                                {
                                    $vectorSearch: {
                                        index: "vector_index",
                                        path: "raw_embedding",
                                        queryVector: queryEmbedding,
                                        numCandidates: Math.max(numCandidates, limit * 5),
                                        limit: limit * 3
                                    }
                                }
                            ],
                            keywordText: [
                                {
                                    $search: {
                                        index: "keyword_index",
                                        ...textQuery
                                    }
                                },
                                { $limit: limit * 5 }
                            ]
                        }
                    },
                    combination: {
                        weights: weights
                    },
                    scoreDetails: true
                }
            },

            {
                $addFields: {
                    hybridScore: { $meta: "score" },
                    scoreDetails: { $meta: "scoreDetails" }
                }
            },

            { $match: { hybridScore: { $gte: minHybridScore } } },
            { $sort: { sequenceId: 1 } },
            { $limit: limit },

            {
                $project: {
                    _id: 1,
                    createdAt: 1,
                    updatedAt : 1,

                    sequenceId : 1,
                    status : 1,

                    trustScore : 1,

                    summaryData : 1,
                    resolverData : 1,

                    dense_keywords : 1,
                    trajectory_keywords : 1,
                    raw_keywords : 1,

                    scoreDetails: {
                        value : 1,
                        details : 1
                    }
                }
            }
        ];

        try {
            const anchorData = await this.#dbCollection.aggregate(pipeline).toArray();

            return anchorData.map((a) => {

                let denseScore = 0; let trajectoryScore = 0;

                for (const detail of a.scoreDetails.details) {
                    if (detail.inputPipelineName === 'denseVector') denseScore = detail.value;
                    if (detail.inputPipelineName === 'trajectoryVector') trajectoryScore = detail.value;
                }

                return {
                    id : a.sequenceId,
                    status : a.status,

                    created : a.createdAt,
                    updated : a.updatedAt,

                    score : a.trustScore * a.scoreDetails.value,

                    resolverData : a.resolverData,

                    summary : denseScore >= trajectoryScore ? a.summaryData.dense.contentObj : a.summaryData.trajectory.contentObj,

                    keywords : [...new Set([...a.dense_keywords, ...a.trajectory_keywords, ...a.raw_keywords])]
                }
            });
        } catch (error) {
            console.error("Hybrid search failed:", error);

            return [];
        }
    }

    async resolveActiveAnchors(startingAnchorId, resolutionAnchorId) {
        if (!startingAnchorId || !resolutionAnchorId) {
            return 0;
        }

        try {
            const result = await this.#dbCollection.updateMany(
                {
                    sequenceId: { $gte: Number(startingAnchorId) },
                    status: 'ACTIVE'
                },
                {
                    $set: {
                        status: 'RESOLVED',
                        'resolverData.resolutionAnchor': Number(resolutionAnchorId),
                        updatedAt: new Date()
                    }
                }
            );

            return result.modifiedCount;
        } catch (error) {
            console.error('[AnchorStore] resolveActiveAnchors failed:', error);
            return 0;
        }
    }
}