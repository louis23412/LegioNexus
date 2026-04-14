export const agentEventHandler = (io) => {
    const conversationNamespace = io.of('/chat');

    conversationNamespace.on('connection', (socket) => {
        socket.onAny((eventName, ...args) => {
            if (['disconnect', 'connect_error', 'error', 'ping', 'pong'].includes(eventName)) {
                return;
            }

            socket.broadcast.emit(eventName, ...args);
        });

        socket.on('disconnect', (reason) => {
            console.log(`${socket.id} disconnected. Reason: ${reason}`);
        });
    });
};