import type { ReviewerTool } from '@enclave-vm/core/worker';

import { Provider, ProviderScope } from '@frontmcp/sdk';
import { canonicalJson, sha256Hex } from '@frontmcp/utils';

import type { CodeCallReviewOptions, CodeCallVmRuntime } from '../codecall.types';
import { loadWorkerEntry } from '../services/runtime/interpreter.runtime';
import { loadNodeVmModule } from '../services/runtime/node-vm.runtime';
import type { CodeCallPreReviewer } from './run-review';

/** Enclave's reviewer factories, from the entry point the runtime runs scripts with. */
export interface EnclaveReviewerFactories {
  functionReviewer: typeof import('@enclave-vm/core/worker').functionReviewer;
  providerReviewer: typeof import('@enclave-vm/core/worker').providerReviewer;
}

export type EnclaveReviewerLoader = (runtime: CodeCallVmRuntime) => Promise<EnclaveReviewerFactories>;

/**
 * The factories come from the entry the runtime loads: a reviewer's failure keeps its message only in an Enclave of
 * the same entry, since each entry has its own `ReviewerError`.
 */
const loadReviewerFactories: EnclaveReviewerLoader = async (runtime) =>
  (runtime === 'node-vm' ? await loadNodeVmModule() : await loadWorkerEntry()) as unknown as EnclaveReviewerFactories;

/** The version of the review policy an approval is bound to: the options that decide, never the API key. */
function policyVersionOf(options: CodeCallReviewOptions): string {
  const { rules, provider, reviewer, policy, policyVersion } = options;
  return sha256Hex(
    canonicalJson({
      rules,
      model: provider?.model ?? null,
      reviewer: reviewer !== undefined,
      policy: policy ?? null,
      policyVersion: policyVersion ?? null,
    }),
  );
}

/** The server's `review` options, and the reviewers they configure, made again when the tools change. */
@Provider({
  name: 'codecall:review',
  description: "Reviews CodeCall scripts and calls with the server's rules and reviewers",
  scope: ProviderScope.GLOBAL,
})
export default class CodeCallReviewService {
  readonly policyVersion: string;
  private cached?: { signature: string; reviewers: Promise<readonly CodeCallPreReviewer[]> };

  constructor(
    readonly options: CodeCallReviewOptions,
    private readonly runtime: CodeCallVmRuntime,
    private readonly loadFactories: EnclaveReviewerLoader = loadReviewerFactories,
  ) {
    this.policyVersion = policyVersionOf(options);
  }

  /** Whether the server configured a provider or a function reviewer. */
  get hasReviewers(): boolean {
    return this.options.provider !== undefined || this.options.reviewer !== undefined;
  }

  /** The provider and function reviewers for the tools a script may call, which they read as untrusted data. */
  reviewersFor(tools: readonly ReviewerTool[]): Promise<readonly CodeCallPreReviewer[]> {
    const signature = sha256Hex(canonicalJson(tools));
    if (this.cached?.signature !== signature) {
      this.cached = { signature, reviewers: this.createReviewers(tools) };
    }
    return this.cached.reviewers;
  }

  private async createReviewers(tools: readonly ReviewerTool[]): Promise<readonly CodeCallPreReviewer[]> {
    const { provider, reviewer, policy = '' } = this.options;
    const { functionReviewer, providerReviewer } = await this.loadFactories(this.runtime);
    const reviewers: CodeCallPreReviewer[] = [];
    if (reviewer) reviewers.push(functionReviewer(reviewer, { policy, tools }));
    if (provider) reviewers.push(providerReviewer({ ...provider, policy, tools }));
    return reviewers;
  }
}
