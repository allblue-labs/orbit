/**
 * Copy exibida para falhas de transporte e para o contrato público da API.
 *
 * Mensagens HTTP são seguras por definição do PR-35. A interface não traduz,
 * não inspeciona texto e usa `error.code` apenas quando precisa mudar fluxo.
 */
import { ApiError } from "@/lib/api-error";

export function errorCopy(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Não foi possível concluir a operação.";
  }

  if (error.kind === "timeout") {
    return "A operação demorou mais que o esperado. Tente novamente.";
  }
  if (error.kind === "network") {
    return "Não foi possível conectar. Verifique sua conexão e tente novamente.";
  }
  if (error.kind === "parse") {
    return "A resposta recebida não pôde ser lida. Tente novamente.";
  }
  if (error.kind === "aborted") return "Requisição cancelada.";

  return error.message || "Não foi possível concluir a operação.";
}
