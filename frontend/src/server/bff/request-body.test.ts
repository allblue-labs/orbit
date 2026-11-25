import { afterEach, describe, expect, it, vi } from "vitest";
import { readBffBody, BFF_BODY_LIMITS } from "./request-body";

const releases: (() => void)[] = [];
afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.useRealTimers();
});
function incoming(
  chunks: Uint8Array[],
  headers: Record<string, string> = {},
  signal?: AbortSignal,
) {
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
    cancel,
  });
  const request = new Request("https://orbit.test/api/orbit/storage/objects", {
    method: "PUT",
    body: stream,
    headers,
    signal,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, cancel };
}
describe("bounded BFF replay buffers", () => {
  it("retains exactly the original bytes for token refresh and holds its admission until forwarding finishes", async () => {
    const { request } = incoming([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
    ]);
    const result = await readBffBody(request);
    releases.push(result.release);
    expect(new Uint8Array(result.body!)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(new Uint8Array(result.body!.slice(0))).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    result.release();
    result.release();
  });
  it("rejects declared excess before pulling and cancels chunked excess during reading", async () => {
    const earlyCancel = vi.fn();
    const request = new Request("https://orbit.test", {
      method: "PUT",
      body: new ReadableStream({ cancel: earlyCancel }),
      headers: { "content-type": "image/png", "content-length": "10000001" },
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readBffBody(request)).rejects.toMatchObject({
      status: 413,
      code: "FILE_TOO_LARGE",
    });
    expect(earlyCancel).not.toHaveBeenCalled();
    await request.body!.cancel();
    expect(earlyCancel).toHaveBeenCalledOnce();
    const { request: chunked } = incoming(
      [new Uint8Array(600_000), new Uint8Array(600_000)],
      { "content-type": "application/json" },
    );
    await expect(readBffBody(chunked)).rejects.toMatchObject({ status: 413 });
  });
  it("rejects inconsistent lengths and truncated bodies without forwarding partial bytes", async () => {
    await expect(
      readBffBody(
        incoming([new Uint8Array([1])], { "content-length": "2" }).request,
      ),
    ).rejects.toMatchObject({ status: 400 });
    const broken = new Request("https://orbit.test", {
      method: "PUT",
      body: new ReadableStream({
        start(controller) {
          controller.error(new Error("private-file-name must not escape"));
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(readBffBody(broken)).rejects.toMatchObject({
      status: 400,
      message: expect.not.stringContaining("private-file-name"),
    });
  });
  it("rejects a fifth retained buffer and restores capacity after release", async () => {
    for (let n = 0; n < 4; n++) {
      const result = await readBffBody(incoming([new Uint8Array([n])]).request);
      releases.push(result.release);
    }
    await expect(
      readBffBody(incoming([new Uint8Array([5])]).request),
    ).rejects.toMatchObject({ status: 429 });
    releases[0]!();
    const next = await readBffBody(incoming([new Uint8Array([6])]).request);
    releases.push(next.release);
    expect(next.body?.byteLength).toBe(1);
  });
  it("cancels a stalled reader at the idle deadline and releases its admission", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const request = new Request("https://orbit.test", {
      method: "PUT",
      body: new ReadableStream({ cancel }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const check = expect(readBffBody(request)).rejects.toMatchObject({
      status: 408,
    });
    await vi.advanceTimersByTimeAsync(BFF_BODY_LIMITS.idleMs);
    await check;
    expect(cancel).not.toHaveBeenCalled();
    await request.body!.cancel();
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("cancels on the browser abort signal and does not expose its reason", async () => {
    const abort = new AbortController();
    const cancel = vi.fn();
    const request = new Request("https://orbit.test", {
      method: "PUT",
      body: new ReadableStream({ cancel }),
      signal: abort.signal,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const check = expect(readBffBody(request)).rejects.toMatchObject({
      status: 499,
      message: expect.not.stringContaining("private-token"),
    });
    abort.abort("private-token");
    await check;
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("enforces a total deadline even when small chunks keep arriving", async () => {
    vi.useFakeTimers();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const request = new Request("https://orbit.test", {
      method: "PUT",
      body: new ReadableStream<Uint8Array>({
        start(c) {
          streamController = c;
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const check = expect(readBffBody(request)).rejects.toMatchObject({
      status: 408,
    });
    for (let n = 0; n < 5; n++) {
      await vi.advanceTimersByTimeAsync(10_000);
      streamController.enqueue(new Uint8Array([1]));
      await Promise.resolve();
    }
    await vi.advanceTimersByTimeAsync(10_000);
    await check;
  });
});
