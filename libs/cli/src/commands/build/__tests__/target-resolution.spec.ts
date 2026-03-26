import { toParsedArgs } from '../../../core/bridge';

describe('Build target resolution', () => {
  describe('--target flag', () => {
    it('--target cli should set buildTarget to cli', () => {
      const args = toParsedArgs('build', [], { target: 'cli' });
      expect(args.buildTarget).toBe('cli');
    });

    it('--target cli --js should set buildTarget and js', () => {
      const args = toParsedArgs('build', [], { target: 'cli', js: true });
      expect(args.buildTarget).toBe('cli');
      expect(args.js).toBe(true);
    });

    it('--target node should set buildTarget to node', () => {
      const args = toParsedArgs('build', [], { target: 'node' });
      expect(args.buildTarget).toBe('node');
    });

    it('--target sdk should set buildTarget to sdk', () => {
      const args = toParsedArgs('build', [], { target: 'sdk' });
      expect(args.buildTarget).toBe('sdk');
    });

    it('--target browser should set buildTarget to browser', () => {
      const args = toParsedArgs('build', [], { target: 'browser' });
      expect(args.buildTarget).toBe('browser');
    });

    it('--target vercel should set buildTarget to vercel', () => {
      const args = toParsedArgs('build', [], { target: 'vercel' });
      expect(args.buildTarget).toBe('vercel');
    });

    it('--target lambda should set buildTarget to lambda', () => {
      const args = toParsedArgs('build', [], { target: 'lambda' });
      expect(args.buildTarget).toBe('lambda');
    });

    it('--target cloudflare should set buildTarget to cloudflare', () => {
      const args = toParsedArgs('build', [], { target: 'cloudflare' });
      expect(args.buildTarget).toBe('cloudflare');
    });
  });

  describe('non-build commands should not resolve target', () => {
    it('create --target should not set buildTarget', () => {
      const args = toParsedArgs('create', [], { target: 'vercel' });
      expect(args.buildTarget).toBeUndefined();
      expect(args.target).toBe('vercel');
    });
  });
});
