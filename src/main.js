import os from 'os';
import path from 'path';
import { io } from 'socket.io-client';
import { Worker } from 'worker_threads';

import { startConversation } from './agents/runAgent.js';

const currentWorkState = {
    isWorking: false,
    isStopping: false,
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
        if (currentWorkState.isWorking) { return; }

        if (
            !data ||
            typeof data.conversationId !== 'string' || data.conversationId.trim() === '' ||
            typeof data.prompt !== 'string' || data.prompt.trim() === '' ||
            typeof data.alias !== 'string' || data.alias.trim() === ''
        ) {
            console.error('❌ Invalid input received: conversationId, prompt, and alias must be non-empty strings');

            return;
        }

        currentWorkState.isWorking = true;
        currentWorkState.isStopping = false;

        const conversationId = data.conversationId.trim();
        const prompt = data.prompt.trim();
        const alias = data.alias.trim();

        currentWorkState.conversationId = conversationId;
        currentWorkState.userPrompt = prompt;
        currentWorkState.userAlias = alias;

        const abortController = new AbortController();
        currentWorkState.abortController = abortController;

        socket.emit('worker-state', { isWorking : true, isStopping : false, conversationId : currentWorkState.conversationId });

        console.log(`[WORKER BUSY] - ID: ${currentWorkState.conversationId} | Alias: ${currentWorkState.userAlias}`);

        try {
            const result = await startConversation(
                conversationId,
                prompt,
                alias,
                socket,
                abortController.signal
            );

            if (!result.success) {
                console.error('❌ Conversation error:', result.error);
            }
        } catch (err) {
            if (err.name === 'AbortError') {}
            else { console.error('❌ Unexpected error in conversation:', err); }
        } finally {
            currentWorkState.isWorking = false;
            currentWorkState.isStopping = false;
            currentWorkState.conversationId = null;
            currentWorkState.userPrompt = null;
            currentWorkState.userAlias = null;
            currentWorkState.abortController = null;

            socket.emit('worker-state', { isWorking : false, isStopping : false, conversationId : currentWorkState.conversationId });

            console.log(`[WORKER IDLE]`);
        }
    });

    socket.on('stop-conversation', (data) => {
        if (!currentWorkState.isWorking) { return; }

        if (currentWorkState.isStopping) { return; }

        if (
            data.conversationId &&
            typeof data.conversationId === 'string' &&
            data.conversationId.trim() !== currentWorkState.conversationId
        ) { return; }

        currentWorkState.isStopping = true;
        currentWorkState.abortController?.abort();

        socket.emit('worker-state', { isWorking : currentWorkState.isWorking, isStopping : true, conversationId : currentWorkState.conversationId });
    });

    socket.on('get-worker-state', () => {
        socket.emit('worker-state', { 
            isWorking : currentWorkState.isWorking, 
            isStopping : currentWorkState.isStopping, 
            conversationId : currentWorkState.conversationId 
        });
    })

    socket.on('connect', () => {
        console.log(`✅ Event server running : http://${ipAddress}:${port}/chat`);
    });
};

main().catch(console.error);