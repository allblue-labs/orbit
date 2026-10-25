import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/api/client";
import { operationsService } from "./operations.service";
import type { OperationFieldRecord } from "@/types/operations";

const signedQuery =
  "?bucket=orbit-artifacts&key=org%2Fevidence%2Ffoto.jpg&operation=preview&expires=2000000000&signature=abc123&filename=Foto%20do%20atendimento.jpg";

function record(url: string): OperationFieldRecord {
  return {
    evidence: [
      {
        id: "evidence-1",
        category: "BEFORE",
        source: "CAMERA",
        fileName: "foto.jpg",
        mimeType: "image/jpeg",
        sizeBytes: "120",
        capturedAt: null,
        capturedBy: null,
        url,
        expiresAt: "2033-05-18T03:33:20Z",
      },
    ],
    acknowledgement: {
      id: "ack-1",
      signerName: "Cliente",
      acknowledgedAt: "2026-10-24T12:00:00Z",
      capturedBy: null,
      signature: { url, expiresAt: "2033-05-18T03:33:20Z" },
      summary: {},
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("imagens do registro de campo na web", () => {
  it.each([
    "http://localhost:6001",
    "http://api:6001",
    "https://orbit.example",
    "",
  ])("fotos e assinaturas do storage LOCAL usam o BFF: %s", async (origin) => {
    const input = record(`${origin}/api/v1/storage/objects${signedQuery}`);
    const get = vi.spyOn(apiClient, "get").mockResolvedValue(input);
    const options = { signal: new AbortController().signal };
    const result = await operationsService.fieldRecord("op-1", options);

    expect(get).toHaveBeenCalledWith("/operations/op-1/field-record", options);
    expect(result.evidence[0].url).toBe(
      `/api/orbit/storage/objects${signedQuery}`,
    );
    expect(result.acknowledgement?.signature?.url).toBe(result.evidence[0].url);
    expect(result.evidence[0].expiresAt).toBe(input.evidence[0].expiresAt);
    // Transport adaptation must not modify the cached/raw server response.
    expect(input.evidence[0].url).toBe(
      `${origin}/api/v1/storage/objects${signedQuery}`,
    );
  });

  it("preserva a assinatura e o host de S3/MinIO", async () => {
    const url =
      "https://bucket.s3.example/evidence.jpg?X-Amz-Signature=abc&X-Amz-Expires=300";
    vi.spyOn(apiClient, "get").mockResolvedValue(record(url));
    const result = await operationsService.fieldRecord("op-1");
    expect(result.evidence[0].url).toBe(url);
    expect(result.acknowledgement?.signature?.url).toBe(url);
  });

  it("aceita registro vazio e aceite sem assinatura", async () => {
    const input = record("/api/orbit/storage/objects");
    input.acknowledgement!.signature = null;
    vi.spyOn(apiClient, "get").mockResolvedValue(input);
    expect(
      (await operationsService.fieldRecord("op-1")).acknowledgement?.signature,
    ).toBeNull();

    vi.mocked(apiClient.get).mockResolvedValue({
      evidence: [],
      acknowledgement: null,
    });
    expect(await operationsService.fieldRecord("op-1")).toEqual({
      evidence: [],
      acknowledgement: null,
    });
  });
});
