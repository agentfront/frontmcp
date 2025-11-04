import { FuncType, Type } from './base.interface';


interface PromptInterface {

}

type PromptType =
  | Type<PromptInterface>
  | FuncType<PromptInterface>;


export {
  PromptInterface,
  PromptInterface as FrontMcpPromptInterface,
  PromptType,
  PromptType as FrontMcpPromptType,
};

