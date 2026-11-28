import { isLegalVersionPath } from "@/lib/legal-document-paths";
import { backendFetch } from "@/server/backend-client";

export const dynamic = "force-dynamic";

function downloadError(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; version?: string[] }> },
) {
  const { slug, version: segments } = await params;
  if (
    (slug !== "termos" && slug !== "privacidade") ||
    !isLegalVersionPath(segments)
  ) {
    return downloadError(404, "Documento não encontrado");
  }

  const version = segments?.[0];
  try {
    const response = await backendFetch({
      path: `/legal/documents/${slug}/download`,
      query: { version },
    });
    const disposition = response.headers.get("content-disposition");
    // Older APIs may ignore the version parameter and return their current PDF.
    const versionMismatch =
      response.status === 409 ||
      (version &&
        response.ok &&
        disposition !== `attachment; filename="orbit-${slug}-${version}.pdf"`);
    if (versionMismatch) {
      await response.body?.cancel();
      return downloadError(
        409,
        "Esta versão do documento está indisponível. Se estiver no cadastro, atualize a página.",
      );
    }
    if (!response.ok)
      return downloadError(
        503,
        "Não foi possível baixar o documento. Tente novamente.",
      );

    return new Response(response.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition":
          disposition ?? `attachment; filename="orbit-${slug}.pdf"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return downloadError(
      503,
      "Não foi possível baixar o documento. Tente novamente.",
    );
  }
}
