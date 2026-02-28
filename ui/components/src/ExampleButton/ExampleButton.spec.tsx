import { ExampleButton } from './ExampleButton';

describe('ExampleButton', () => {
  it('should be defined', () => {
    expect(ExampleButton).toBeDefined();
  });

  it('should be a function component', () => {
    expect(typeof ExampleButton).toBe('function');
  });
});
