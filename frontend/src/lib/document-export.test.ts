import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api-error";
import type { DocumentExportReadModel } from "@/types/contracts/modules/document-exports/document-export.read-models";
import {
  EXPORT_TIMEOUT_MS,
  exportPollDelay,
  runDocumentExport,
} from "./document-export";

const status = (
  value: DocumentExportReadModel["status"],
  download: DocumentExportReadModel["download"] = null,
): DocumentExportReadModel => ({
  exportId: "e1",
  kind: "QUOTE",
  status: value,
  fileName: "ORC-1.pdf",
  contentType: "application/pdf",
  errorCode: value === "FAILED" ? "EXPORT_TIMEOUT" : null,
  createdAt: "2026-11-23T10:00:00.000Z",
  completedAt: null,
  expiresAt: "2026-11-24T10:00:00.000Z",
  download,
});

const accepted = { exportId: "e1", jobId: "j1", status: "PENDING" as const };

function clock() {
  let time = 0;
  const slept: number[] = [];
  return {
    slept,
    now: () => time,
    sleep: async (ms: number) => {
      slept.push(ms);
      time += ms;
    },
  };
}

describe("exportação assíncrona no cliente", () => {
  it("começa em 1,5 s e cresce até 5 s", () => {
    expect([0, 1, 2, 3, 4, 10].map(exportPollDelay)).toEqual([
      1500, 2250, 3375, 5000, 5000, 5000,
    ]);
  });

  it("consulta até ficar pronto e devolve a URL", async () => {
    const respostas = [
      status("PENDING"),
      status("PROCESSING"),
      status("COMPLETED", { url: "https://r2/x", expiresAt: "z" }),
    ];
    const tempo = clock();
    const pronto = await runDocumentExport({
      request: async () => accepted,
      poll: async () => respostas.shift()!,
      ...tempo,
    });
    expect(pronto.download?.url).toBe("https://r2/x");
    expect(tempo.slept).toEqual([1500, 2250, 3375]);
  });

  it("FAILED vira mensagem amigável", async () => {
    await expect(
      runDocumentExport({
        request: async () => accepted,
        poll: async () => status("FAILED"),
        ...clock(),
      }),
    ).rejects.toMatchObject({
      code: "DOCUMENT_EXPORT_FAILED",
      message: expect.stringContaining("Não foi possível gerar o documento"),
    });
  });

  it("429 no pedido vira aviso de muitos documentos em geração", async () => {
    const limite = new ApiError({ kind: "http", status: 429, message: "x" });
    await expect(
      runDocumentExport({
        request: async () => {
          throw limite;
        },
        poll: async () => status("PENDING"),
        ...clock(),
      }),
    ).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining("muitos documentos"),
    });
  });

  it("desiste no tempo máximo", async () => {
    const tempo = clock();
    await expect(
      runDocumentExport({
        request: async () => accepted,
        poll: async () => status("PROCESSING"),
        ...tempo,
      }),
    ).rejects.toMatchObject({ code: "DOCUMENT_EXPORT_TIMEOUT" });
    expect(tempo.now()).toBeGreaterThanOrEqual(EXPORT_TIMEOUT_MS);
  });
});
