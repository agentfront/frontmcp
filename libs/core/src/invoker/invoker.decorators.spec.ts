import {
  InvokePlan,
  DecoratorMD,
  Plan,
  StagesFromPlan,
} from './invoker.decorators';
import 'reflect-metadata';

describe('invoker.decorators', () => {
  describe('InvokePlan', () => {
    it('should attach plan metadata to class', () => {
      const plan: Plan<'stage1' | 'stage2'> = {
        name: 'testPlan',
        pre: ['stage1'],
        execute: ['stage2'],
        post: [],
        finalize: [],
        error: [],
      };

      @InvokePlan(plan)
      class TestFlow {}

      const metadata = Reflect.getMetadata(DecoratorMD.PLAN, TestFlow);
      expect(metadata).toEqual(plan);
    });

    it('should attach plan name metadata to class', () => {
      const plan: Plan<'stage1'> = {
        name: 'myPlan',
        pre: ['stage1'],
        execute: [],
        post: [],
        finalize: [],
        error: [],
      };

      @InvokePlan(plan)
      class TestFlow {}

      const planName = Reflect.getMetadata(DecoratorMD.PLAN_NAME, TestFlow);
      expect(planName).toBe('myPlan');
    });

    it('should attach dependencies metadata when provided', () => {
      const plan: Plan<'stage1'> = {
        name: 'testPlan',
        pre: ['stage1'],
        execute: [],
        post: [],
        finalize: [],
        error: [],
      };

      const mockToken1 = Symbol('dep1');
      const mockToken2 = Symbol('dep2');

      @InvokePlan(plan, { dependsOn: [mockToken1, mockToken2] })
      class TestFlow {}

      const deps = Reflect.getMetadata(DecoratorMD.PLAN_DEPENDS_ON, TestFlow);
      expect(deps).toEqual([mockToken1, mockToken2]);
    });

    it('should work without dependencies option', () => {
      const plan: Plan<'stage1'> = {
        name: 'simplePlan',
        pre: ['stage1'],
        execute: [],
        post: [],
        finalize: [],
        error: [],
      };

      @InvokePlan(plan)
      class TestFlow {}

      const metadata = Reflect.getMetadata(DecoratorMD.PLAN, TestFlow);
      expect(metadata).toBeDefined();
    });

    it('should handle plan with all lifecycle stages', () => {
      const plan: Plan<'pre1' | 'exec1' | 'post1' | 'final1' | 'err1'> = {
        name: 'fullPlan',
        pre: ['pre1'],
        execute: ['exec1'],
        post: ['post1'],
        finalize: ['final1'],
        error: ['err1'],
      };

      @InvokePlan(plan)
      class TestFlow {}

      const metadata = Reflect.getMetadata(DecoratorMD.PLAN, TestFlow);
      expect(metadata.pre).toEqual(['pre1']);
      expect(metadata.execute).toEqual(['exec1']);
      expect(metadata.post).toEqual(['post1']);
      expect(metadata.finalize).toEqual(['final1']);
      expect(metadata.error).toEqual(['err1']);
    });

    it('should handle plan with multiple stages in each phase', () => {
      const plan: Plan<'stage1' | 'stage2' | 'stage3'> = {
        name: 'multiStagePlan',
        pre: ['stage1', 'stage2'],
        execute: ['stage3'],
        post: [],
        finalize: [],
        error: [],
      };

      @InvokePlan(plan)
      class TestFlow {}

      const metadata = Reflect.getMetadata(DecoratorMD.PLAN, TestFlow);
      expect(metadata.pre).toHaveLength(2);
      expect(metadata.pre).toContain('stage1');
      expect(metadata.pre).toContain('stage2');
    });

    it('should handle empty stage arrays', () => {
      const plan: Plan<never> = {
        name: 'emptyPlan',
        pre: [],
        execute: [],
        post: [],
        finalize: [],
        error: [],
      };

      @InvokePlan(plan)
      class TestFlow {}

      const metadata = Reflect.getMetadata(DecoratorMD.PLAN, TestFlow);
      expect(metadata.pre).toEqual([]);
      expect(metadata.execute).toEqual([]);
    });
  });

  describe('StagesFromPlan', () => {
    it('should extract all stage names from a plan', () => {
      const plan = {
        name: 'testPlan',
        pre: ['preStage1', 'preStage2'],
        execute: ['execStage1'],
        post: ['postStage1'],
        finalize: ['finalStage1'],
        error: ['errorStage1'],
      } as const;

      type ExtractedStages = StagesFromPlan<typeof plan>;

      // Type test - this should compile without errors
      const stage1: ExtractedStages = 'preStage1';
      const stage2: ExtractedStages = 'preStage2';
      const stage3: ExtractedStages = 'execStage1';
      const stage4: ExtractedStages = 'postStage1';
      const stage5: ExtractedStages = 'finalStage1';
      const stage6: ExtractedStages = 'errorStage1';

      expect(stage1).toBe('preStage1');
      expect(stage2).toBe('preStage2');
      expect(stage3).toBe('execStage1');
      expect(stage4).toBe('postStage1');
      expect(stage5).toBe('finalStage1');
      expect(stage6).toBe('errorStage1');
    });
  });

  describe('DecoratorMD symbols', () => {
    it('should provide unique symbols for metadata keys', () => {
      expect(DecoratorMD.HOOKS).toBeDefined();
      expect(DecoratorMD.PLAN).toBeDefined();
      expect(DecoratorMD.PLAN_NAME).toBeDefined();
      expect(DecoratorMD.PLAN_DEPENDS_ON).toBeDefined();
    });

    it('should use Symbol.for for consistent symbol creation', () => {
      expect(DecoratorMD.HOOKS.toString()).toContain('invoker:hooks');
      expect(DecoratorMD.PLAN.toString()).toContain('invoker:plan');
      expect(DecoratorMD.PLAN_NAME.toString()).toContain('invoker:plan:name');
      expect(DecoratorMD.PLAN_DEPENDS_ON.toString()).toContain('invoker:plan:dependsOn');
    });
  });

  describe('Integration tests', () => {
    it('should allow multiple decorators on same class', () => {
      const plan: Plan<'stage1'> = {
        name: 'multiDecoratorPlan',
        pre: ['stage1'],
        execute: [],
        post: [],
        finalize: [],
        error: [],
      };

      const token = Symbol('dep');

      @InvokePlan(plan, { dependsOn: [token] })
      class TestFlow {}

      const planMeta = Reflect.getMetadata(DecoratorMD.PLAN, TestFlow);
      const depsMeta = Reflect.getMetadata(DecoratorMD.PLAN_DEPENDS_ON, TestFlow);

      expect(planMeta).toBeDefined();
      expect(depsMeta).toContain(token);
    });

    it('should not interfere with other class metadata', () => {
      const plan: Plan<'stage1'> = {
        name: 'isolatedPlan',
        pre: ['stage1'],
        execute: [],
        post: [],
        finalize: [],
        error: [],
      };

      @InvokePlan(plan)
      class TestFlow1 {}

      @InvokePlan({ ...plan, name: 'anotherPlan' })
      class TestFlow2 {}

      const meta1 = Reflect.getMetadata(DecoratorMD.PLAN, TestFlow1);
      const meta2 = Reflect.getMetadata(DecoratorMD.PLAN, TestFlow2);

      expect(meta1.name).toBe('isolatedPlan');
      expect(meta2.name).toBe('anotherPlan');
    });

    it('should handle readonly arrays in plan', () => {
      const plan = {
        name: 'readonlyPlan',
        pre: ['stage1'] as const,
        execute: ['stage2'] as const,
        post: [] as const,
        finalize: [] as const,
        error: [] as const,
      } as const satisfies Plan<'stage1' | 'stage2'>;

      @InvokePlan(plan)
      class TestFlow {}

      const metadata = Reflect.getMetadata(DecoratorMD.PLAN, TestFlow);
      expect(metadata).toEqual(plan);
    });

    it('should handle complex dependency tokens', () => {
      const plan: Plan<'stage1'> = {
        name: 'complexDepsPlan',
        pre: ['stage1'],
        execute: [],
        post: [],
        finalize: [],
        error: [],
      };

      class Service1 {}
      class Service2 {}
      const symbolToken = Symbol('service3');

      @InvokePlan(plan, { dependsOn: [Service1, Service2, symbolToken] })
      class TestFlow {}

      const deps = Reflect.getMetadata(DecoratorMD.PLAN_DEPENDS_ON, TestFlow);
      expect(deps).toHaveLength(3);
      expect(deps).toContain(Service1);
      expect(deps).toContain(Service2);
      expect(deps).toContain(symbolToken);
    });
  });
});