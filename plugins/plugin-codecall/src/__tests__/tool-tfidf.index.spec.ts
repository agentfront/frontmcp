import { stemTerm, ToolTfidfIndex } from '../services/tool-tfidf.index';

describe('stemTerm', () => {
  it.each([
    ['users', 'user'],
    ['user', 'user'],
    ['policies', 'policy'],
    ['boxes', 'box'],
    ['matches', 'match'],
    ['addresses', 'address'],
    ['messages', 'message'],
    ['status', 'status'],
    ['access', 'access'],
    ['analysis', 'analysis'],
    ['gas', 'gas'],
  ])('stems %j to %j', (term, stem) => {
    expect(stemTerm(term)).toBe(stem);
  });
});

describe('ToolTfidfIndex', () => {
  const index = new ToolTfidfIndex(
    [
      { id: 'a', text: 'send the email', metadata: 'a' },
      { id: 'b', text: 'archive the email', metadata: 'b' },
    ],
    new Set(['the']),
  );

  it('scores a term every document has above zero', () => {
    const results = index.search('email', { topK: 5, threshold: 0 });
    expect(results.map((result) => result.id).sort()).toEqual(['a', 'b']);
    expect(results.every((result) => result.score > 0)).toBe(true);
  });

  it('ranks the document with the rarer term first, and leaves out stop words', () => {
    expect(index.search('send email', { topK: 5, threshold: 0 })[0]?.id).toBe('a');
    expect(index.search('the', { topK: 5, threshold: 0 }).every((result) => result.score === 0)).toBe(true);
  });

  it('applies the threshold, the filter and topK', () => {
    expect(index.search('send', { topK: 5, threshold: 0.01 }).map((result) => result.id)).toEqual(['a']);
    expect(
      index.search('email', { topK: 5, threshold: 0, filter: (metadata) => metadata === 'b' }).map((r) => r.id),
    ).toEqual(['b']);
    expect(index.search('email', { topK: 1, threshold: 0 })).toHaveLength(1);
  });

  it('knows its documents', () => {
    expect(index.getAllDocumentIds()).toEqual(['a', 'b']);
    expect(index.getDocumentCount()).toBe(2);
    expect(index.hasDocument('a')).toBe(true);
    expect(index.hasDocument('c')).toBe(false);
  });
});
