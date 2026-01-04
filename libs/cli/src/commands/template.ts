import * as path from 'path';
import * as readline from 'readline';
import { c } from '../colors';
import { ensureDir, fileExists } from '@frontmcp/utils';
import { fsp } from '../utils/fs';

type AuthType = 'oauth2' | 'bearer' | 'apiKey';

interface TemplateContext {
  owner: string;
  service: string;
  authType: AuthType;
}

/**
 * frontmcp template <templateName>
 *
 * Example:
 *   npx frontmcp template 3rd-party-integration
 *
 * This will look for templates in:
 *   src/templates/<templateName>   (built to dist/templates/<templateName>)
 * and copy them into:
 *   integrations/<owner>/<service>
 * with __OWNER__, __SERVICE__, __AUTH_TYPE__ replaced.
 */
export async function runTemplate(templateName?: string): Promise<void> {
  const name = (templateName || '').trim();
  if (!name) {
    console.log(c('red', 'Template name is required (e.g. 3rd-party-integration).'));
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (q: string): Promise<string> => new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));

  try {
    const templatesRoot = path.resolve(__dirname, '..', 'templates');

    // 1) Collect available templates up-front
    const available = await listAvailableTemplates(templatesRoot);
    if (!available.length) {
      console.log(c('red', `No templates found under ${path.relative(process.cwd(), templatesRoot)}.`));
      return;
    }

    // 2) Sanitize the name and choose the actual template folder
    const sanitized = sanitizeTemplateName(name);
    let selected: string | null = null;

    if (available.includes(name)) {
      selected = name;
    } else if (available.includes(sanitized)) {
      selected = sanitized;
      if (sanitized !== name) {
        console.log(c('yellow', `[template] Template "${name}" not found, using sanitized "${sanitized}"`));
      }
    }

    if (!selected) {
      console.log(c('red', `Template "${name}" not found under ${path.relative(process.cwd(), templatesRoot)}.`));
      console.log(c('gray', '\nAvailable templates:'));
      for (const t of available) {
        console.log('  -', t);
      }
      return;
    }

    const templateRoot = path.resolve(templatesRoot, selected);

    console.log(c('cyan', '[template]') + ` Using template "${selected}" from src/templates/${selected}`);

    // Ask for owner & service
    let owner = await ask(`Third-party owner (e.g. google, github, slack): `);
    if (!owner) {
      console.log(c('red', 'Owner is required.'));
      return;
    }
    owner = sanitizeSlug(owner);

    let service = await ask(`Third-party service (e.g. gmail, slack-bot): `);
    if (!service) {
      console.log(c('red', 'Service is required.'));
      return;
    }
    service = sanitizeSlug(service);

    // Auth type (for placeholders only – you can use or ignore in templates)
    let authRaw = await ask(`Default auth type (oauth2/bearer/apiKey) [oauth2]: `);
    if (!authRaw) authRaw = 'oauth2';
    const authType = authRaw as AuthType;
    if (!['oauth2', 'bearer', 'apiKey'].includes(authType)) {
      console.log(c('red', `Invalid auth type: ${authRaw}`));
      return;
    }

    const ctx: TemplateContext = { owner, service, authType };

    const cwd = process.cwd();
    const destRoot = path.resolve(cwd, 'integrations', owner, service);
    await ensureDir(destRoot);

    console.log(c('gray', `[template] Scaffolding into ${path.relative(cwd, destRoot)}`));

    await copyTemplateTree(templateRoot, destRoot, ctx);

    console.log('');
    console.log(c('green', '✔ Template hydrated into: ') + path.relative(cwd, destRoot));
    console.log(c('gray', 'You can now edit or delete the generated example files and create your own tools.'));
  } finally {
    rl.close();
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function sanitizeSlug(val: string): string {
  return (
    val
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'service'
  );
}

// More permissive for template folder names (allow . _ -)
function sanitizeTemplateName(val: string): string {
  return (
    val
      .trim()
      .replace(/[^a-zA-Z0-9._-]/g, '-') // replace weird chars
      .replace(/-+/g, '-') // collapse multiple dashes
      .replace(/^-|-$/g, '') || 'template'
  );
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const st = await fsp.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function listAvailableTemplates(templatesRoot: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(templatesRoot, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Replace placeholders in both filenames and file contents.
 *
 * Supported placeholders:
 *   __OWNER__
 *   __SERVICE__
 *   __AUTH_TYPE__
 */
function applyPlaceholders(input: string, ctx: TemplateContext): string {
  return input
    .replaceAll('__OWNER__', ctx.owner)
    .replaceAll('__SERVICE__', ctx.service)
    .replaceAll('__AUTH_TYPE__', ctx.authType);
}

async function copyTemplateTree(templateRoot: string, destRoot: string, ctx: TemplateContext): Promise<void> {
  const walk = async (srcDir: string) => {
    const entries = await fsp.readdir(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const relFromRoot = path.relative(templateRoot, srcPath);

      // Apply placeholders in path segments too
      const relWithPlaceholders = applyPlaceholders(relFromRoot, ctx);
      const destPath = path.join(destRoot, relWithPlaceholders);

      if (entry.isDirectory()) {
        await ensureDir(destPath);
        await walk(srcPath);
      } else if (entry.isFile()) {
        // Read template file, apply placeholders, write if not existing
        const content = await fsp.readFile(srcPath, 'utf8');
        const processed = applyPlaceholders(content, ctx);

        if (await fileExists(destPath)) {
          console.log(c('gray', `skip: ${path.relative(process.cwd(), destPath)} already exists`));
          continue;
        }

        await ensureDir(path.dirname(destPath));
        await fsp.writeFile(destPath, processed, 'utf8');
        console.log(c('green', `✓ created ${path.relative(process.cwd(), destPath)}`));
      }
    }
  };

  await walk(templateRoot);
}
