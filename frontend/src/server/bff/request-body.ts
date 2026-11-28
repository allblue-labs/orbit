import { ApiError } from "@/lib/api-error";

export const BFF_BODY_LIMITS = Object.freeze({
  active: 4,
  smallActive: 32,
  totalMs: 60_000,
  idleMs: 15_000,
});
const active = { small: 0, media: 0 };
export class BffBodyError extends ApiError {
  constructor(status: number) {
    super({
      kind: status === 408 ? "timeout" : status === 499 ? "aborted" : "http",
      status,
      code:
        status === 413
          ? "FILE_TOO_LARGE"
          : status === 429
            ? "RATE_LIMITED"
            : status === 408
              ? "TIMEOUT"
              : "FILE_INVALID",
      message:
        status === 413
          ? "O arquivo excede o tamanho permitido."
          : status === 429
            ? "Há muitos envios em andamento. Tente novamente em instantes."
            : "O envio foi interrompido ou demorou demais. Tente novamente.",
      ...(status === 429 ? { details: { retryAfterSeconds: 5 } } : {}),
    });
  }
}

/** Bounded replay buffer: token refresh can resend exactly these bytes, never reread the browser. */
export async function readBffBody(request: Request) {
  const type =
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
    "";
  const limit =
    type === "multipart/form-data"
      ? 21_037_056
      : type.startsWith("image/")
        ? 10_000_000
        : type === "application/json" ||
            type === "application/x-www-form-urlencoded"
          ? 1_048_576
          : 20_971_520;
  const group =
    type === "application/json" || type === "application/x-www-form-urlencoded"
      ? "small"
      : "media";
  const concurrency =
    group === "small" ? BFF_BODY_LIMITS.smallActive : BFF_BODY_LIMITS.active;
  const declared = request.headers.get("content-length");
  if (
    declared &&
    (!/^\d+$/.test(declared) ||
      !Number.isSafeInteger(Number(declared)) ||
      Number(declared) > limit)
  ) {
    throw new BffBodyError(413);
  }
  if (request.signal.aborted) throw new BffBodyError(499);
  if (active[group] >= concurrency) {
    throw new BffBodyError(429);
  }
  active[group]++;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      active[group]--;
    }
  };
  if (!request.body) return { body: null, release };
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = request.body.getReader();
  } catch {
    release();
    throw new BffBodyError(400);
  }
  let idle: ReturnType<typeof setTimeout> | undefined;
  let interrupt!: (error: BffBodyError) => void;
  const interrupted = new Promise<never>((_, reject) => {
    interrupt = reject;
  });
  const fail = (status: number) => {
    interrupt(new BffBodyError(status));
    // Cancelling a Node-backed NextRequest early also destroys its response
    // socket. Other failures stop reading and return Connection: close first.
    if (status === 499) void reader.cancel().catch(() => undefined);
  };
  const total = setTimeout(() => fail(408), BFF_BODY_LIMITS.totalMs);
  const onAbort = () => fail(499);
  request.signal.addEventListener("abort", onAbort, { once: true });
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => fail(408), BFF_BODY_LIMITS.idleMs);
  };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    resetIdle();
    for (;;) {
      const result = await Promise.race([reader.read(), interrupted]);
      if (result.done) break;
      size += result.value.byteLength;
      if (size > limit) {
        fail(413);
        throw new BffBodyError(413);
      }
      chunks.push(result.value);
      resetIdle();
    }
    if (declared && size !== Number(declared)) throw new BffBodyError(400);
    const body = new ArrayBuffer(size);
    const output = new Uint8Array(body);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return { body, release };
  } catch (error) {
    release();
    if (error instanceof BffBodyError) throw error;
    throw new BffBodyError(400);
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
    request.signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
