/**
 * Consulta de endereço por CEP.
 *
 * ## Por que passa pelo BFF
 *
 * O navegador fala com a nossa origem e mais nada: é o mesmo desenho do resto
 * do produto, e mantém a verificação de origem, o envelope de erro e o
 * identificador de requisição que toda resposta daqui carrega. Chamar o
 * serviço direto da tela colocaria um terceiro dentro da página.
 *
 * ## O que esta rota não decide
 *
 * Nada de domínio. Ela não grava endereço, não valida cadastro e não escolhe o
 * que o formulário faz com a resposta — devolve o que o serviço público dos
 * Correios (ViaCEP) respondeu, traduzido para o vocabulário que os formulários
 * já usam. O endereço só existe de fato quando alguém salva o cadastro.
 *
 * ## Ausência não é erro
 *
 * CEP que não existe devolve **404 com mensagem de produto**, não uma falha
 * técnica: quem digitou um número errado precisa saber disso, não que uma
 * integração respondeu de um jeito estranho.
 */
import { NextResponse } from "next/server";

import { bffError, bffJson } from "@/server/bff/responses";
import { createRouteHandler } from "@/server/bff/route-handler";
import {
  isCompletePostalCode,
  normalizePostalCode,
  toPostalAddress,
  type PostalLookupPayload,
} from "@/lib/postal-code";

export const runtime = "nodejs";

/** O serviço público dos Correios. Trocá-lo é mudar só esta constante. */
const PROVIDER = "https://viacep.com.br/ws";

/** Um CEP não muda de rua. Guardar por um dia poupa a consulta e o serviço. */
const CACHE_SECONDS = 60 * 60 * 24;

export const GET = createRouteHandler(async ({ request, requestId }) => {
  const raw = decodeURIComponent(
    new URL(request.url).pathname.split("/").pop() ?? "",
  );
  const cep = normalizePostalCode(raw);

  if (!isCompletePostalCode(cep)) {
    return bffError({
      status: 400,
      code: "INVALID_POSTAL_CODE",
      message: "Informe um CEP com oito dígitos.",
      requestId,
    });
  }

  let payload: PostalLookupPayload;
  try {
    const response = await fetch(`${PROVIDER}/${cep}/json/`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: CACHE_SECONDS },
    });
    if (!response.ok) throw new Error(`provedor respondeu ${response.status}`);
    payload = (await response.json()) as PostalLookupPayload;
  } catch {
    /**
     * O serviço é de terceiro e pode estar fora. Isso não impede ninguém de
     * cadastrar: a tela diz que a busca falhou e os campos seguem editáveis.
     */
    return bffError({
      status: 503,
      code: "POSTAL_LOOKUP_UNAVAILABLE",
      message: "A busca por CEP está indisponível. Preencha o endereço manualmente.",
      requestId,
    });
  }

  const address = toPostalAddress(payload);
  if (!address) {
    return bffError({
      status: 404,
      code: "POSTAL_CODE_NOT_FOUND",
      message: "CEP não encontrado. Confira o número ou preencha o endereço manualmente.",
      requestId,
    });
  }

  const result: NextResponse = bffJson(address, requestId);
  return result;
});
