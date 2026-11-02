// file: libs/sdk/src/answer/index.ts

export {
  BUDGET_META_KEY,
  fitJsonToBudget,
  fitResourceAnswer,
  fitToolAnswer,
  outputSchemaMismatch,
} from './answer-budget';
export type { BudgetNote, BudgetOmission } from './answer-budget';
export { ANSWER_COUNTERS, measureAnswer, meteringEnabled, recordAnswerCost } from './answer-meter';
export type { AnswerCost } from './answer-meter';
export {
  annotationsForClient,
  callerClientName,
  callerClientProfile,
  resolveClientProfile,
  shapeToolAnswer,
  summarizeStructuredContent,
} from './client-profile';
export type { ClientNameSources } from './client-profile';
