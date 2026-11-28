import { RunStops, type RunStopsJournal } from '../runs/run-stops';

/** A journal whose running calls the test starts and ends. */
function journalOf(): RunStopsJournal & { start(): void; end(): void; arrive(): void } {
  let running = 0;
  let arrivals = 0;
  let waiters: Array<() => void> = [];
  const change = () => {
    const ready = waiters;
    waiters = [];
    for (const waiter of ready) waiter();
  };
  return {
    running: () => running,
    arrivals: () => arrivals,
    changed: () => new Promise((resolve) => waiters.push(resolve)),
    start() {
      running++;
      arrivals++;
      change();
    },
    end() {
      running--;
      change();
    },
    arrive() {
      arrivals++;
    },
  };
}

const turns = async (count: number) => {
  for (let index = 0; index < count; index++) await new Promise((resolve) => setImmediate(resolve));
};

describe('RunStops', () => {
  it('holds an answer while another call runs, and gives it once that call settled', async () => {
    const journal = journalOf();
    const stops = new RunStops(journal);
    journal.start();
    let released: string | undefined;

    void stops.hold(2, true).then((how) => (released = how));
    await turns(10);
    expect(released).toBeUndefined();

    journal.end();
    await turns(10);
    expect(released).toBe('released');
  });

  it('waits again for a call that reached the host while it waited', async () => {
    const journal = journalOf();
    const stops = new RunStops(journal);
    let released: string | undefined;

    void stops.hold(0, false).then((how) => (released = how));
    await turns(1);
    journal.start();
    await turns(10);
    expect(released).toBeUndefined();
    journal.end();
    await turns(10);
    expect(released).toBe('released');
  });

  it('counts a call whose hooks are asked as running', async () => {
    const stops = new RunStops(journalOf());
    const asked = stops.asked();
    let released: string | undefined;

    void stops.hold(0, true).then((how) => (released = how));
    await turns(10);
    expect(released).toBeUndefined();
    asked();
    await turns(10);
    expect(released).toBe('released');
  });

  it('gives the lowest needs_approval first, and every other held answer moot a turn later', async () => {
    const stops = new RunStops(journalOf());
    const order: string[] = [];

    const answers = [
      stops.hold(4, true).then((how) => order.push(`4:${how}`)),
      stops.hold(1, false).then((how) => order.push(`1:${how}`)),
      stops.hold(2, true).then((how) => order.push(`2:${how}`)),
    ];
    await Promise.all(answers);

    expect(order).toEqual(['2:released', '1:moot', '4:moot']);
    expect(await stops.hold(5, false)).toBe('moot');
  });

  it('gives every held refusal to the script together when none of them stops the run', async () => {
    const stops = new RunStops(journalOf());

    const answers = await Promise.all([stops.hold(3, false), stops.hold(1, false)]);

    expect(answers).toEqual(['released', 'released']);
    expect(await stops.hold(6, false)).toBe('released');
  });

  it('gives a held answer at its deadline, while a call still runs', async () => {
    const journal = journalOf();
    const stops = new RunStops(journal);
    journal.start();

    const startedAt = Date.now();
    const how = await stops.hold(1, true, startedAt + 50);

    expect(how).toBe('released');
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(45);
  });

  it('makes every held answer moot when the run ends, and lets a call allowed meanwhile wait for the stop', async () => {
    const journal = journalOf();
    const stops = new RunStops(journal);
    journal.start();

    const held = stops.hold(1, true);
    stops.close();

    expect(await held).toBe('moot');
    expect(await stops.hold(2, true)).toBe('moot');
    await expect(stops.afterHalt()).resolves.toBeUndefined();
  });
});
