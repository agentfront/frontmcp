// file: libs/cli/src/commands/skills/exporters/index.ts

export { exportToCursor, type CursorExportInput, type ExporterOutput } from './cursor';
export { exportToWindsurf, type WindsurfExportInput } from './windsurf';
export { exportToCopilot, type CopilotExportInput } from './copilot';

export type ExportTarget = 'cursor' | 'windsurf' | 'copilot';
