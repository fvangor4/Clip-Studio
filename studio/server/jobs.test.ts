import { describe, it, expect, vi, afterEach } from "vitest";
import { createQueue, containerPath, transcribeClip } from "./jobs.js";
import { createDb } from "./db.js";

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

describe("transcribeClip", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("re-fetches the clip so settings patched while queued are kept", async () => {
    const db = createDb(":memory:");
    db.upsertClip({ path: "/media/recordings/a.mp4", width: 3840, height: 1080 });
    // Simulate a PATCH landing after enqueue but before the worker runs.
    const patched = JSON.stringify({ styleId: "custom", captionY: 500 });
    db.updateClip(1, { settings_json: patched });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              words: [{ text: "hi", start: 0, end: 0.4, confidence: 0.95 }],
            }),
            { status: 200 },
          ),
      ),
    );

    await transcribeClip(db, 1);

    const clip = db.getClip(1)!;
    expect(clip.status).toBe("review");
    expect(JSON.parse(clip.transcript_json!)).toHaveLength(1);
    expect(clip.settings_json).toBe(patched); // not clobbered by defaults
    db.close();
  });

  it("applies default settings when none exist", async () => {
    const db = createDb(":memory:");
    db.upsertClip({ path: "/media/recordings/a.mp4", width: 3840, height: 1080 });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ words: [] }), { status: 200 }),
      ),
    );

    await transcribeClip(db, 1);

    const settings = JSON.parse(db.getClip(1)!.settings_json!);
    expect(settings.styleId).toBe("karaokeHighlight");
    expect(settings.webcamCrop).toEqual({ x: 420, y: 0, w: 1080, h: 640 });
    db.close();
  });

  it("is a no-op for a clip deleted while queued", async () => {
    const db = createDb(":memory:");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(transcribeClip(db, 42)).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    db.close();
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
