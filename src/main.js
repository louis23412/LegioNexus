import os from 'os';
import path from 'path';
import { io } from 'socket.io-client';
import { Worker } from 'worker_threads';

import { startConversation } from './agents/runAgent.js';

const currentWorkState = {
    isWorking: false,
    conversationId: null,
    userPrompt: null,
    userAlias: null,
    abortController: null
};

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
};

const spawnDedicatedHttpServer = (ip, port) => {
    const httpWorker = new Worker(path.join(import.meta.dirname, 'api', 'http_worker.js'), { workerData : { ip, port } });

    httpWorker.on('error', (err) => console.error('[HTTP Worker] Error:', err));

    httpWorker.on('exit', (code) => {
        if (code !== 0) console.error(`[HTTP Worker] Exited with code ${code}`);
    });
};

const main = async () => {
    const ipAddress = getLocalIP();
    const port = 3005;

    spawnDedicatedHttpServer(ipAddress, port);

    const socket = io.connect(`http://${ipAddress}:${port}/chat`, { reconnection: true });

    socket.on('start-conversation', async (data) => {
        if (currentWorkState.isWorking) {
            console.log('🚫 busy working, cannot start another conversation');
            return;
        }

        console.log('▶️ work started');

        currentWorkState.isWorking = true;
        currentWorkState.conversationId = data.conversationId;
        currentWorkState.userPrompt = data.prompt;
        currentWorkState.userAlias = data.alias;

        const abortController = new AbortController();
        currentWorkState.abortController = abortController;

        socket.emit('worker-state', { isWorking : true, conversationId : currentWorkState.conversationId });

        try {
            const result = await startConversation(
                data.conversationId,
                data.prompt,
                data.alias,
                socket,
                abortController.signal
            );

            if (!result.success) {
                console.log('❌ Conversation error:', result.error);
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log('🛑 Conversation was stopped by user');
            } else {
                console.error('❌ Unexpected error in conversation:', err);
            }
        } finally {
            currentWorkState.isWorking = false;
            currentWorkState.conversationId = null;
            currentWorkState.userPrompt = null;
            currentWorkState.userAlias = null;
            currentWorkState.abortController = null;

            socket.emit('worker-state', { isWorking : false, conversationId : currentWorkState.conversationId });
        }
    });

    socket.on('stop-conversation', (data) => {
        if (!currentWorkState.isWorking) {
            console.log('ℹ️ No active conversation to stop');
            return;
        }

        if (data.conversationId && data.conversationId !== currentWorkState.conversationId) {
            console.log('ℹ️ Stop request is for a different conversation');
            return;
        }

        console.log('⏹️ Stop signal received – aborting conversation...');
        currentWorkState.abortController?.abort();
    });

    socket.on('get-worker-state', () => {
        socket.emit('worker-state', { isWorking : currentWorkState.isWorking, conversationId : currentWorkState.conversationId });
    })

    socket.on('connect', () => {
        console.log(`✅ Event server running : http://${ipAddress}:${port}/chat`);
    });
};

main().catch(console.error);