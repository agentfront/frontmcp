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

@Duty({ cron: '0 9 * * 1-5', timezone: 'Europe/Berlin', scope: 'cluster' })
export class WeekdayReportDuty implements DutyInterface {
  run(): void {
    return undefined;
  }
}

const hourly: DutyMetadata = { name: 'rollup', cron: '0 * * * *', scope: 'machine', leaseMs: 30_000 };

@Duty(hourly)
export class RollupDuty {
  run(): void {
    return undefined;
  }
}

@App({ name: 'maintenance', providers: [PruneCacheDuty, ReindexDuty, WeekdayReportDuty, RollupDuty] })
class MaintenanceApp {}

@FrontMcp({ info: { name: 'duties', version: '1.0.0' }, apps: [MaintenanceApp] })
export class DutiesServer {}

// @ts-expect-error a duty needs a run() method
@Duty({ every: '1m', scope: 'machine' })
export class DutyWithoutRun {}

export class InvalidDuties {
  // @ts-expect-error scope is 'machine', 'workspace' or 'cluster'
  static readonly scope: DutyMetadata = { every: '1m', scope: 'galaxy' };
  // @ts-expect-error every is milliseconds or a duration string
  static readonly every: DutyMetadata = { every: true, scope: 'machine' };
  // @ts-expect-error a duty has every or cron, not both
  static readonly both: DutyMetadata = { every: '1m', cron: '* * * * *', scope: 'machine' };
  // @ts-expect-error a duty needs every or cron
  static readonly neither: DutyMetadata = { scope: 'machine' };
  // @ts-expect-error timezone goes with cron
  static readonly zone: DutyMetadata = { every: '1m', timezone: 'Europe/Berlin', scope: 'machine' };
}

export async function runDutiesInAScript(): Promise<void> {
  const container = await createContainer({
    apps: [MaintenanceApp],
    runDuties: true,
    info: { name: 'duties' },
    redis: { url: 'redis://localhost:6379' },
  });
  await container.dispose();
}
