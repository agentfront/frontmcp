import { Dict, InvokeState, InvokeStateInstance } from './invoker.state';
import { CreateOptions, RunOptions } from './invoker.types';
import { FlowAsCtxStatics, Newable } from './invoker.flow';
import { FlowName } from '../plugin/plugin.types';
import { getMetadata } from '../utils/metadata.utils';
import { DecoratorMD } from './invoker.decorators';

export const useInvokeState = <T extends Dict>(initialState?: T): InvokeStateInstance<T> =>{
  return InvokeState.create<T>(initialState);
}


export const useCreateInvoker = <In,Out,A extends any[] = any[],F = any>(
  superCls: Newable<A, F> & FlowAsCtxStatics,
  options: CreateOptions
) => {
  // get InvokePlan's deocator name property
  const name = getMetadata(DecoratorMD.PLAN_NAME, superCls) as FlowName;
  return superCls.createInvoker.bind(superCls as any)(name, options) as RunOptions<In, Out>
}
