// invoker/invoker.context.ts

import { InvokePhase } from './invoker.types';
import { ControlRespond } from './invoker.control';
import { ProviderScope, Token, ScopeEntry } from '@frontmcp/sdk';
import { Scope } from '../scope/scope.instance';

type HistoryEntry<T> = {
  at: number; // epoch ms
  stage?: string; // ctx.activeStage at time of set
  phase?: InvokePhase; // ctx.phase at time of set
  value: T | undefined;
  note?: string; // optional free-text (e.g., 'init')
};

export abstract class InvokerContext<
  TRawIn = unknown, // transport/raw input (HTTP req, DB row, etc.)
  InputSchemaType = unknown, // validated input (post-Zod)
  OutputSchemaType = unknown, // validated output (post-Zod)
  TErr = unknown,
  TInDraft = Partial<InputSchemaType>, // normalized-but-untrusted input
  TOutDraft = Partial<OutputSchemaType>, // normalized-but-untrusted output
> {
  // required by contract
  public readonly runId: string;
  public data = new Map<string, unknown>();
  public activeStage?: string;
  public phase: InvokePhase = 'pre';
  public readonly startTime = Date.now();
  providers = new Map<ProviderScope, Map<Token, unknown>>();

  // ---- error (public accessor, protected backing field)
  protected _error?: TErr;

  // ---- INPUT storages (backing fields)
  protected _rawInput?: TRawIn;
  protected _inputDraft?: TInDraft;
  protected _input?: InputSchemaType;

  // ---- OUTPUT storages (backing fields)
  protected _outputDraft?: TOutDraft;
  protected _output?: OutputSchemaType;

  // ---- histories
  private readonly _rawInputHistory: HistoryEntry<TRawIn>[] = [];
  private readonly _inputDraftHistory: HistoryEntry<TInDraft>[] = [];
  private readonly _inputHistory: HistoryEntry<InputSchemaType>[] = [];
  private readonly _outputDraftHistory: HistoryEntry<TOutDraft>[] = [];
  private readonly _outputHistory: HistoryEntry<OutputSchemaType>[] = [];

  public get scope(): Scope {
    return this.get(Scope);
  }

  protected constructor(init?: { runId?: string; rawInput?: TRawIn }) {
    this.runId =
      init?.runId ??
      (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `run_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`);

    if (typeof init?.rawInput !== 'undefined') {
      this.rawInput = init.rawInput; // records history, too
      const last = this._lastHistory(this._rawInputHistory);
      if (last) last.note = 'init';
    }
  }

  // =========================
  // RAW INPUT (transport-level)
  // =========================
  public get rawInput(): TRawIn {
    return this._rawInput as TRawIn;
  }

  public set rawInput(v: TRawIn | undefined) {
    this._rawInput = v;
    this._rawInputHistory.push({
      at: Date.now(),
      stage: this.activeStage,
      phase: this.phase,
      value: v,
    });
  }

  public get rawInputHistory(): ReadonlyArray<HistoryEntry<TRawIn>> {
    return this._rawInputHistory;
  }

  // =========================
  // INPUT DRAFT (normalized, untrusted)
  // =========================
  public get inputDraft(): TInDraft | undefined {
    return this._inputDraft;
  }

  public set inputDraft(v: TInDraft | undefined) {
    this._inputDraft = v;
    this._inputDraftHistory.push({
      at: Date.now(),
      stage: this.activeStage,
      phase: this.phase,
      value: v,
    });
  }

  public get inputDraftHistory(): ReadonlyArray<HistoryEntry<TInDraft>> {
    return this._inputDraftHistory;
  }

  // =========================
  // VALIDATED INPUT (Zod-parsed)
  // =========================
  public get input(): InputSchemaType {
    return this._input as InputSchemaType;
  }

  public set input(v: InputSchemaType | undefined) {
    this._input = v;
    this._inputHistory.push({
      at: Date.now(),
      stage: this.activeStage,
      phase: this.phase,
      value: v,
    });
  }

  public get inputHistory(): ReadonlyArray<HistoryEntry<InputSchemaType>> {
    return this._inputHistory;
  }

  // Optional alias
  public get validatedInput(): InputSchemaType | undefined {
    return this.input;
  }

  public set validatedInput(v: InputSchemaType | undefined) {
    this.input = v;
  }

  // =========================
  // OUTPUT DRAFT (normalized, untrusted)
  // =========================
  public get outputDraft(): TOutDraft | undefined {
    return this._outputDraft;
  }

  public set outputDraft(v: TOutDraft | undefined) {
    this._outputDraft = v;
    this._outputDraftHistory.push({
      at: Date.now(),
      stage: this.activeStage,
      phase: this.phase,
      value: v,
    });
  }

  public get outputDraftHistory(): ReadonlyArray<HistoryEntry<TOutDraft>> {
    return this._outputDraftHistory;
  }

  // =========================
  // VALIDATED OUTPUT (Zod-parsed)
  // =========================
  public get output(): OutputSchemaType | undefined {
    return this._output;
  }

  public set output(v: OutputSchemaType | undefined) {
    this._output = v;
    this._outputHistory.push({
      at: Date.now(),
      stage: this.activeStage,
      phase: this.phase,
      value: v,
    });
  }

  public get outputHistory(): ReadonlyArray<HistoryEntry<OutputSchemaType>> {
    return this._outputHistory;
  }

  // Optional alias
  public get validatedOutput(): OutputSchemaType | undefined {
    return this.output;
  }

  public set validatedOutput(v: OutputSchemaType | undefined) {
    this.output = v;
  }

  // ---- error
  public get error(): unknown | undefined {
    return this._error;
  }

  public set error(e: TErr | undefined) {
    this._error = e;
  }

  // ---- DI helpers
  public get<T>(token: Token<T>): T {
    const providerValue = (this.providers.get(ProviderScope.REQUEST)?.get(token) ??
      this.providers.get(ProviderScope.SESSION)?.get(token) ??
      this.providers.get(ProviderScope.GLOBAL)?.get(token)) as T | undefined;

    if (providerValue === undefined) {
      throw new Error(`Provider not found for token: ${(token as any).name.toString()}`);
    }
    return providerValue;
  }


  public bindProvider<T>(token: Token<T>, value: T, scope: ProviderScope): void {
    const providerMap = this.providers.get(scope) ?? new Map<Token, unknown>();
    providerMap.set(token, value);
    this.providers.set(scope, providerMap);
  }

  public bindProviders(bindings: [Token, unknown, ProviderScope][]): void {
    for (const [token, value, scope] of bindings) {
      this.bindProvider(token, value, scope);
    }
  }

  // ---- control helpers

  /** Signal a control response (invoker will treat as success path and run post/finalize). */
  public respond(value: OutputSchemaType): never {
    // record validated output and surface the value via control flow
    this.output = value;
    throw new ControlRespond<OutputSchemaType>(value);
  }

  /** Fail the run (invoker will run error/finalize). */
  public fail(err: unknown): never {
    const asError = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
    this._error = asError as TErr;
    throw asError;
  }

  /** Mark current stage & phase (invoker should call this before executing a stage). */
  public mark(stage: string, phase: InvokePhase): void {
    this.activeStage = stage;
    this.phase = phase;
  }

  // ---- tiny utility
  private _lastHistory<T>(arr: HistoryEntry<T>[]): HistoryEntry<T> | undefined {
    return arr.length ? arr[arr.length - 1] : undefined;
  }
}
