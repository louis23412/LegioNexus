import ivm from 'isolated-vm';

export const definition = {
    type: 'function',
    function: {
        name: 'run_js_code',
        description: `
            Executes JavaScript in a secure isolated-vm sandbox (true V8 isolation).

            ✅ RULES (very short):
            • Do not add comments, extra whitespace or new lines. Keep your code valid, compact and clean.
            • Console.log disabled.
            • Call safeReturn(yourFinalValue) at the end (preferred)
            • Or make the last line a plain JSON-serializable value
            • Only JSON-serializable values can be returned (numbers, strings, booleans, arrays, plain objects)
            • No require/import, no Node APIs

            Example:
            let sum = 0; for(let i=1; i<=10000; i++) sum += i; safeReturn(sum);
        `,
        parameters: {
            type: 'object',
            properties: {
                code: { type: 'string', description: 'Self-contained JavaScript code' },
                timeoutMs: { type: 'number', description: 'Timeout in ms (default: 30000, max: 120000)' },
                memoryLimitMB: { type: 'number', description: 'Memory limit in MB (default: 128, max: 512)' }
            },
            required: ['code'],
            additionalProperties: false
        },
        version: '2.6'
    }
};

export const createHandler = ({ createErrorResponse }) => {
    return async (args, context = {}) => {
        let { code, timeoutMs = 30000, memoryLimitMB = 128 } = args || {};

        if (!code || typeof code !== 'string' || !code.trim()) {
            return createErrorResponse('The "code" parameter is required.', 'INVALID_INPUT');
        }

        timeoutMs = Math.min(Math.max(1000, timeoutMs), 120000);
        memoryLimitMB = Math.min(Math.max(8, memoryLimitMB), 512);

        const isolate = new ivm.Isolate({ memoryLimit: memoryLimitMB });
        let script, ctx, jail;

        try {
            ctx = isolate.createContextSync();
            jail = ctx.global;
            jail.setSync('global', jail.derefInto());

            let capturedResult = null;
            jail.setSync('safeReturn', (value) => { capturedResult = value; });

            script = isolate.compileScriptSync(code);
            script.runSync(ctx, { timeout: timeoutMs, release: true });

            let finalResult = null;
            try {
                if (capturedResult !== null) {
                    finalResult = capturedResult;
                } else {
                    const hasResult = ctx.evalSync('typeof result !== "undefined"');
                    if (hasResult) finalResult = ctx.evalSync('result');
                }

                if (finalResult !== undefined && finalResult !== null) {
                    const jsonStr = ctx.evalSync(`JSON.stringify(${JSON.stringify(finalResult)})`);
                    finalResult = JSON.parse(jsonStr);
                }
            } catch (e) {
                finalResult = String(finalResult ?? 'undefined');
            }

            return {
                status: 'success',
                data: {
                    result: finalResult,
                    timeoutMs,
                    memoryLimitMB
                },
                message: `✅ Code executed successfully in isolated-vm sandbox.`
            };

        } catch (err) {
            if (err.message?.includes('timeout') || err.name === 'TimeoutError') {
                return createErrorResponse('Execution timed out. Simplify or increase timeoutMs.', 'TIMEOUT');
            }
            if (err.message?.includes('memory') || err.message?.includes('heap')) {
                return createErrorResponse('Memory limit exceeded. Increase memoryLimitMB or simplify code.', 'MEMORY_LIMIT');
            }
            return createErrorResponse(`Execution error: ${err.message}`, 'EXECUTION_ERROR');
        } finally {
            script?.release();
            ctx?.release();
            isolate.dispose();
        }
    };
};