import type { ReviewFinding, ScriptAnalysis, ScriptLocation, ScriptToolCall } from '@enclave-vm/core/worker';

import type { CodeCallFilterToolAnnotations, CodeCallReviewRules } from '../codecall.types';
import { argumentIssuesOf } from './input-schema-check';

/** A tool as the built-in rules read it. */
export interface ReviewedTool {
  name: string;
  annotations?: Readonly<CodeCallFilterToolAnnotations>;
  /** The tool's input schema as JSON Schema, or null when it has none. */
  inputSchema: Readonly<Record<string, unknown>> | null;
}

/** What the rules need from the run: the tools this caller may reach, and whether a person can approve. */
export interface ReviewRulesContext {
  rules: CodeCallReviewRules;
  /** The tool for this name, or undefined when this caller's script may not call it. */
  toolOf(name: string): ReviewedTool | undefined;
  hasApprovalChannel: boolean;
}

/** A destructive call that runs only with an approval. */
export interface ApprovalCall {
  toolName: string;
  args: unknown;
}

/** What the rules decided: a refusal, or the calls that need an approval before they run. */
export interface RulesVerdict {
  refusal?:
    | { decision: 'needs_changes'; findings: ReviewFinding[] }
    | { decision: 'denied'; reason: string; findings: ReviewFinding[] };
  approvalCalls: ApprovalCall[];
}

/** A call the rules judge by its tool's name; a call in a script also has its place. */
interface NamedCall {
  toolName: string;
  location?: ScriptLocation;
}

/** Enclave refuses an answer with more findings, or a longer reason, as out of shape. */
const MAX_FINDINGS = 100;
const MAX_REASON_CHARS = 4096;
/** A script can name any string as a tool; a finding shows at most this much of it. */
const MAX_TOOL_NAME_CHARS = 128;

const NO_APPROVAL_CHANNEL =
  'nobody can approve it here: the server has no Approval plugin, and the client does not support elicitation';

function locationOf(call: { location?: ScriptLocation } | undefined): Pick<ReviewFinding, 'location'> {
  return call?.location ? { location: { line: call.location.line, column: call.location.column } } : {};
}

function shownNameOf(toolName: string): string {
  return toolName.slice(0, MAX_TOOL_NAME_CHARS);
}

function needsChanges(findings: ReviewFinding[]): RulesVerdict {
  return { refusal: { decision: 'needs_changes', findings: findings.slice(0, MAX_FINDINGS) }, approvalCalls: [] };
}

function namesOf(analysis: ScriptAnalysis, indexes: readonly number[]): string {
  const names = indexes.map((index) => analysis.toolCalls[index]?.toolName ?? 'a computed tool');
  return [...new Set(names)].join(', ');
}

/** The built-in rules: in-process checks from tool annotations and input schemas, without a model. */
export class ReviewRules {
  private readonly tools = new Map<string, ReviewedTool | undefined>();

  constructor(private readonly context: ReviewRulesContext) {}

  /** The rules over a script before it runs, from its static analysis. */
  reviewScript(analysis: ScriptAnalysis): RulesVerdict {
    const namedCalls = analysis.toolCalls.filter((call): call is ScriptToolCall & { toolName: string } =>
      Boolean(call.toolName),
    );
    const unavailable = this.unavailableFindings(namedCalls);
    if (unavailable.length > 0) return this.denial(unavailable);
    const noChannel = this.noApprovalChannelFindings(namedCalls);
    if (noChannel.length > 0) return this.denial(noChannel);
    const readThenSend = this.readThenSendFindings(analysis);
    if (readThenSend.length > 0 && this.context.rules.readThenSend === 'denied') return this.denial(readThenSend);
    const changes = [
      ...namedCalls.flatMap((call) => this.inputFindings(call.toolName, call.args ?? {}, this.isComplete(call), call)),
      ...readThenSend,
      ...this.fanOutFindings(analysis),
    ];
    if (changes.length > 0) return needsChanges(changes);
    const approvalCalls = namedCalls
      .filter((call) => this.isComplete(call) && this.isDestructive(call.toolName))
      .map((call) => ({ toolName: call.toolName, args: call.args }));
    return { approvalCalls };
  }

  /** The rules over one call, with the arguments it really has. */
  reviewCall(toolName: string, args: unknown): RulesVerdict {
    const unavailable = this.unavailableFindings([{ toolName }]);
    if (unavailable.length > 0) return this.denial(unavailable);
    const noChannel = this.noApprovalChannelFindings([{ toolName }]);
    if (noChannel.length > 0) return this.denial(noChannel);
    const argumentRecord = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
    const changes = this.inputFindings(toolName, argumentRecord, true);
    if (changes.length > 0) return needsChanges(changes);
    return { approvalCalls: this.isDestructive(toolName) ? [{ toolName, args }] : [] };
  }

  private toolOf(name: string): ReviewedTool | undefined {
    if (!this.tools.has(name)) this.tools.set(name, this.context.toolOf(name));
    return this.tools.get(name);
  }

  private denial(findings: ReviewFinding[]): RulesVerdict {
    const reason = [...new Set(findings.map((finding) => finding.message))].join('; ').slice(0, MAX_REASON_CHARS);
    return { refusal: { decision: 'denied', reason, findings: findings.slice(0, MAX_FINDINGS) }, approvalCalls: [] };
  }

  private isComplete(call: ScriptToolCall): boolean {
    return call.args !== null && call.computedArgs.length === 0;
  }

  private isDestructive(toolName: string): boolean {
    return this.context.rules.destructive && this.toolOf(toolName)?.annotations?.destructiveHint === true;
  }

  private unavailableFindings(calls: readonly NamedCall[]): ReviewFinding[] {
    if (!this.context.rules.availability) return [];
    return calls
      .filter((call) => !this.toolOf(call.toolName))
      .map((call) => ({
        rule: 'unavailable-tool',
        message: `Tool "${shownNameOf(call.toolName)}" is not available to this script`,
        toolName: shownNameOf(call.toolName),
        ...locationOf(call),
      }));
  }

  private noApprovalChannelFindings(calls: readonly NamedCall[]): ReviewFinding[] {
    if (this.context.hasApprovalChannel) return [];
    return calls
      .filter((call) => this.isDestructive(call.toolName))
      .map((call) => ({
        rule: 'destructive-tool',
        message: `Tool "${call.toolName}" is destructive and needs a person's approval, but ${NO_APPROVAL_CHANNEL}`,
        toolName: call.toolName,
        ...locationOf(call),
      }));
  }

  private inputFindings(
    toolName: string,
    args: Readonly<Record<string, unknown>>,
    complete: boolean,
    call?: ScriptToolCall,
  ): ReviewFinding[] {
    const tool = this.toolOf(toolName);
    if (!this.context.rules.inputSchema || !tool) return [];
    return argumentIssuesOf(args, tool.inputSchema, complete).map((issue) => ({
      rule: 'input-schema',
      message: `${toolName}: ${issue.message}`,
      toolName,
      ...(issue.suggestion ? { suggestion: issue.suggestion } : {}),
      ...locationOf(call),
    }));
  }

  private readThenSendFindings(analysis: ScriptAnalysis): ReviewFinding[] {
    if (this.context.rules.readThenSend === false) return [];
    const findings: ReviewFinding[] = [];
    for (const flow of analysis.flows) {
      const source = flow.from === null ? undefined : analysis.toolCalls[flow.from];
      const target = analysis.toolCalls[flow.to];
      if (!source?.toolName || !target?.toolName) continue;
      if (this.toolOf(source.toolName)?.annotations?.readOnlyHint !== true) continue;
      if (this.toolOf(target.toolName)?.annotations?.openWorldHint !== true) continue;
      findings.push({
        rule: 'read-then-send',
        message: `The result of ${source.toolName} flows into the arguments of ${target.toolName}, which reaches outside this server`,
        suggestion: `Return what ${source.toolName} read instead, and let the user decide what ${target.toolName} sends`,
        toolName: target.toolName,
        ...locationOf(target),
      });
    }
    return findings;
  }

  private fanOutFindings(analysis: ScriptAnalysis): ReviewFinding[] {
    if (!this.context.rules.fanOut) return [];
    return analysis.bounds
      .filter((bound) => bound.withinBudget === false)
      .map((bound) => ({
        rule: 'fan-out',
        message: `A loop over the result of ${namesOf(analysis, bound.over)} calls ${namesOf(analysis, bound.calls)} with no bound below the call budget`,
        suggestion: 'Cut the items before the loop, for example with .slice(0, 20), or filter them first',
        ...locationOf(bound),
      }));
  }
}
