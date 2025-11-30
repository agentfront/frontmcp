import { SynonymExpansionService } from '../services/synonym-expansion.service';

describe('SynonymExpansionService', () => {
  describe('getSynonyms', () => {
    it('should return synonyms for known terms', () => {
      const service = new SynonymExpansionService();
      const synonyms = service.getSynonyms('add');

      expect(synonyms).toContain('create');
      expect(synonyms).toContain('new');
      expect(synonyms).toContain('insert');
      expect(synonyms).toContain('make');
    });

    it('should return empty array for unknown terms', () => {
      const service = new SynonymExpansionService();
      const synonyms = service.getSynonyms('unknownxyz123');

      expect(synonyms).toEqual([]);
    });

    it('should be case insensitive', () => {
      const service = new SynonymExpansionService();
      const lower = service.getSynonyms('add');
      const upper = service.getSynonyms('ADD');
      const mixed = service.getSynonyms('AdD');

      expect(lower).toEqual(upper);
      expect(lower).toEqual(mixed);
    });

    it('should support bidirectional synonyms', () => {
      const service = new SynonymExpansionService();

      // add -> create
      expect(service.getSynonyms('add')).toContain('create');
      // create -> add
      expect(service.getSynonyms('create')).toContain('add');
    });

    it('should respect maxExpansionsPerTerm limit', () => {
      const service = new SynonymExpansionService({ maxExpansionsPerTerm: 2 });
      const synonyms = service.getSynonyms('add');

      expect(synonyms.length).toBeLessThanOrEqual(2);
    });
  });

  describe('expandQuery', () => {
    it('should expand query with synonyms', () => {
      const service = new SynonymExpansionService();
      const expanded = service.expandQuery('add user');

      // Should contain original terms
      expect(expanded).toContain('add');
      expect(expanded).toContain('user');

      // Should contain synonyms for "add"
      expect(expanded).toContain('create');

      // Should contain synonyms for "user"
      expect(expanded).toContain('account');
    });

    it('should keep original terms first', () => {
      const service = new SynonymExpansionService();
      const expanded = service.expandQuery('add');
      const parts = expanded.split(' ');

      // Original term should be first
      expect(parts[0]).toBe('add');
    });

    it('should filter out single-character terms', () => {
      const service = new SynonymExpansionService();
      const expanded = service.expandQuery('a add');

      // "a" should be filtered out
      expect(expanded.split(' ')).not.toContain('a');
    });

    it('should handle queries without known synonyms', () => {
      const service = new SynonymExpansionService();
      const expanded = service.expandQuery('xyz123');

      expect(expanded).toBe('xyz123');
    });

    it('should lowercase all terms', () => {
      const service = new SynonymExpansionService();
      const expanded = service.expandQuery('ADD USER');

      expect(expanded).toBe(expanded.toLowerCase());
    });
  });

  describe('hasExpansions', () => {
    it('should return true if any term has synonyms', () => {
      const service = new SynonymExpansionService();

      expect(service.hasExpansions('add something')).toBe(true);
      expect(service.hasExpansions('create user')).toBe(true);
    });

    it('should return false if no terms have synonyms', () => {
      const service = new SynonymExpansionService();

      expect(service.hasExpansions('xyz123 abc456')).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return term count and average synonyms', () => {
      const service = new SynonymExpansionService();
      const stats = service.getStats();

      expect(stats.termCount).toBeGreaterThan(0);
      expect(stats.avgSynonymsPerTerm).toBeGreaterThan(0);
    });
  });

  describe('configuration', () => {
    it('should accept additional synonym groups', () => {
      const service = new SynonymExpansionService({
        additionalSynonyms: [['automobile', 'car', 'vehicle']],
      });

      expect(service.getSynonyms('automobile')).toContain('car');
      expect(service.getSynonyms('car')).toContain('vehicle');
      expect(service.getSynonyms('vehicle')).toContain('automobile');
    });

    it('should merge additional synonyms with defaults', () => {
      const service = new SynonymExpansionService({
        additionalSynonyms: [['custom', 'term']],
      });

      // Should still have defaults
      expect(service.getSynonyms('add')).toContain('create');

      // Should also have custom synonyms
      expect(service.getSynonyms('custom')).toContain('term');
    });

    it('should replace defaults when replaceDefaults is true', () => {
      const service = new SynonymExpansionService({
        additionalSynonyms: [['custom', 'term']],
        replaceDefaults: true,
      });

      // Should NOT have defaults
      expect(service.getSynonyms('add')).toEqual([]);

      // Should have custom synonyms
      expect(service.getSynonyms('custom')).toContain('term');
    });
  });

  describe('default synonym groups', () => {
    const service = new SynonymExpansionService();

    it('should have CRUD verb synonyms', () => {
      // Create
      expect(service.getSynonyms('add')).toContain('create');
      expect(service.getSynonyms('create')).toContain('new');

      // Delete
      expect(service.getSynonyms('delete')).toContain('remove');
      expect(service.getSynonyms('remove')).toContain('destroy');

      // Read
      expect(service.getSynonyms('get')).toContain('fetch');
      expect(service.getSynonyms('fetch')).toContain('retrieve');

      // Update
      expect(service.getSynonyms('update')).toContain('edit');
      expect(service.getSynonyms('edit')).toContain('modify');
    });

    it('should have list/display synonyms', () => {
      expect(service.getSynonyms('list')).toContain('show');
      expect(service.getSynonyms('show')).toContain('display');
    });

    it('should have search/find synonyms', () => {
      expect(service.getSynonyms('find')).toContain('search');
      expect(service.getSynonyms('search')).toContain('lookup');
    });

    it('should have user/account entity synonyms', () => {
      expect(service.getSynonyms('user')).toContain('account');
      expect(service.getSynonyms('account')).toContain('member');
    });
  });

  describe('real-world use cases', () => {
    const service = new SynonymExpansionService();

    it('should expand "add user" to match "create user" tools', () => {
      const expanded = service.expandQuery('add user');

      // The expanded query should contain "create" which matches "Create a new user"
      expect(expanded).toContain('create');
    });

    it('should expand "remove account" to match "delete user" tools', () => {
      const expanded = service.expandQuery('remove account');

      expect(expanded).toContain('delete');
      expect(expanded).toContain('user');
    });

    it('should expand "fetch settings" to match "get config" tools', () => {
      const expanded = service.expandQuery('fetch settings');

      expect(expanded).toContain('get');
      expect(expanded).toContain('config');
    });
  });
});
