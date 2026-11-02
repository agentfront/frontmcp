import { App } from '@frontmcp/sdk';

import { CrunchInWorkerJob, SlowCountJob, WaitForCancelJob } from './jobs/detached.jobs';

/** Jobs that run detached, in processes of their own, and one that runs in a worker thread (proposal 2.2 b). */
@App({
  name: 'Detached',
  description: 'Detached job runs that outlive the server, and a job on the worker runner',
  jobs: [SlowCountJob, WaitForCancelJob, CrunchInWorkerJob],
})
export class DetachedApp {}
