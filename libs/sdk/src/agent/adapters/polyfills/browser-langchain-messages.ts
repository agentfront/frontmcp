// Stub for @langchain/core/messages in browser builds
class StubMessage {
  content: string;
  constructor(content: string | Record<string, unknown>) {
    this.content = typeof content === 'string' ? content : JSON.stringify(content);
  }
  _getType(): string {
    return 'base';
  }
}
export class SystemMessage extends StubMessage {
  override _getType() {
    return 'system';
  }
}
export class HumanMessage extends StubMessage {
  override _getType() {
    return 'human';
  }
}
export class AIMessage extends StubMessage {
  override _getType() {
    return 'ai';
  }
}
export class ToolMessage extends StubMessage {
  tool_call_id: string;
  name?: string;
  constructor(fields: { content: string | Record<string, unknown>; tool_call_id: string; name?: string }) {
    super(fields.content);
    this.tool_call_id = fields.tool_call_id;
    this.name = fields.name;
  }
  override _getType() {
    return 'tool';
  }
}
export class BaseMessage extends StubMessage {}
export class ChatMessage extends StubMessage {}
