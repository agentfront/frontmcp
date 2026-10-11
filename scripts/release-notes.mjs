#!/usr/bin/env node
// Writes a release's changelog and frontmcp.dev Card: node scripts/release-notes.mjs <version> <previous tag> <output dir>
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = 'gpt-4o';
const PROMPT_LIMIT = 100_000;
const PULL_REQUESTS_LIMIT = 60_000;
const PULL_REQUEST_LIMIT = 8_000;
const FILES_LIMIT = 10_000;
const DIFF_EXCLUDES = ['**/yarn.lock', '**/package-lock.json', '**/*.spec.*', '**/*.test.*', '**/*.snap'].map(
  (pattern) => `:(exclude,glob)${pattern}`,
);
const RELEASE_MECHANICS = /^(chore\(release\)|Merge branch |Merge remote-tracking branch )/;
const LEFT_OUT_TYPES = new Set(['chore', 'ci', 'test', 'build', 'style']);
const KINDS = {
  feat: { section: 'Features', one: 'feature', many: 'features', rank: 0 },
  fix: { section: 'Bug Fixes', one: 'fix', many: 'fixes', rank: 1 },
  perf: { section: 'Improvements', one: 'improvement', many: 'improvements', rank: 2 },
  docs: { section: 'Documentation', one: 'documentation update', many: 'documentation updates', rank: 4 },
};
const OTHER_KIND = { section: 'Improvements', one: 'improvement', many: 'improvements', rank: 3 };
const BREAKING_KIND = { section: 'Breaking Changes', one: 'breaking change', many: 'breaking changes', rank: -1 };
const SECTION_ORDER = ['Breaking Changes', 'Features', 'Improvements', 'Bug Fixes', 'Documentation'];

const instructions = (
  version,
) => `You are a technical writer creating release notes for FrontMCP, a TypeScript framework for building Model Context Protocol (MCP) servers. Write in a clear, professional, benefit-focused tone.

Work from the pull requests: their descriptions say what changed and why. Use the changed files and the diff to confirm details. Describe only changes that are in the input, and leave out release mechanics such as version bumps. Never ask for more information, apologize, or describe the input: a small release gets a short changelog and a Card with one or two highlights.

Output TWO sections, separated by a line containing only ---CARD_MDX---:

1. CHANGELOG: a Markdown changelog with these sections, each a bold line followed by bullets:
   - **Features** (new capabilities)
   - **Improvements** (enhancements to existing features)
   - **Bug Fixes**
   - **Breaking Changes** (highlight clearly)

   Include only the sections that have content: never write that a section is empty. One or two sentences per bullet, on what users gain and its practical impact. If a security fix is included, write with appropriate gravity and credit the reporter if the input names them.

2. CARD_MDX: a Card with the release highlights, which the frontmcp.dev releases page reads, exactly in this form:

<Card
  title="FrontMCP v${version}: [2-5 word headline]"
  href="https://github.com/agentfront/frontmcp/releases/tag/v${version}"
  cta="View full changelog"
>
  [One paragraph of 2-3 sentences on what this release is about.]

  [emoji] **Highlight Name** – Short description of what it does.

  [emoji] **Highlight Name** – Short description of what it does.

</Card>

Rules for the Card: at most 4 highlights, the most impactful changes; each highlight is a relevant emoji, a **Bold Name**, an en dash (–) and a short description, with a blank line between highlights.`;

export function pullRequestNumber(subject) {
  const number = subject.match(/^Merge pull request #(\d+)/)?.[1] ?? subject.match(/\(#(\d+)\)$/)?.[1];
  return number ? Number(number) : undefined;
}

export function parseNotes(answer, version) {
  const parts = answer.split(/^[ \t]*---CARD_MDX---[ \t]*$/m);
  if (parts.length !== 2) return undefined;
  const changelog = parts[0].trim();
  const card = parts[1].match(/<Card\b[^>]*>[\s\S]*?<\/Card>/)?.[0];
  const cardVersion = card?.match(/\btitle="FrontMCP v([^":]+): [^"]+"/)?.[1];
  const hasBullet = /^\s*[-*]\s+\S/m.test(changelog);
  const hasHighlight = /^[^\w*`\n]*\*\*[^*\n]+\*\*\s*[–—:-]/mu.test(card ?? '');
  if (cardVersion !== version || !hasBullet || !hasHighlight) return undefined;
  return { changelog, card: card.replace(/\n(?=[^\w*`\n]*\*\*)/g, '\n\n').replace(/\n{3,}/g, '\n\n') };
}

const capitalize = (text) => text.replace(/^\p{Ll}/u, (letter) => letter.toUpperCase());
const listOf = (items) => new Intl.ListFormat('en').format(items);

function describeChange(change) {
  const [, type = '', scope = '', breaking = '', summary = change.title] =
    change.title.match(/^(\w+)(?:\(([^)]*)\))?(!?):\s*(.+)$/) ?? [];
  if (!change.title || (LEFT_OUT_TYPES.has(type) && !breaking)) return undefined;
  const text = capitalize(summary.replace(/\s*\(#\d+\)$/, ''));
  return { ...(breaking ? BREAKING_KIND : (KINDS[type] ?? OTHER_KIND)), scope, text, number: change.number };
}

function highlightName(item) {
  if (item.section !== BREAKING_KIND.section) return item.scope || item.section;
  return item.scope ? `Breaking change (${item.scope})` : 'Breaking change';
}

export function fallbackNotes(version, changes) {
  const described = changes.map(describeChange).filter(Boolean);
  const reference = (item) => (item.number ? ` (#${item.number})` : '');
  const sections = SECTION_ORDER.map((section) => ({
    section,
    items: described.filter((item) => item.section === section),
  })).filter(({ items }) => items.length);
  const changelog = sections.length
    ? sections
        .map(({ section, items }) =>
          [
            `**${section}**`,
            '',
            ...items.map((item) => `- ${item.scope ? `**${item.scope}:** ` : ''}${item.text}${reference(item)}`),
          ].join('\n'),
        )
        .join('\n\n')
    : '- Maintenance only: no user-facing changes.';

  const counts = sections.map(({ items }) => `${items.length} ${items.length === 1 ? items[0].one : items[0].many}`);
  const summary = counts.length ? `This release brings ${listOf(counts)}.` : 'This release has no user-facing changes.';
  const headline = sections.length
    ? capitalize(listOf(sections.map(({ section }) => section.toLowerCase())))
    : 'Maintenance release';
  const highlights = [...described]
    .sort((first, second) => first.rank - second.rank)
    .slice(0, 4)
    .map((item) => `  **${highlightName(item)}** – ${item.text.replace(/[.!]?$/, '.')}`);
  const card = [
    '<Card',
    `  title="FrontMCP v${version}: ${headline}"`,
    `  href="https://github.com/agentfront/frontmcp/releases/tag/v${version}"`,
    '  cta="View full changelog"',
    '>',
    `  ${summary}`,
    ...highlights.flatMap((highlight) => ['', highlight]),
    '</Card>',
  ].join('\n');
  return { changelog, card };
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function pullRequest(number) {
  const repository = process.env.GITHUB_REPOSITORY ?? 'agentfront/frontmcp';
  try {
    const json = execFileSync('gh', ['pr', 'view', String(number), '--repo', repository, '--json', 'title,body'], {
      encoding: 'utf8',
    });
    const { title, body } = JSON.parse(json);
    return { number, title, body: body.trim() };
  } catch (error) {
    console.log(`::warning::Couldn't read pull request #${number}: ${error.message}`);
    return undefined;
  }
}

function mergedTitles(hash, subject) {
  if (!subject.startsWith('Merge pull request ')) return [subject];
  return git('log', '--no-merges', '--format=%s', `${hash}^1..${hash}^2`).split('\n').filter(Boolean);
}

function collectChanges(previousTag) {
  const log = git('log', '--first-parent', '--format=%H%x1f%s', `${previousTag}..HEAD`);
  return log
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\x1f'))
    .filter(([, subject]) => !RELEASE_MECHANICS.test(subject))
    .flatMap(([hash, subject]) => {
      const number = pullRequestNumber(subject);
      if (!number) return [{ title: subject, body: '' }];
      return pullRequest(number) ?? mergedTitles(hash, subject).map((title) => ({ number, title, body: '' }));
    });
}

function describeRelease(version, previousTag, changes) {
  const bodyLimit = Math.min(PULL_REQUEST_LIMIT, Math.floor(PULL_REQUESTS_LIMIT / Math.max(changes.length, 1)));
  const pullRequests = changes
    .map(
      (change) =>
        `### ${change.number ? `#${change.number} ` : ''}${change.title}\n\n${change.body.slice(0, bodyLimit)}`,
    )
    .join('\n\n');
  const files = git('diff', '--stat=200', `${previousTag}..HEAD`, '--', '.', ...DIFF_EXCLUDES).slice(0, FILES_LIMIT);
  const diff = git('diff', `${previousTag}..HEAD`, '--', '.', ...DIFF_EXCLUDES);
  const header = `FrontMCP ${version} (previous release: ${previousTag}).\n\n## Pull requests\n\n${pullRequests}\n\n## Files changed\n\n${files}\n## Diff\n\n`;
  return header + diff.slice(0, Math.max(PROMPT_LIMIT - header.length, 0));
}

async function askModel(version, release) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.3,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: instructions(version) },
        { role: 'user', content: release },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OpenAI answered ${response.status}`);
  const completion = await response.json();
  return completion.choices?.[0]?.message?.content ?? '';
}

async function main() {
  const [, , version, previousTag, outputDir] = process.argv;
  if (!version || !previousTag || !outputDir) {
    console.error('Usage: release-notes.mjs <version> <previous tag> <output dir>');
    process.exit(1);
  }

  const changes = collectChanges(previousTag);
  let notes;
  if (process.env.OPENAI_API_KEY) {
    try {
      const answer = await askModel(version, describeRelease(version, previousTag, changes));
      notes = parseNotes(answer, version);
      if (!notes) console.log(`::warning::The model's answer wasn't a changelog and a Card:\n${answer.slice(0, 2000)}`);
    } catch (error) {
      console.log(`::warning::Couldn't get release notes from the model: ${error.message}`);
    }
  }
  if (!notes) console.log('Writing the release notes from the pull request titles');

  const { changelog, card } = notes ?? fallbackNotes(version, changes);
  writeFileSync(path.join(outputDir, 'changelog.md'), `${changelog}\n`);
  writeFileSync(path.join(outputDir, 'card-mdx.txt'), `${card}\n`);
  console.log(`${changelog}\n\n${card}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
