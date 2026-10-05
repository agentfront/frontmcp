import type { AuditModuleShape } from '@frontmcp/sdk';

import * as auditModule from '..';
import { Hs256AuditSigner } from '../audit-signer';
import type { SkillAuditStore } from '../audit-store';
import { createSkillAuditMetrics, SkillAuditWriter, type SkillAuditTelemetry } from '../audit-writer';

interface RecordedIncrement {
  counter: string;
  attributes?: Record<string, string>;
}

function makeTelemetry(): SkillAuditTelemetry & { counters: string[]; increments: RecordedIncrement[] } {
  const counters: string[] = [];
  const increments: RecordedIncrement[] = [];
  return {
    counters,
    increments,
    createCounter: (name) => {
      counters.push(name);
      return {
        inc: (_by, attributes) => {
          increments.push({ counter: name, attributes });
        },
      };
    },
  };
}

const failingStore: SkillAuditStore = {
  nextSequence: async () => 1,
  appendAtSequence: async () => {
    throw new Error('redis down');
  },
  tail: async () => undefined,
  read: async () => [],
};

const silentLogger = { warn: () => undefined };

const ctx = {
  subject: 'user-1',
  skillId: 'billing',
  actionId: 'createInvoice',
  bundleId: 'acme:prod',
  bundleVersion: '1.0.0',
  input: { amount: 100 },
};

describe('createSkillAuditMetrics', () => {
  it('creates the write-failure and dropped counters', () => {
    const telemetry = makeTelemetry();

    createSkillAuditMetrics(telemetry);

    expect(telemetry.counters).toEqual([
      'frontmcp_skills_audit_write_failures_total',
      'frontmcp_skills_audit_dropped_total',
    ]);
  });

  it('counts each failure and drop under its reason', () => {
    const telemetry = makeTelemetry();
    const metrics = createSkillAuditMetrics(telemetry);

    metrics.incrementWriteFailure('sign');
    metrics.incrementDropped?.('queue-overflow');

    expect(telemetry.increments).toEqual([
      { counter: 'frontmcp_skills_audit_write_failures_total', attributes: { reason: 'sign' } },
      { counter: 'frontmcp_skills_audit_dropped_total', attributes: { reason: 'queue-overflow' } },
    ]);
  });

  it('counts an append failure reported by the writer', async () => {
    const telemetry = makeTelemetry();
    const writer = new SkillAuditWriter(
      failingStore,
      new Hs256AuditSigner('metrics-secret', 'metrics-key'),
      silentLogger,
      createSkillAuditMetrics(telemetry),
    );

    await writer.writeAuthorityPass(ctx);

    expect(telemetry.increments).toEqual([
      { counter: 'frontmcp_skills_audit_write_failures_total', attributes: { reason: 'append' } },
    ]);
  });
});

describe('the audit module as the SDK reads it', () => {
  it('is an AuditModuleShape without a cast', () => {
    const auditModuleShape: AuditModuleShape = auditModule;

    expect(auditModuleShape.SkillAuditWriterToken).toBe(auditModule.SkillAuditWriterToken);
  });
});
