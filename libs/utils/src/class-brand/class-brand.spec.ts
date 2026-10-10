import { brandClass, isBrandedInstance } from './class-brand';

/** Two copies of one package's class hierarchy, as two module instances of the package would have. */
function copyOfPackage() {
  class Base extends Error {
    static override [Symbol.hasInstance](value: unknown): boolean {
      return isBrandedInstance(this, value);
    }
  }
  brandClass(Base, 'spec:Base');

  class Branded extends Base {}
  brandClass(Branded, 'spec:Branded');

  class Unbranded extends Base {}

  class Sibling extends Base {}
  brandClass(Sibling, 'spec:Sibling');

  return { Base, Branded, Unbranded, Sibling };
}

const local = copyOfPackage();
const foreign = copyOfPackage();

describe('class brands across two copies of a package', () => {
  it('recognises instances of the same branded class from the other copy', () => {
    expect(new foreign.Base()).toBeInstanceOf(local.Base);
    expect(new foreign.Branded()).toBeInstanceOf(local.Branded);
    expect(new foreign.Branded()).toBeInstanceOf(local.Base);
  });

  it('keeps subclass checks exact', () => {
    expect(new foreign.Base() instanceof local.Branded).toBe(false);
    expect(new foreign.Sibling() instanceof local.Branded).toBe(false);
    expect(new foreign.Unbranded() instanceof local.Base).toBe(true);
    // An unbranded subclass has only the plain check: its own instances match, the other copy's do not.
    expect(new foreign.Unbranded() instanceof local.Unbranded).toBe(false);
    expect(new local.Unbranded() instanceof local.Unbranded).toBe(true);
  });

  it('does not recognise values outside the hierarchy', () => {
    class Lookalike extends Error {}
    Object.defineProperty(Lookalike, 'name', { value: 'Base' });

    expect(new Lookalike() instanceof local.Base).toBe(false);
    expect(new Error('x') instanceof local.Base).toBe(false);
    expect(Object.create(null) instanceof local.Base).toBe(false);
    expect((undefined as unknown) instanceof local.Base).toBe(false);
    expect(('Base' as unknown) instanceof local.Base).toBe(false);
  });

  it("does not trust an object's own constructor field", () => {
    expect(isBrandedInstance(local.Base, { constructor: foreign.Base })).toBe(false);
  });
});

describe('isBrandedInstance', () => {
  it('is the plain check for a class without a brand', () => {
    class Plain {}
    class Sub extends Plain {}

    expect(isBrandedInstance(Plain, new Sub())).toBe(true);
    expect(isBrandedInstance(Sub, new Plain())).toBe(false);
  });

  it('reads a brand off a prototype chain that has no constructor', () => {
    const bare = Object.create(Object.create(null) as object) as object;

    expect(isBrandedInstance(local.Base, bare)).toBe(false);
  });
});

describe('brandClass', () => {
  it('sets a brand that cannot be changed or enumerated', () => {
    class Fixed {}
    brandClass(Fixed, 'spec:Fixed');

    expect(() => brandClass(Fixed, 'spec:Other')).toThrow(TypeError);
    expect(Object.keys(Fixed)).toEqual([]);
  });
});
