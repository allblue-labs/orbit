/**
 * Como um documento é exibido dentro da página.
 *
 * ## Por que o PDF não leva `sandbox`
 *
 * O Chrome não abre o visualizador de PDF dentro de um iframe com `sandbox`:
 * mostra uma página de bloqueio, e era essa a "página quebrada" do
 * visualizador. O PDF não é HTML — quem o desenha é o leitor do navegador, num
 * processo próprio, e nada dele roda na origem da aplicação.
 *
 * O resto mantém `sandbox=""`, sem `allow-scripts`: HTML de tenant, mesmo
 * escapado na geração, é exibido sem poder executar.
 */
export function previewSandbox(format: string | null | undefined) {
  const formato = (format ?? "").toLowerCase();
  return formato === "pdf" || formato === "application/pdf" ? undefined : "";
}
