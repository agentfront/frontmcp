import { type SkillContent } from '../../common/interfaces';
import {
  identifierWords,
  instructionTerms,
  MAX_INSTRUCTION_TERMS,
  queryTerms,
  queryTermShare,
  skillSearchText,
} from '../skill-search-text';

const skill = (overrides: Partial<SkillContent> = {}): SkillContent => ({
  id: 'store',
  name: 'Store',
  description: 'Count the pets in stock.',
  instructions: '',
  tools: [],
  ...overrides,
});

describe('identifierWords', () => {
  it.each([
    ['getInventory', 'get Inventory'],
    ['find_pets_by-status', 'find pets by status'],
    ['HTTPHeaders2', 'HTTP Headers 2'],
    ['acme:billing.refund', 'acme billing refund'],
    ['inventory', 'inventory'],
  ])('splits %s into words', (identifier, words) => {
    expect(identifierWords(identifier)).toBe(words);
  });
});

describe('instructionTerms', () => {
  it('keeps distinct words of four or more letters, and the words of identifiers', () => {
    expect(instructionTerms('# Store\n\nUse getInventory for the inventory. Use the inventory again.')).toEqual([
      'store',
      'getinventory',
      'inventory',
      'again',
    ]);
  });

  it('leaves out stop words', () => {
    expect(instructionTerms('please help with these things')).toEqual(['things']);
  });

  it(`keeps at most ${MAX_INSTRUCTION_TERMS} terms, so long instructions don't dilute the description`, () => {
    const words = Array.from({ length: 200 }, (_, i) => `word${i.toString().padStart(3, '0')}`);
    const terms = instructionTerms(words.join(' '));

    expect(terms).toHaveLength(MAX_INSTRUCTION_TERMS);
    expect(terms[0]).toBe('word000');
  });
});

describe('skillSearchText', () => {
  it("has a bundle skill's actions: their ids as words, summaries and descriptions (#1060)", () => {
    const text = skillSearchText(
      skill({
        actions: [
          {
            actionId: 'getInventory',
            summary: 'Returns pet inventories by status.',
            description: 'A map of status codes to quantities.',
            inputJsonSchema: {},
            outputJsonSchema: {},
          },
        ],
      }),
    );

    expect(text).toContain('getInventory get Inventory');
    expect(text).toContain('Returns pet inventories by status.');
    expect(text).toContain('A map of status codes to quantities.');
  });

  it('has the terms of the instructions once each, after the rest', () => {
    const text = skillSearchText(skill({ instructions: 'Use getInventory for the inventory, then the inventory.' }));

    expect(text.endsWith('getinventory inventory then')).toBe(true);
    expect(text.split(' ').filter((word) => word === 'inventory')).toHaveLength(1);
  });

  it('has the tags twice', () => {
    expect(
      skillSearchText(skill({ tags: ['puppies'] }))
        .split(' ')
        .filter((w) => w === 'puppies'),
    ).toHaveLength(2);
  });
});

describe('queryTermShare', () => {
  it('is the share of the query terms the text contains, stop words left out', () => {
    expect(queryTermShare(queryTerms('show me the inventories by status'), 'pet inventories')).toBe(1 / 3);
    expect(queryTermShare(queryTerms('inventories'), 'pet inventories')).toBe(1);
    expect(queryTermShare(queryTerms('the'), 'the store')).toBe(0);
  });
});
