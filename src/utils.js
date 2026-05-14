export const stripEventIds = (messagesArray) => {
    return messagesArray.map(msg => {
        if (msg && typeof msg === 'object' && !Array.isArray(msg)) {
            const { eventId, ...cleanMsg } = msg;
            return cleanMsg;
        }
        return msg;
    });
};

export const withRetry = async (fn, retries = 3) => {
    for (let i = 0; i <= retries; i++) {
        try { return await fn(); } catch (err) {
            if (i === retries) { 
                throw err
            };

            await new Promise(r => setTimeout(r, 400 * (i + 1)));
        }
    }
};