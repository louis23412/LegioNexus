import vm from 'vm';

export const definition = {
    type: 'function',
    function: {
        name: 'test_code_snippet',
        description: 'Executes a completely safe, pure JavaScript test snippet in an isolated VM sandbox. NO ACCESS to any data structures, inputStore, files, or network. Ideal for testing algorithms, math, logic, small simulations, or validating code ideas. Returns the value of the last expression.',
        parameters: {
            type: 'object',
            properties: {
                code: {
                    type: 'string',
                    description: 'Valid JavaScript code snippet (e.g. "let x = 42; return x * 2 + Math.sqrt(16);" or a full function with loops)'
                },
                timeoutMs: {
                    type: 'number',
                    description: 'Maximum execution time in milliseconds (default: 3000)'
                }
            },
            required: ['code'],
            additionalProperties: false
        },
        version: '1.0'
    }
};

export const createHandler = ({ createErrorResponse }) => {
    return async (args, context = {}) => {
        let { code, timeoutMs = 3000 } = args || {};

        if (!code || typeof code !== 'string' || code.trim() === '') {
            return createErrorResponse('The "code" parameter is required and must be a non-empty string.', 'INVALID_INPUT');
        }

        const sandbox = {
            Math: Math,
            Date: Date,
            JSON: JSON,
            
            parseFloat,
            parseInt,
            isNaN,
            isFinite,

            console: {
                log: () => {},
                warn: () => {},
                error: () => {}
            },

            Array,
            Object,
            String,
            Number,
            Boolean,
            RegExp
        };

        const contextifiedSandbox = vm.createContext(sandbox);

        try {
            const script = new vm.Script(code, {
                filename: 'test_snippet.js',
                timeout: timeoutMs
            });

            const result = script.runInContext(contextifiedSandbox, {
                timeout: timeoutMs
            });

            return {
                status: 'success',
                data: {
                    result: result !== undefined ? result : null,
                    snippetPreview: code.length > 120
                        ? code.substring(0, 117) + '...'
                        : code
                },
                message: `✅ Test snippet executed successfully in ${timeoutMs}ms timeout sandbox (no data access).`
            };
        } catch (err) {
            if (err.name === 'TimeoutError' || err.message.includes('timeout')) {
                return createErrorResponse('Snippet execution timed out. Simplify your code or increase timeoutMs.', 'TIMEOUT');
            }
            return createErrorResponse(`Snippet error: ${err.message}`, 'EXECUTION_ERROR');
        }
    };
};