import { describe, it, expect, vi, afterEach } from "vitest";
import { createQueue, containerPath, transcribeClip, vocabPrompt } from "./jobs.js";
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
    // dual: caption sits at the webcam/gameplay seam. Default webcam crop
    // scales to a 640px top pane; minus 40 so text overlaps the seam.
    expect(settings.captionY).toBe(600);
    db.close();
  });

  it("writes default settings on a no_speech 422 so the clip can still render", async () => {
    const db = createDb(":memory:");
    db.upsertClip({ path: "/media/recordings/a.mp4", width: 3840, height: 1080 });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "no_speech" }), { status: 422 }),
      ),
    );

    await transcribeClip(db, 1);

    const clip = db.getClip(1)!;
    expect(clip.status).toBe("no_speech");
    const settings = JSON.parse(clip.settings_json!);
    expect(settings.gameplayCrop).toEqual({ x: 2526, y: 0, w: 608, h: 1080 });
    db.close();
  });

  it("gives 'other' resolutions a centered full-height 9:16 crop, no webcam", async () => {
    const db = createDb(":memory:");
    db.upsertClip({ path: "/media/recordings/a.mp4", width: 2560, height: 1440 });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ words: [] }), { status: 200 }),
      ),
    );

    await transcribeClip(db, 1);

    const settings = JSON.parse(db.getClip(1)!.settings_json!);
    // round(1440 * 9/16) = 810 (even), centered: (2560-810)/2 = 875
    expect(settings.gameplayCrop).toEqual({ x: 875, y: 0, w: 810, h: 1440 });
    expect(settings.webcamCrop).toBeNull();
    db.close();
  });

  it("sends the vocab preset as a plain initial_prompt string", async () => {
    const db = createDb(":memory:");
    db.upsertClip({ path: "/media/recordings/a.mp4", width: 1920, height: 1080 });
    // Stored via PUT /api/presets/vocab: body JSON-encoded → quoted string.
    db.setPreset("vocab", JSON.stringify("Terraria, Moonlord"));
    const fetchSpy = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(JSON.stringify({ words: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await transcribeClip(db, 1);

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.initial_prompt).toBe("Terraria, Moonlord");
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

describe("vocabPrompt", () => {
  it("unwraps a JSON-encoded string (as stored by the presets API)", () => {
    expect(vocabPrompt(JSON.stringify("Vex, Rylai"))).toBe("Vex, Rylai");
  });

  it("passes raw text through", () => {
    expect(vocabPrompt("plain text vocab")).toBe("plain text vocab");
  });

  it("returns undefined for empty/whitespace/null-ish values", () => {
    expect(vocabPrompt(undefined)).toBeUndefined();
    expect(vocabPrompt("")).toBeUndefined();
    expect(vocabPrompt(JSON.stringify("   "))).toBeUndefined();
    expect(vocabPrompt("null")).toBeUndefined();
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
