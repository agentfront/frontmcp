import { ExamplePage } from './ExamplePage';

describe('ExamplePage', () => {
  it('should be defined', () => {
    expect(ExamplePage).toBeDefined();
  });

  it('should be a function component', () => {
    expect(typeof ExamplePage).toBe('function');
  });
});
