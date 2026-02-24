export interface TestExecutorSchema {
  runInBand?: boolean;
  watch?: boolean;
  coverage?: boolean;
  verbose?: boolean;
  timeout?: number;
}
