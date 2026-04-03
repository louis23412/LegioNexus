export const definition = {
    type: 'function',
    function: {
        name: 'get_current_datetime',
        description: 'Returns the current date and time in BOTH UTC (universal) and local timezone. Perfect for timeline awareness and knowing exactly where the system is in the global timeline.',
        parameters: {
            type: 'object',
            properties: {
                format: {
                    type: 'string',
                    enum: ['iso', 'full', 'short'],
                    description: 'Optional: iso = UTC ISO only, full = rich object (default), short = quick local time string'
                }
            },
            required: [],
            additionalProperties: false
        },
        version: '2.0'
    }
};

export const createHandler = ({ createErrorResponse }) => {
    return async (args, context = {}) => {
        try {
            const now = new Date();
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const format = args?.format || 'full';

            const utc = {
                iso: now.toISOString(),
                display: now.toUTCString(),
                time: now.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }),
                date: now.toLocaleDateString('en-GB', { timeZone: 'UTC' })
            };

            const local = {
                timezone: tz,
                display: `${now.toLocaleString('en-GB', { timeZone: tz })} (${tz})`,
                time: now.toLocaleTimeString('en-GB', { timeZone: tz, hour12: false }),
                date: now.toLocaleDateString('en-GB', { timeZone: tz }),
                utc_offset_hours: (now.getTimezoneOffset() / -60).toFixed(1)
            };

            let quickDisplay = '';
            if (format === 'iso') quickDisplay = utc.iso;
            else if (format === 'short') quickDisplay = local.time;
            else quickDisplay = local.display;

            const data = {
                unix_timestamp: now.getTime(),
                utc,
                local,
                quick_display: quickDisplay
            };

            return {
                status: 'success',
                data,
                message: `✅ Current datetime retrieved — UTC: ${utc.time} | Local (${tz}): ${local.time}`
            };
        } catch (err) {
            return createErrorResponse(`Failed to get current datetime: ${err.message}`);
        }
    };
};