import { describe, it, expect, vi, afterEach } from "vitest";
import { uploadMedia, brandImageForm } from "./upload-media";
afterEach(() => vi.unstubAllGlobals());
describe("media transport", () => {
  it("sends a multipart file through the API gateway without a manual boundary", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const url =
      "https://orbit.allblue-labs.com/api/v1/storage/objects?bucket=x&key=y&operation=upload&expires=123&signature=abc";
    await uploadMedia(
      {
        url,
        requiredHeaders: {
          "content-type": "image/png",
          "x-orbit-upload-mode": "multipart",
        },
      },
      new Blob(["png"], { type: "image/png" }),
      "foto.png",
    );
    const [destination, init] = fetcher.mock.calls[0]!;
    expect(destination).toContain("/api/orbit/storage/objects?");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers.has("content-type")).toBe(false);
    expect(init.body.get("file").name).toBe("foto.png");
  });
  it("preserves external S3 upload URLs and omits session credentials", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const url =
      "https://account.r2.cloudflarestorage.com/bucket/object?X-Amz-Signature=abc";
    await uploadMedia(
      { url, requiredHeaders: { "content-type": "image/png" } },
      new Blob(["png"]),
    );
    expect(fetcher.mock.calls[0]![0]).toBe(url);
    expect(fetcher.mock.calls[0]![1].credentials).toBe("omit");
  });
  it("reports errors in Portuguese and sends logo files as multipart", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 413 })),
    );
    await expect(
      uploadMedia(
        { url: "https://example.com/file", requiredHeaders: {} },
        new Blob(["png"]),
      ),
    ).rejects.toThrow("Não foi possível enviar");
    expect(
      brandImageForm("data:image/png;base64,cG5n").get("file"),
    ).toBeInstanceOf(Blob);
    expect(() => brandImageForm("https://169.254.169.254/logo")).toThrow();
  });
});
