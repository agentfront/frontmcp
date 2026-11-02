import { JobAdmissionTimeoutError } from '../../errors';
import { JobAdmission } from '../job-admission';

describe('JobAdmission', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('admits at once when nothing is limited', async () => {
    const admission = new JobAdmission({});

    await expect(admission.slot().acquire('report')).resolves.toBeUndefined();
  });

  it('holds an attempt past the concurrency until a running one releases its slot', async () => {
    const admission = new JobAdmission({ concurrency: 1, maxWaitMs: 1_000 });
    const first = admission.slot();
    const second = admission.slot();
    await first.acquire('report');
    let admitted = false;
    const waiting = second.acquire('report').then(() => (admitted = true));

    await jest.advanceTimersByTimeAsync(500);
    expect(admitted).toBe(false);

    first.release();
    await waiting;
    expect(admitted).toBe(true);
  });

  it('admits waiting attempts in the order they arrived', async () => {
    const admission = new JobAdmission({ concurrency: 1, maxWaitMs: 10_000 });
    const running = admission.slot();
    await running.acquire('report');
    const order: string[] = [];
    const slots = ['a', 'b', 'c'].map((name) => {
      const slot = admission.slot();
      const admitted = slot.acquire(name).then(() => order.push(name));
      return { slot, admitted };
    });

    running.release();
    await slots[0].admitted;
    slots[0].slot.release();
    await slots[1].admitted;
    slots[1].slot.release();
    await slots[2].admitted;

    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('refuses an attempt that waited maxWaitMs, saying what it waited for', async () => {
    const admission = new JobAdmission({ concurrency: 1, maxWaitMs: 1_000 });
    await admission.slot().acquire('report');

    const refused = admission.slot().acquire('export');
    const assertion = expect(refused).rejects.toThrow(/"export".*1000 ms.*1 of 1/);
    await jest.advanceTimersByTimeAsync(1_000);

    await assertion;
    await expect(refused).rejects.toBeInstanceOf(JobAdmissionTimeoutError);
  });

  it('stops waiting when the attempt is aborted, and lets the next one in', async () => {
    const admission = new JobAdmission({ concurrency: 1, maxWaitMs: 10_000 });
    const running = admission.slot();
    await running.acquire('report');
    const abort = new AbortController();
    const abandoned = admission.slot().acquire('a', abort.signal);
    const next = admission.slot();
    let nextAdmitted = false;
    const waiting = next.acquire('b').then(() => (nextAdmitted = true));

    abort.abort(new Error('cancelled'));
    await expect(abandoned).rejects.toThrow('cancelled');
    running.release();
    await waiting;

    expect(nextAdmitted).toBe(true);
  });

  it('refuses an attempt whose signal is already aborted', async () => {
    const admission = new JobAdmission({ concurrency: 1 });
    const abort = new AbortController();
    abort.abort(new Error('gone'));

    await expect(admission.slot().acquire('report', abort.signal)).rejects.toThrow('gone');
  });

  it('claims memoryMb for each running attempt, and admits the next once enough memory is free', async () => {
    let freeMb = 100;
    const admission = new JobAdmission({ memoryMb: 60, maxWaitMs: 10_000 }, { freeMemoryMb: () => freeMb });
    const first = admission.slot();
    await first.acquire('build');
    let admitted = false;
    const second = admission.slot();
    const waiting = second.acquire('test').then(() => (admitted = true));

    await jest.advanceTimersByTimeAsync(1_000);
    expect(admitted).toBe(false);

    freeMb = 200;
    await jest.advanceTimersByTimeAsync(1_000);
    await waiting;
    expect(admitted).toBe(true);
  });

  it("reads the memory the process may still use, which counts a container's limit", async () => {
    const availableMemory = jest.spyOn(process, 'availableMemory').mockReturnValue(100 * 1024 * 1024);
    try {
      const refused = new JobAdmission({ memoryMb: 200, maxWaitMs: 100 }).slot().acquire('build');
      const assertion = expect(refused).rejects.toThrow(/200 MB free.*100 MB/);
      await jest.advanceTimersByTimeAsync(100);

      await assertion;
    } finally {
      availableMemory.mockRestore();
    }
  });

  it('refuses an attempt while too little memory is free, saying how much', async () => {
    const admission = new JobAdmission({ memoryMb: 512, maxWaitMs: 100 }, { freeMemoryMb: () => 128 });

    const refused = admission.slot().acquire('build');
    const assertion = expect(refused).rejects.toThrow(/512 MB free.*128 MB/);
    await jest.advanceTimersByTimeAsync(100);

    await assertion;
  });

  it('releases a slot once, and ignores a release before any acquire', async () => {
    const admission = new JobAdmission({ concurrency: 1, maxWaitMs: 100 });
    admission.slot().release();
    const first = admission.slot();
    await first.acquire('report');
    first.release();
    first.release();
    const second = admission.slot();
    await second.acquire('report');

    const refused = admission.slot().acquire('report');
    const assertion = expect(refused).rejects.toBeInstanceOf(JobAdmissionTimeoutError);
    await jest.advanceTimersByTimeAsync(100);
    await assertion;
  });
});
