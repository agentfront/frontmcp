import 'reflect-metadata';

import {
  App,
  createContainer,
  Duty,
  FrontMcp,
  type DutyInterface,
  type DutyMetadata,
  type DutyRunContext,
} from '@frontmcp/sdk';

@Duty({ every: '10m', scope: 'machine' })
export class PruneCacheDuty implements DutyInterface {
  async run({ signal }: DutyRunContext): Promise<void> {
    if (signal.aborted) return;
  }
}

const nightly: DutyMetadata = { name: 'reindex', every: 86_400_000, scope: 'workspace', leaseMs: 30_000 };

@Duty(nightly)
export class ReindexDuty {
  run(): void {
    return undefined;
  }
}

@App({ name: 'maintenance', providers: [PruneCacheDuty, ReindexDuty] })
class MaintenanceApp {}

@FrontMcp({ info: { name: 'duties', version: '1.0.0' }, apps: [MaintenanceApp] })
export class DutiesServer {}

// @ts-expect-error a duty needs a run() method
@Duty({ every: '1m', scope: 'machine' })
export class DutyWithoutRun {}

export class InvalidDuties {
  // @ts-expect-error scope is 'machine' or 'workspace'
  static readonly scope: DutyMetadata = { every: '1m', scope: 'galaxy' };
  // @ts-expect-error every is milliseconds or a duration string
  static readonly every: DutyMetadata = { every: true, scope: 'machine' };
}

export async function runDutiesInAScript(): Promise<void> {
  const container = await createContainer({ apps: [MaintenanceApp], runDuties: true, info: { name: 'duties' } });
  await container.dispose();
}
