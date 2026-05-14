import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export const toolRegistry = {};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const collectionsDir = path.join(__dirname, 'collections');

const toolsToLoad = [];

const createErrorResponse = (message, code = 'UNKNOWN_ERROR') => ({
    status: 'error',
    data: null,
    message,
    error: { code, timestamp: new Date().toISOString() }
});

const registerTool = (name, definition, handler) => {
    toolRegistry[name] = { definition, handler, version: definition.function.version || '1.0' };
};

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

                    module.definition.function.description = module.definition.function.description.replaceAll('    ', '').trim();

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

if (fs.existsSync(collectionsDir)) {
    await loadToolsRecursively(collectionsDir);
} else {
    console.error('❌ [TOOL LOADER] collectionsDir not found at:', collectionsDir);
}

for (const tool of toolsToLoad) {
    registerTool(tool.name, tool.definition, null);
}

for (const tool of toolsToLoad) {
    const handler = tool.createHandler({ createErrorResponse });
    toolRegistry[tool.name].handler = handler;
}