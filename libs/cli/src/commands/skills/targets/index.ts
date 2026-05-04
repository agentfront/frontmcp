// file: libs/cli/src/commands/skills/targets/index.ts

export { buildSmitheryPayload, SMITHERY_ENDPOINT, type PublishableSkill, type SmitheryPayload } from './smithery';
export { buildGlamaPayload, GLAMA_ENDPOINT, type GlamaPayload } from './glama';

export type PublishTarget = 'smithery' | 'glama';
