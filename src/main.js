import path from 'path';
import { io } from 'socket.io-client';
import { Worker } from 'worker_threads';

import { startConversation } from './agents/runAgent.js';

const spawnDedicatedHttpServer = (ip, port) => {
    const httpWorker = new Worker(path.join(import.meta.dirname, 'api', 'http_worker.js'), { workerData : { ip, port } });

    httpWorker.on('error', (err) => {
        console.error('[HTTP Worker] Error:', err);
    });

    httpWorker.on('exit', (code) => {
        if (code !== 0) console.error(`[HTTP Worker] Exited with code ${code}`);
    });
};

const main = async (conversationId, userPrompt, userAlias) => {
    const socket = await io.connect('http://localhost:3002/chat', { reconnection: true });
    await socket.on('connect', async () => {
        const result = await startConversation(conversationId, userPrompt, userAlias, socket);
        if (!result.success) console.log(result.error);
    });
};

const conversationId = 'test_conversation_1'
const userPrompt = 'How many items are in the test array?';
const userAlias = 'test-user1';

spawnDedicatedHttpServer('localhost', 3002);
main(conversationId, userPrompt, userAlias).catch(console.error);