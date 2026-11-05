import {
  ElicitationDisabledError,
  ElicitationFallbackRequired,
  ElicitationNotSupportedError,
  ElicitationTimeoutError,
  InputRequiredSignal,
  MissingClientCapabilityError,
} from '@frontmcp/sdk';

import { scopeHidingSkills } from '../../__tests__/skill-filter-scope.fixture';
import { HiddenOpRegistry, type HiddenOpEntry, type OperationListings } from '../../registry/hidden-op.registry';
import { AuthorityGuard } from '../../security/authority-guard';
import { SkilledOpenApiConfig } from '../../skilled-openapi.symbols';
import { skilledOpenApiPluginOptionsSchema, type ConfirmOptions } from '../../skilled-openapi.types';
import {
  askingBeforeEachCall,
  confirmWorkflow,
  needsConfirmation,
  type AskUser,
  type ConfirmationSubject,
} from '../action-confirmation';

function entry(operationId: string, op: Partial<HiddenOpEntry['op']> = {}, listing: Partial<HiddenOpEntry> = {}) {
  return {
    skillId: 'invoices',
    bundleId: 'acme',
    bundleVersion: '1',
    service: { id: 'billing', baseUrl: 'https://billing.example.com' },
    authBinding: { kind: 'none' },
    op: {
      operationId,
      serviceId: 'billing',
      httpMethod: 'GET',
      pathTemplate: `/${operationId}`,
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      mapper: [],
      authBindingRef: 'none',
      ...op,
    },
    ...listing,
  } as HiddenOpEntry;
}

const voidInvoice = entry('voidInvoice', {
  httpMethod: 'DELETE',
  pathTemplate: '/invoices/{id}',
  summary: 'Void an invoice',
});
const getInvoice = entry('getInvoice', { pathTemplate: '/invoices/{id}', summary: 'Fetch an invoice' });

const confirmOf = (confirm: Partial<ConfirmOptions>): ConfirmOptions => ({ whenUnsupported: 'refuse', ...confirm });

const accepted: AskUser = async () => ({ status: 'accept', content: { confirmed: true } });
const asking = (
  askUser: AskUser,
  call: Required<ConfirmationSubject>,
  whenUnsupported: 'refuse' | 'allow' = 'refuse',
) => askingBeforeEachCall(askUser, whenUnsupported)(call);

describe('needsConfirmation', () => {
  const listingsOf = (...entries: HiddenOpEntry[]) => entries as unknown as OperationListings;

  it('names no action when there is no confirm option', () => {
    expect(needsConfirmation(undefined, listingsOf(voidInvoice))).toBe(false);
  });

  it.each([
    ['its HTTP method', { methods: ['DELETE' as const] }, voidInvoice],
    ['its id', { operations: ['getInvoice'] }, getInvoice],
    ['a tag of its operation', { tags: ['destructive'] }, entry('purge', { tags: ['billing', 'destructive'] })],
    ['a tag of its skill', { tags: ['destructive'] }, entry('purge', {}, { skillTags: ['destructive'] })],
  ])('names an action by %s', (_rule, confirm, action) => {
    expect(needsConfirmation(confirmOf(confirm), listingsOf(action))).toBe(true);
  });

  it('names an action by a tag of any skill that lists it', () => {
    const listings = listingsOf(entry('purge'), entry('purge', {}, { skillId: 'admin', skillTags: ['destructive'] }));

    expect(needsConfirmation(confirmOf({ tags: ['destructive'] }), listings)).toBe(true);
  });

  it('leaves out an action no rule names', () => {
    const confirm = confirmOf({ methods: ['DELETE'], tags: ['destructive'], operations: ['voidInvoice'] });

    expect(needsConfirmation(confirm, listingsOf(entry('listInvoices', { tags: ['billing'] })))).toBe(false);
  });
});

describe('askingBeforeEachCall', () => {
  it('asks about the action, its summary, method, path and input, and lets it run when the user confirms', async () => {
    const askUser = jest.fn(accepted);

    await expect(asking(askUser, { entry: voidInvoice, input: { id: 'inv_1' } })).resolves.toBeUndefined();
    expect(askUser).toHaveBeenCalledWith(
      'Run voidInvoice: Void an invoice (DELETE /invoices/{id}) with {"id":"inv_1"}?',
    );
  });

  it('cuts a long input in the question', async () => {
    const askUser = jest.fn(accepted);

    await asking(askUser, { entry: voidInvoice, input: { note: 'x'.repeat(2000) } });

    const [question] = askUser.mock.calls[0];
    expect(question.length).toBeLessThan(1200);
    expect(question).toMatch(/x…\?$/);
  });

  it.each([
    ['declines', { status: 'decline' as const }],
    ['cancels', { status: 'cancel' as const }],
    ['accepts without confirming', { status: 'accept' as const, content: { confirmed: false } }],
  ])('refuses the call when the user %s', async (_answer, answer) => {
    const refusal = await asking(async () => answer, { entry: voidInvoice, input: { id: 'inv_1' } });

    expect(refusal).toBe('the user declined: voidInvoice');
  });

  it('refuses the call when the user does not answer in time', async () => {
    const refusal = await asking(
      async () => {
        throw new ElicitationTimeoutError('elicit-1', 300_000);
      },
      { entry: voidInvoice, input: {} },
    );

    expect(refusal).toBe('the user did not answer in time: voidInvoice');
  });

  it.each([
    ['takes the elicitation fallback', new ElicitationFallbackRequired('elicit-1', 'Run?', {}, 'tool', {}, 1000)],
    ['has no elicitation support', new ElicitationNotSupportedError()],
    ['declares no elicitation capability', new MissingClientCapabilityError({ elicitation: {} }, 'no elicitation')],
  ])('refuses, or with allow runs, a call from a client that %s', async (_client, error) => {
    const askUser: AskUser = async () => {
      throw error;
    };
    const call = { entry: voidInvoice, input: { id: 'inv_1' } };

    await expect(asking(askUser, call)).resolves.toBe(
      "the user's confirmation is needed for voidInvoice, and this client can't ask for it: it doesn't support elicitation; nothing was sent",
    );
    await expect(asking(askUser, call, 'allow')).resolves.toBeUndefined();
  });

  it('refuses a call on a server with elicitation disabled', async () => {
    const refusal = await asking(
      async () => {
        throw new ElicitationDisabledError();
      },
      { entry: voidInvoice, input: {} },
    );

    expect(refusal).toContain("this server can't ask for it: elicitation is disabled");
  });

  it('rethrows what is not an answer, such as a request for input the client sends on its retry', async () => {
    const signal = new InputRequiredSignal({}, 'state');

    await expect(
      asking(
        async () => {
          throw signal;
        },
        { entry: voidInvoice, input: {} },
      ),
    ).rejects.toBe(signal);
  });
});

describe('confirmWorkflow', () => {
  const ADMIN_ONLY = { roles: { any: ['admin'] } };

  function registry(): HiddenOpRegistry {
    const hiddenOps = new HiddenOpRegistry();
    hiddenOps.set(voidInvoice);
    hiddenOps.set(getInvoice);
    hiddenOps.set(
      entry('deleteCustomer', { httpMethod: 'DELETE', summary: 'Delete a customer' }, { skillId: 'customers' }),
    );
    hiddenOps.set(entry('purgeLedger', { httpMethod: 'DELETE' }, { skillRequiredAuthorities: ADMIN_ONLY }));
    return hiddenOps;
  }

  function confirming(
    script: string,
    askUser: AskUser,
    confirm?: Partial<ConfirmOptions>,
    visibleListings = scopeHidingSkills().visibleListings,
  ) {
    const options = skilledOpenApiPluginOptionsSchema.parse({
      source: { type: 'inline', content: {} },
      ...(confirm ? { confirm } : {}),
    });
    return confirmWorkflow({
      script,
      config: new SkilledOpenApiConfig(options),
      guard: new AuthorityGuard(),
      visibleListings,
      hiddenOps: registry(),
      authInfo: {},
      askUser,
    });
  }

  const CLEANUP = [
    "const invoice = await callTool('getInvoice', { id: 'inv_1' });",
    "for (const id of ['inv_1', 'inv_2', 'inv_3']) await callTool('voidInvoice', { id });",
    'await callTool("deleteCustomer", { id: invoice.customerId });',
    "await callTool('purgeLedger', {});",
    'return true;',
  ].join('\n');

  it('asks once, before the script runs, about the actions it names that need confirmation and the caller may run', async () => {
    const askUser = jest.fn(accepted);

    const confirmation = await confirming(CLEANUP, askUser, { methods: ['DELETE'] });

    expect(askUser).toHaveBeenCalledTimes(1);
    expect(askUser).toHaveBeenCalledWith(
      [
        'This workflow can run these actions, as many times as its script calls them:',
        '- voidInvoice: Void an invoice (DELETE /invoices/{id})',
        '- deleteCustomer: Delete a customer (DELETE /deleteCustomer)',
        'Run it?',
      ].join('\n'),
    );
    expect(confirmation).toEqual({ confirmAction: expect.any(Function) });
  });

  it('lets the calls of the confirmed actions run, and refuses another action that needs confirmation', async () => {
    const confirmation = await confirming(CLEANUP, accepted, { methods: ['DELETE'] });
    if (!('confirmAction' in confirmation)) throw new Error('the workflow was refused');

    await expect(confirmation.confirmAction({ entry: voidInvoice, input: { id: 'inv_2' } })).resolves.toBeUndefined();
    await expect(
      confirmation.confirmAction({ entry: entry('dropTable', { httpMethod: 'DELETE' }), input: {} }),
    ).resolves.toContain(
      `write the actionId as a string, as in callTool('dropTable', …), or run it with execute_action`,
    );
  });

  it('does not ask about an action whose every listing skill the skills:filter flow hides from the caller', async () => {
    const askUser = jest.fn(accepted);

    await confirming(CLEANUP, askUser, { methods: ['DELETE'] }, scopeHidingSkills('customers').visibleListings);

    expect(askUser).toHaveBeenCalledWith(
      [
        'This workflow can run these actions, as many times as its script calls them:',
        '- voidInvoice: Void an invoice (DELETE /invoices/{id})',
        'Run it?',
      ].join('\n'),
    );
  });

  it('refuses the workflow, naming the actions, when the user declines', async () => {
    const confirmation = await confirming(CLEANUP, async () => ({ status: 'decline' }), { methods: ['DELETE'] });

    expect(confirmation).toEqual({ refusal: 'the user declined: voidInvoice, deleteCustomer' });
  });

  it.each([
    ['there is no confirm option', undefined],
    ['the script names no action that needs confirmation', { operations: ['refundInvoice'] }],
  ])('does not ask when %s', async (_case, confirm) => {
    const askUser = jest.fn(accepted);

    await confirming(CLEANUP, askUser, confirm);

    expect(askUser).not.toHaveBeenCalled();
  });
});
