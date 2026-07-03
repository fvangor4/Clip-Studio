import { describe, it, expect } from "vitest";
import { createQueue, containerPath } from "./jobs.js";

function deferred() {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createQueue", () => {
  it("runs jobs strictly serially in enqueue order", async () => {
    const events: string[] = [];
    const gates = [deferred(), deferred(), deferred()];
    const queue = createQueue<number>(async (job) => {
      events.push(`start:${job}`);
      await gates[job].promise;
      events.push(`end:${job}`);
    });

    queue.enqueue(0);
    queue.enqueue(1);
    queue.enqueue(2);
    expect(queue.size()).toBe(3);

    // Let the first job start; jobs 1 and 2 must not start yet.
    await Promise.resolve();
    expect(events).toEqual(["start:0"]);

    gates[0].resolve();
    gates[1].resolve();
    gates[2].resolve();
    await queue.onIdle();

    expect(events).toEqual([
      "start:0",
      "end:0",
      "start:1",
      "end:1",
      "start:2",
      "end:2",
    ]);
    expect(queue.size()).toBe(0);
  });

  it("continues running subsequent jobs after a worker rejection", async () => {
    const ran: number[] = [];
    const queue = createQueue<number>(async (job) => {
      ran.push(job);
      if (job === 1) throw new Error("boom");
    });

    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);
    await queue.onIdle();

    expect(ran).toEqual([1, 2, 3]);
  });

  it("onIdle resolves immediately when queue is empty", async () => {
    const queue = createQueue<number>(async () => {});
    await queue.onIdle();
    expect(queue.size()).toBe(0);
  });

  it("processes jobs enqueued while running", async () => {
    const ran: number[] = [];
    const queue = createQueue<number>(async (job) => {
      ran.push(job);
      if (job === 1) queue.enqueue(2);
    });
    queue.enqueue(1);
    await queue.onIdle();
    expect(ran).toEqual([1, 2]);
  });
});

describe("containerPath", () => {
  it("maps a Windows dev path to the whisper container view", () => {
    expect(
      containerPath("E:\\recordings\\2026-06\\clip 1.mp4", "E:\\recordings"),
    ).toBe("/media/recordings/2026-06/clip 1.mp4");
  });

  it("maps a posix path under the recordings root", () => {
    expect(
      containerPath("/media/recordings/foo/bar.mkv", "/media/recordings"),
    ).toBe("/media/recordings/foo/bar.mkv");
  });
});
