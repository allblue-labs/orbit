import { beforeEach, expect, it, vi } from "vitest";

const { backendFetch } = vi.hoisted(() => ({ backendFetch: vi.fn() }));
vi.mock("@/server/backend-client", () => ({ backendFetch }));

import { GET } from "../../app/api/legal/[slug]/download/[[...version]]/route";
import { LEGAL_DOCUMENT_VERSION } from "@/types/contracts/modules/legal/legal.read-models";

const url = "https://orbit.test/api/legal/termos/download";
const fetchPdf = (version?: string[]) =>
  GET(new Request(url), {
    params: Promise.resolve({ slug: "termos", version }),
  });
const upstreamPdf = (version: string) =>
  new Response("%PDF-1.4", {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="orbit-termos-${version}.pdf"`,
    },
  });

beforeEach(() => backendFetch.mockReset());

it("rejects a 200 PDF from an older API that ignored the requested version", async () => {
  backendFetch.mockResolvedValueOnce(upstreamPdf("2026-11-27.2"));
  const response = await fetchPdf([LEGAL_DOCUMENT_VERSION]);
  expect(backendFetch).toHaveBeenCalledWith({
    path: "/legal/documents/termos/download",
    query: { version: LEGAL_DOCUMENT_VERSION },
  });
  expect(response.status).toBe(409);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});

it("streams the matching PDF with the versioned filename", async () => {
  backendFetch.mockResolvedValueOnce(upstreamPdf(LEGAL_DOCUMENT_VERSION));
  const response = await fetchPdf([LEGAL_DOCUMENT_VERSION]);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("application/pdf");
  expect(await response.text()).toBe("%PDF-1.4");
});

it("still serves legacy unversioned public downloads", async () => {
  backendFetch.mockResolvedValueOnce(upstreamPdf(LEGAL_DOCUMENT_VERSION));
  expect((await fetchPdf()).status).toBe(200);
});
