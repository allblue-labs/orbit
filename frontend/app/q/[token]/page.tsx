import { QrResolution } from "@/components/equipment-qr/qr-resolution";
import { WorkspacePage } from "@/workspace";

/**
 * A etiqueta lida.
 *
 * O caminho é ditado pelo backend — o payload gravado no código é
 * `<origem>/q/<token>` — e a rota é **protegida**: `GET /assets/qr/:token`
 * exige `assets.read`, então quem chega sem sessão passa pelo login e volta
 * para cá. Abrir esta página ao público entregaria o contexto de um
 * equipamento a quem apenas fotografou um adesivo.
 *
 * O título é fixo e não menciona o token: histórico do navegador, abas e
 * telemetria não precisam carregá-lo.
 */
export default async function QrTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <WorkspacePage
      entity="asset"
      title="Etiqueta do equipamento"
      description="Contexto operacional resolvido a partir da etiqueta lida."
      activeLabel="Etiqueta"
      suspense={false}
    >
      <QrResolution token={token} />
    </WorkspacePage>
  );
}
