import os from 'os';
import path from 'path';
import { io } from 'socket.io-client';
import { Worker } from 'worker_threads';

import { startConversation } from './agents/runAgent.js';

const getLocalIP = () => {
    const interfaces = os.networkInterfaces();
    let ipAddress;

    Object.keys(interfaces).forEach((ifaceName) => {
        interfaces[ifaceName].forEach((iface) => {
            if (iface.family === 'IPv4' && !iface.internal) {
                ipAddress = iface.address;
            }
        });
    });

    return ipAddress;
}

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
    const ipAddress = getLocalIP();
    const port = 3005;

    spawnDedicatedHttpServer(ipAddress, port);

    const socket = await io.connect(`http://${ipAddress}:${port}/chat`, { reconnection: true });

    await socket.on('connect', async () => {
        console.log(`Event server running : http://${ipAddress}:${port}/chat\n`);

        const result = await startConversation(conversationId, userPrompt, userAlias, socket);
        if (!result.success) console.log(result.error);
    });
};

// -------------------------------------
const conversationId = 'test_conversation_1'
const userPrompt = 'How many items are in the test array?';
const userAlias = 'test-user1';

main(conversationId, userPrompt, userAlias).catch(console.error);