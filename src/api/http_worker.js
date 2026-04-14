import http from 'node:http';
import { Server } from "socket.io";
import { workerData } from 'node:worker_threads';

import { agentEventHandler } from './sockets.js';

const { ip, port } = workerData;

const httpServer = http.createServer(() => {});

export const socketServer = new Server(httpServer, {
    cors: {
        origin: '*'
    }
});

httpServer.listen(port, ip);
agentEventHandler(socketServer);

setInterval(() => {}, 30000);