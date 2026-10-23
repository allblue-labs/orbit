import { backendFetch } from "@/server/backend-client";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (slug !== "termos" && slug !== "privacidade")
    return new Response("Documento não encontrado", { status: 404 });
  try {
    const response = await backendFetch({
      path: `/legal/documents/${slug}/download`,
    });
    if (!response.ok)
      return new Response(
        "Não foi possível baixar o documento. Tente novamente.",
        { status: 503 },
      );
    return new Response(response.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition":
          response.headers.get("content-disposition") ??
          `attachment; filename="orbit-${slug}.pdf"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(
      "Não foi possível baixar o documento. Tente novamente.",
      { status: 503 },
    );
  }
}
