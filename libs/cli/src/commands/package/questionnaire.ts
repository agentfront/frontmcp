/**
 * Interactive setup questionnaire runner.
 * Reads manifest setup steps and prompts the user via @clack/prompts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { c } from '../../core/colors';
import { ManifestSetupStep } from '../build/exec/manifest';
import { clack } from '../../shared/prompts';

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

  const p = await clack();

  let currentIndex = 0;
  const stepMap = new Map(steps.map((s, i) => [s.id, i]));
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
      p.log.step(`--- ${currentGroup} ---`);
    }

    // Determine prompt based on schema type
    const defaultValue = getDefaultFromSchema(step.jsonSchema);
    const value = await promptStep(step, defaultValue);

    answers[step.id] = value;

    // Determine next step
    currentIndex = resolveNextStep(step, value, currentIndex, stepMap, steps.length);
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

async function promptStep(step: ManifestSetupStep, defaultValue: string | undefined): Promise<string> {
  const schema = step.jsonSchema;

  // Enum → select menu
  if (schema.enum && Array.isArray(schema.enum)) {
    return promptEnum(step, schema.enum as string[], defaultValue);
  }

  // Boolean → confirm
  if (schema.type === 'boolean') {
    return promptBoolean(step, defaultValue);
  }

  // Default → text input
  return promptText(step, defaultValue);
}

async function promptEnum(
  step: ManifestSetupStep,
  options: string[],
  defaultValue: string | undefined,
): Promise<string> {
  const p = await clack();

  const message = step.description ? `${step.prompt}\n${c('gray', step.description)}` : step.prompt;

  const result = await p.select({
    message,
    options: options.map((opt) => ({ label: opt, value: opt })),
    initialValue: defaultValue ?? options[0],
  });

  if (p.isCancel(result)) {
    p.cancel('Cancelled.');
    process.exit(0);
  }

  return result;
}

async function promptBoolean(step: ManifestSetupStep, defaultValue: string | undefined): Promise<string> {
  const p = await clack();

  const result = await p.confirm({
    message: step.prompt,
    initialValue: defaultValue === undefined ? false : defaultValue === 'true',
  });

  if (p.isCancel(result)) {
    p.cancel('Cancelled.');
    process.exit(0);
  }

  return result ? 'true' : 'false';
}

async function promptText(step: ManifestSetupStep, defaultValue: string | undefined): Promise<string> {
  const p = await clack();

  const schema = step.jsonSchema;
  const isOptional = schema.default !== undefined || (schema as Record<string, unknown>).nullable === true;

  const result = await p.text({
    message: step.prompt,
    placeholder: step.description || (step.sensitive && defaultValue ? '****' : undefined),
    defaultValue,
    validate: (val) => {
      const trimmed = val.trim();
      if (!trimmed && !defaultValue && !isOptional) {
        return 'This field is required.';
      }
      if (trimmed) {
        const error = validateAgainstSchema(trimmed, step.jsonSchema);
        if (error) return error;
      }
      return undefined;
    },
  });

  if (p.isCancel(result)) {
    p.cancel('Cancelled.');
    process.exit(0);
  }

  return result.trim() || defaultValue || '';
}

function validateAgainstSchema(value: string, schema: Record<string, unknown>): string | null {
  if (schema.minLength && typeof schema.minLength === 'number' && value.length < schema.minLength) {
    return `Minimum length is ${schema.minLength}`;
  }
  if (schema.maxLength && typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
    return `Maximum length is ${schema.maxLength}`;
  }
  if (schema.pattern && typeof schema.pattern === 'string') {
    let re: RegExp;
    try {
      re = new RegExp(schema.pattern);
    } catch {
      return `Invalid pattern in schema: ${schema.pattern}`;
    }
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
    const quotedValue = needsQuotes ? `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : value;

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
