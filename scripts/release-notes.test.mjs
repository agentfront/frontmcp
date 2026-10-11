import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fallbackNotes, parseNotes, pullRequestNumber } from './release-notes.mjs';

const card = (version, highlights) => `<Card
  title="FrontMCP v${version}: Docs for your agent"
  href="https://github.com/agentfront/frontmcp/releases/tag/v${version}"
  cta="View full changelog"
>
  New workspaces point at the docs server.
${highlights}
</Card>`;

test('finds the pull request of a merge commit and of a squashed one', () => {
  assert.equal(pullRequestNumber('Merge pull request #848 from agentfront/chore/1.9.x-docs-mcp-server'), 848);
  assert.equal(pullRequestNumber('fix(cli): build options for cli/node (#845)'), 845);
  assert.equal(pullRequestNumber('fix(nx-plugin): point new workspaces at the docs server'), undefined);
});

test('keeps a changelog and its Card, with a blank line between highlights', () => {
  const highlights = '  \u{1F50C} **Docs server** – Workspaces use it.\n  \u{1F4DD} **Skills** – They name it.';
  const answer = `**Bug Fixes**\n\n- New workspaces use the docs server.\n\n---CARD_MDX---\n\n\`\`\`mdx\n${card('1.9.6', highlights)}\n\`\`\``;

  const notes = parseNotes(answer, '1.9.6');

  assert.equal(notes.changelog, '**Bug Fixes**\n\n- New workspaces use the docs server.');
  assert.match(notes.card, /^<Card\b[\s\S]*<\/Card>$/);
  assert.match(notes.card, /use it\.\n\n {2}\u{1F4DD} \*\*Skills\*\*/u);
});

test('turns down an answer that is not a changelog and a Card', () => {
  const highlight = '  \u{1F50C} **Docs server** – Workspaces use it.';
  const apology = "I'm sorry, but the diff only shows version bumps. Could you provide more details about the changes?";
  assert.equal(parseNotes(apology, '1.9.6'), undefined);
  assert.equal(parseNotes(`- A change\n---CARD_MDX---\n${card('1.9.5', highlight)}`, '1.9.6'), undefined);
  assert.equal(parseNotes(`- A change\n---CARD_MDX---\n${card('1.9.6', '')}`, '1.9.6'), undefined);
  assert.equal(parseNotes(`No changes.\n---CARD_MDX---\n${card('1.9.6', highlight)}`, '1.9.6'), undefined);
});

test('builds the notes from pull request titles, leaving out chores', () => {
  const changes = [
    { number: 848, title: "fix(nx-plugin): point new workspaces at frontmcp.dev's docs MCP server", body: '' },
    { number: 850, title: 'feat(sdk): tool timeouts', body: '' },
    { number: 851, title: 'chore: tidy the scripts', body: '' },
    { title: 'Faster CLI startup', body: '' },
  ];

  const { changelog, card: fallbackCard } = fallbackNotes('1.9.7', changes);

  assert.equal(
    changelog,
    [
      '**Features**',
      '',
      '- **sdk:** Tool timeouts (#850)',
      '',
      '**Improvements**',
      '',
      '- Faster CLI startup',
      '',
      '**Bug Fixes**',
      '',
      "- **nx-plugin:** Point new workspaces at frontmcp.dev's docs MCP server (#848)",
    ].join('\n'),
  );
  assert.match(fallbackCard, /title="FrontMCP v1\.9\.7: Features, improvements, and bug fixes"/);
  assert.match(fallbackCard, /This release brings 1 feature, 1 improvement, and 1 fix\./);
  assert.match(fallbackCard, /\*\*sdk\*\* – Tool timeouts\.\n\n {2}\*\*nx-plugin\*\* – Point/);
  assert.doesNotMatch(fallbackCard, /tidy/);
  assert.deepEqual(parseNotes(`${changelog}\n---CARD_MDX---\n${fallbackCard}`, '1.9.7'), {
    changelog,
    card: fallbackCard,
  });
});

test('puts breaking changes first, even a breaking chore, and leaves out changes with no title', () => {
  const changes = [
    { number: 852, title: 'fix(cli): quieter output', body: '' },
    { number: 853, title: 'feat(sdk)!: remove the legacy API', body: '' },
    { number: 854, title: 'chore!: drop Node 20', body: '' },
    { number: 855, title: '', body: '' },
  ];

  const { changelog, card: fallbackCard } = fallbackNotes('2.0.0', changes);

  assert.match(
    changelog,
    /^\*\*Breaking Changes\*\*\n\n- \*\*sdk:\*\* Remove the legacy API \(#853\)\n- Drop Node 20 \(#854\)/,
  );
  assert.doesNotMatch(changelog, /#855/);
  assert.match(fallbackCard, /title="FrontMCP v2\.0\.0: Breaking changes and bug fixes"/);
  assert.match(
    fallbackCard,
    /\*\*Breaking change \(sdk\)\*\* – Remove the legacy API\.\n\n {2}\*\*Breaking change\*\* – Drop/,
  );
});

test('says so when a release has only chores', () => {
  const { changelog, card: fallbackCard } = fallbackNotes('1.9.7', [{ number: 851, title: 'ci: cache Nx', body: '' }]);

  assert.equal(changelog, '- Maintenance only: no user-facing changes.');
  assert.match(fallbackCard, /title="FrontMCP v1\.9\.7: Maintenance release"/);
  assert.match(fallbackCard, /This release has no user-facing changes\./);
});
