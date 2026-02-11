/**
 * Interactive setup questionnaire runner.
 * Reads manifest setup steps and prompts the user via Node.js readline.
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { c } from '../../colors';
import { ManifestSetupStep } from '../build/exec/manifest';

export interface QuestionnaireResult {
  answers: Record<string, string>;
  envContent: string;
}

/**
 * Run the interactive questionnaire from manifest setup steps.
 */
export async function runQuestionnaire(
  steps: ManifestSetupStep[],
  opts: { silent?: boolean } = {},
): Promise<QuestionnaireResult> {
  const answers: Record<string, string> = {};

  if (opts.silent) {
    return runSilent(steps);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => {
      rl.question(question, (answer) => resolve(answer));
    });

  let currentIndex = 0;
  const stepMap = new Map(steps.map((s, i) => [s.id, i]));

  try {
    let currentGroup = '';

    while (currentIndex < steps.length) {
      const step = steps[currentIndex];

      // Check showWhen conditions
      if (step.showWhen && !evaluateShowWhen(step.showWhen, answers)) {
        currentIndex++;
        continue;
      }

      // Show group header
      if (step.group && step.group !== currentGroup) {
        currentGroup = step.group;
        console.log(`\n${c('bold', `--- ${currentGroup} ---`)}`);
      }

      // Determine prompt based on schema type
      const defaultValue = getDefaultFromSchema(step.jsonSchema);
      const value = await promptStep(ask, step, defaultValue);

      answers[step.id] = value;

      // Determine next step
      currentIndex = resolveNextStep(step, value, currentIndex, stepMap, steps.length);
    }
  } finally {
    rl.close();
  }

  return {
    answers,
    envContent: answersToEnv(answers, steps),
  };
}

function runSilent(steps: ManifestSetupStep[]): QuestionnaireResult {
  const answers: Record<string, string> = {};
  const stepMap = new Map(steps.map((s, i) => [s.id, i]));
  let currentIndex = 0;

  while (currentIndex < steps.length) {
    const step = steps[currentIndex];

    if (step.showWhen && !evaluateShowWhen(step.showWhen, answers)) {
      currentIndex++;
      continue;
    }

    const defaultValue = getDefaultFromSchema(step.jsonSchema);
    if (defaultValue === undefined || defaultValue === '') {
      // Check if the step is required (no default)
      const isOptional =
        step.jsonSchema.default !== undefined || (step.jsonSchema as Record<string, unknown>).nullable === true;

      if (!isOptional) {
        throw new Error(
          `Setup step "${step.id}" requires input but --yes mode cannot provide a value. ` +
            `Set a default or provide values via environment variables.`,
        );
      }
    }

    answers[step.id] = defaultValue ?? '';

    currentIndex = resolveNextStep(step, answers[step.id], currentIndex, stepMap, steps.length);
  }

  return {
    answers,
    envContent: answersToEnv(answers, steps),
  };
}

async function promptStep(
  ask: (q: string) => Promise<string>,
  step: ManifestSetupStep,
  defaultValue: string | undefined,
): Promise<string> {
  const schema = step.jsonSchema;

  // Enum → numbered select menu
  if (schema.enum && Array.isArray(schema.enum)) {
    return promptEnum(ask, step, schema.enum as string[], defaultValue);
  }

  // Boolean → y/n
  if (schema.type === 'boolean') {
    return promptBoolean(ask, step, defaultValue);
  }

  // Default → text input
  return promptText(ask, step, defaultValue);
}

async function promptEnum(
  ask: (q: string) => Promise<string>,
  step: ManifestSetupStep,
  options: string[],
  defaultValue: string | undefined,
): Promise<string> {
  if (step.description) {
    console.log(`  ${c('gray', step.description)}`);
  }

  for (let i = 0; i < options.length; i++) {
    const marker = options[i] === defaultValue ? c('green', '*') : ' ';
    console.log(`  ${marker} ${i + 1}) ${options[i]}`);
  }

  while (true) {
    const defaultHint = defaultValue ? ` [${defaultValue}]` : '';
    const input = await ask(`${step.prompt}${defaultHint}: `);
    const trimmed = input.trim();

    if (!trimmed && defaultValue) return defaultValue;

    // Accept number or value
    const num = parseInt(trimmed, 10);
    if (num >= 1 && num <= options.length) return options[num - 1];
    if (options.includes(trimmed)) return trimmed;

    console.log(c('red', `  Invalid choice. Enter 1-${options.length} or a value from the list.`));
  }
}

async function promptBoolean(
  ask: (q: string) => Promise<string>,
  step: ManifestSetupStep,
  defaultValue: string | undefined,
): Promise<string> {
  const defaultHint = defaultValue !== undefined ? ` [${defaultValue === 'true' ? 'Y/n' : 'y/N'}]` : ' [y/N]';
  while (true) {
    const input = await ask(`${step.prompt}${defaultHint}: `);
    const trimmed = input.trim().toLowerCase();

    if (!trimmed && defaultValue !== undefined) return defaultValue;
    if (trimmed === 'y' || trimmed === 'yes') return 'true';
    if (trimmed === 'n' || trimmed === 'no') return 'false';

    console.log(c('red', '  Please enter y or n.'));
  }
}

async function promptText(
  ask: (q: string) => Promise<string>,
  step: ManifestSetupStep,
  defaultValue: string | undefined,
): Promise<string> {
  if (step.description) {
    console.log(`  ${c('gray', step.description)}`);
  }

  while (true) {
    const defaultHint = defaultValue ? ` [${step.sensitive ? '****' : defaultValue}]` : '';
    const input = await ask(`${step.prompt}${defaultHint}: `);
    const trimmed = input.trim();

    if (!trimmed && defaultValue !== undefined) return defaultValue;
    if (!trimmed) {
      // Check if optional
      const schema = step.jsonSchema;
      if (schema.default !== undefined || (schema as Record<string, unknown>).nullable === true) {
        return '';
      }
      console.log(c('red', '  This field is required.'));
      continue;
    }

    // Validate against JSON Schema constraints
    const validationError = validateAgainstSchema(trimmed, step.jsonSchema);
    if (validationError) {
      console.log(c('red', `  ${validationError}`));
      continue;
    }

    return trimmed;
  }
}

function validateAgainstSchema(value: string, schema: Record<string, unknown>): string | null {
  if (schema.minLength && typeof schema.minLength === 'number' && value.length < schema.minLength) {
    return `Minimum length is ${schema.minLength}`;
  }
  if (schema.maxLength && typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    return `Maximum length is ${schema.maxLength}`;
  }
  if (schema.pattern && typeof schema.pattern === 'string') {
    const re = new RegExp(schema.pattern);
    if (!re.test(value)) return `Value must match pattern: ${schema.pattern}`;
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    const n = Number(value);
    if (isNaN(n)) return 'Must be a number';
    if (schema.minimum !== undefined && typeof schema.minimum === 'number' && n < schema.minimum) {
      return `Minimum value is ${schema.minimum}`;
    }
    if (schema.maximum !== undefined && typeof schema.maximum === 'number' && n > schema.maximum) {
      return `Maximum value is ${schema.maximum}`;
    }
  }
  if (schema.format === 'uri') {
    try {
      new URL(value);
    } catch {
      return 'Must be a valid URL';
    }
  }
  return null;
}

function evaluateShowWhen(conditions: Record<string, string | string[]>, answers: Record<string, string>): boolean {
  for (const [stepId, expected] of Object.entries(conditions)) {
    const actual = answers[stepId];
    if (actual === undefined) return false;

    if (Array.isArray(expected)) {
      if (!expected.includes(actual)) return false;
    } else {
      if (actual !== expected) return false;
    }
  }
  return true;
}

function resolveNextStep(
  step: ManifestSetupStep,
  answer: string,
  currentIndex: number,
  stepMap: Map<string, number>,
  totalSteps: number,
): number {
  if (!step.next) return currentIndex + 1;

  if (typeof step.next === 'string') {
    const idx = stepMap.get(step.next);
    return idx !== undefined ? idx : totalSteps; // end if target not found
  }

  // Record-based routing
  const target = step.next[answer];
  if (target) {
    const idx = stepMap.get(target);
    return idx !== undefined ? idx : totalSteps;
  }

  return currentIndex + 1;
}

function getDefaultFromSchema(schema: Record<string, unknown>): string | undefined {
  if (schema.default !== undefined) {
    return String(schema.default);
  }
  return undefined;
}

function answersToEnv(answers: Record<string, string>, steps: ManifestSetupStep[]): string {
  const lines: string[] = ['# Generated by frontmcp install'];

  let currentGroup = '';
  for (const step of steps) {
    const value = answers[step.id];
    if (value === undefined) continue;

    if (step.group && step.group !== currentGroup) {
      currentGroup = step.group;
      lines.push(`\n# ${currentGroup}`);
    }

    const envName = step.env;
    // Quote values that contain special characters
    const needsQuotes = /[\s#"'\\]/.test(value) || value.includes('=');
    const quotedValue = needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value;

    lines.push(`${envName}=${quotedValue}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Write .env file for an installed app.
 */
export function writeEnvFile(appDir: string, content: string): void {
  const envPath = path.join(appDir, '.env');
  fs.writeFileSync(envPath, content, 'utf-8');
}
