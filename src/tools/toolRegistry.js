import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export const createToolRegistry = async (runAgentFn, agentsConfig, inputStore) => {
    const toolRegistry = {};

    const createErrorResponse = (message, code = 'UNKNOWN_ERROR') => ({
        status: 'error',
        data: null,
        message,
        error: { code, timestamp: new Date().toISOString() }
    });

    const registerTool = (name, definition, handler) => {
        toolRegistry[name] = { definition, handler, version: definition.function.version || '1.0' };
    };

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const collectionsDir = path.join(__dirname, 'collections');

    const toolsToLoad = [];

    const loadToolsRecursively = async (dir) => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await loadToolsRecursively(fullPath);
            } else if (entry.name.endsWith('.js') && !entry.name.startsWith('.')) {
                const fileUrl = pathToFileURL(fullPath).toString();
                try {
                    const module = await import(fileUrl);
                    if (module.definition && module.createHandler) {
                        const name = module.definition.function.name;
                        toolsToLoad.push({
                            name,
                            definition: module.definition,
                            createHandler: module.createHandler
                        });
                    }
                } catch (err) {
                    console.error(`❌ Failed to load tool ${entry.name}:`, err.message);
                }
            }
        }
    }

    console.log('🔄 [TOOL LOADER] Scanning /tools/collections/...');
    if (fs.existsSync(collectionsDir)) {
        await loadToolsRecursively(collectionsDir);
    } else {
        console.error('❌ [TOOL LOADER] collectionsDir not found at:', collectionsDir);
    }

    for (const tool of toolsToLoad) {
        registerTool(tool.name, tool.definition, null);
    }

    for (const tool of toolsToLoad) {
        const handler = tool.createHandler({
            runAgentFn,
            agentsConfig,
            inputStore,
            toolRegistry,
            createErrorResponse
        });
        toolRegistry[tool.name].handler = handler;
        console.log(`✅ Registered tool: ${tool.name}`);
    }

    toolRegistry.getAllToolDocs = () => Object.keys(toolRegistry)
        .filter(k => k !== 'getAllToolDocs')
        .map(name => ({
            name,
            version: toolRegistry[name].version,
            description: toolRegistry[name].definition.function.description
        }));

    console.log(`📦 [TOOL REGISTRY] Loaded ${toolsToLoad.length} tools successfully`);
    return toolRegistry;
};