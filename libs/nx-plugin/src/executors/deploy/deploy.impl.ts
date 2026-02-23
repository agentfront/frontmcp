import type { ExecutorContext } from '../executor-context.js';
import { execSync } from 'child_process';
import type { DeployExecutorSchema } from './schema.js';

const DEPLOY_COMMANDS: Record<string, string> = {
  node: 'docker compose up --build -d',
  vercel: 'npx vercel --prod',
  lambda: 'sam build && sam deploy',
  cloudflare: 'npx wrangler deploy',
};

export default async function deployExecutor(
  options: DeployExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const command = DEPLOY_COMMANDS[options.target];
  if (!command) {
    console.error(`Unknown deployment target: ${options.target}`);
    return { success: false };
  }

  const projectName = context.projectName ?? '';
  const projectRoot = context.projectsConfigurations?.projects?.[projectName]?.root ?? '';

  console.log(`Deploying ${projectName} to ${options.target}...`);
  console.log(`Running: ${command}`);

  try {
    execSync(command, {
      cwd: `${context.root}/${projectRoot}`,
      stdio: 'inherit',
      env: { ...process.env, FORCE_COLOR: '1' },
    });
    return { success: true };
  } catch {
    return { success: false };
  }
}
