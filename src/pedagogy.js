import { readFileSync } from 'node:fs';

// Project-owned skill: the same source is injected into the chat and MCP guide.
// Loading by module URL also works when an external client uses a different cwd.
const skill = readFileSync(new URL('../skills/tutor-pedagogy/SKILL.md', import.meta.url), 'utf8');
export const TEACHING_GUIDE = skill.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
