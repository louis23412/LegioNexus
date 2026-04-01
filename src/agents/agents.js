import { memberDefinitions } from "./team.js";

const dedent = (str) => {
    if (!str || typeof str !== 'string') return '';

    const lines = str.split('\n');

    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

    if (lines.length === 0) return '';

    const minIndent = Math.min(
    ...lines
        .filter(line => line.trim() !== '')
        .map(line => {
        const match = line.match(/^(\s+)/);
        return match ? match[0].length : 0;
        })
    );

    const dedentedLines = lines.map(line => {
    if (line.trim() === '') return '';
    return line.slice(minIndent);
    });

    return dedentedLines.join('\n');
};

const cleanToolList = (list) => {
    return (list.flat()).sort((a, b) => a.localeCompare(b));
}

export const createAgentsConfig = (mode = 'team') => {
    const memberObj = {};

    if (mode === 'solo') {};
    if (mode === 'dual') {};

    if (mode === 'team') {
        for (const member of memberDefinitions) {
            memberObj[member.name] = {
                name : member.name,
                isLeader : member.isLeader,
                tools : cleanToolList(member.toolAccess),
                maxIterations : member.maxThinkChain,
                model : member.model,
                options : member.options,
                system : dedent(member.personalityGuideline)
            }
        }
    }

    return memberObj;
}