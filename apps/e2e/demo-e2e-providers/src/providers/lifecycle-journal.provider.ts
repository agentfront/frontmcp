import { Provider, type OnBootstrap, type OnReady, type OnShutdown } from '@frontmcp/sdk';
import { writeFile } from '@frontmcp/utils';

/** Records the lifecycle phases it and its dependents go through, to the file `LIFECYCLE_LOG` names. */
@Provider({ name: 'LifecycleJournal' })
export class LifecycleJournal implements OnBootstrap, OnReady, OnShutdown {
  private readonly phases: string[] = [];
  private readonly logPath = process.env['LIFECYCLE_LOG'];

  async record(phase: string): Promise<void> {
    this.phases.push(phase);
    if (this.logPath) await writeFile(this.logPath, JSON.stringify(this.phases));
  }

  onBootstrap(): Promise<void> {
    return this.record('bootstrap:journal');
  }

  onReady(): Promise<void> {
    return this.record('ready:journal');
  }

  onShutdown(): Promise<void> {
    return this.record('shutdown:journal');
  }
}
