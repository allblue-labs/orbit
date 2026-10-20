import { HttpStatus } from '@nestjs/common';
import {
  PUBLIC_ERROR_CODES,
  type PublicErrorCode,
} from './public-error.read-models';

export interface PublicErrorDefinition {
  readonly code: PublicErrorCode;
  readonly status: number;
  readonly message: string;
}

const entries = [
  ['VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'Revise os campos informados.'],
  [
    'UNAUTHORIZED',
    HttpStatus.UNAUTHORIZED,
    'Sua sessão não é válida ou expirou.',
  ],
  /*
   * Credencial errada não é sessão expirada.
   *
   * As duas saíam como `UNAUTHORIZED`, com a mensagem "Sua sessão não é válida ou
   * expirou" — dita a quem está na tela de login, onde ninguém tem sessão. Quem
   * errou a senha lia que o problema era a sessão e ficava limpando cookie; quem
   * tinha sessão velha lia a mesma frase e trocava a senha. Nenhuma das duas
   * pessoas sabia o que fazer.
   *
   * Não vaza nada: a frase não diz se o e-mail existe.
   */
  [
    'INVALID_CREDENTIALS',
    HttpStatus.UNAUTHORIZED,
    'E-mail ou senha incorretos.',
  ],
  /*
   * A trava por tentativas tem mensagem própria, e isto é uma escolha.
   *
   * Dizer "aguarde" confirma que a conta existe — informação que a frase
   * anterior não dá. A alternativa é pior: com "e-mail ou senha incorretos", uma
   * pessoa travada continua digitando a senha certa e recebendo erro, sem
   * nenhuma pista de que só precisa esperar. Quem controla a força bruta aqui é o
   * limite de tentativas, não a ambiguidade da mensagem.
   */
  [
    'ACCOUNT_LOCKED',
    HttpStatus.UNAUTHORIZED,
    'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.',
  ],
  [
    'MFA_REQUIRED',
    HttpStatus.UNAUTHORIZED,
    'Informe o código do seu autenticador.',
  ],
  /*
   * Código errado é diferente de credencial errada.
   *
   * Sem este código, o TOTP inválido saía como `UNAUTHORIZED` — "sua sessão não
   * é válida ou expirou", numa tela onde ninguém tem sessão ainda. A pessoa lia
   * que o problema era a senha e trocava a senha.
   *
   * Não vaza nada: quem chega aqui já provou a senha.
   */
  [
    'MFA_INVALID',
    HttpStatus.UNAUTHORIZED,
    'O código do autenticador não confere. Tente o próximo código.',
  ],
  [
    'FORBIDDEN',
    HttpStatus.FORBIDDEN,
    'Você não tem permissão para realizar esta ação.',
  ],
  /**
   * A credencial está certa; o lugar é que não.
   *
   * Precisa de código próprio porque a tela reage diferente: um `FORBIDDEN`
   * genérico na entrada faz a pessoa tentar a senha de novo, e a senha não tem
   * nada de errado. A mensagem diz onde a conta funciona, que é a única coisa
   * útil a fazer — e não vaza nada, porque quem a lê já se autenticou.
   */
  [
    'SURFACE_NOT_ALLOWED',
    HttpStatus.FORBIDDEN,
    'Esta conta é do aplicativo Orbit de campo e não acessa o painel web.',
  ],
  /**
   * O período acabou; a permissão nunca foi o problema.
   *
   * Código próprio para que a tela ofereça a ação que resolve — escolher um
   * plano — em vez de mandar a pessoa procurar um administrador.
   */
  [
    'SUBSCRIPTION_EXPIRED',
    HttpStatus.PAYMENT_REQUIRED,
    'Sua assinatura está vencida. Escolha um plano para voltar a usar o Orbit.',
  ],
  [
    'ENTITY_NOT_FOUND',
    HttpStatus.NOT_FOUND,
    'O recurso solicitado não foi encontrado.',
  ],
  [
    'CONFLICT',
    HttpStatus.CONFLICT,
    'Não foi possível concluir por causa de um conflito nos dados.',
  ],
  [
    'RESOURCE_VERSION_CONFLICT',
    HttpStatus.CONFLICT,
    'Os dados foram alterados. Atualize e tente novamente.',
  ],
  [
    'STALE_VERSION',
    HttpStatus.CONFLICT,
    'Os dados foram alterados. Atualize e tente novamente.',
  ],
  [
    'IDEMPOTENCY_MISMATCH',
    HttpStatus.CONFLICT,
    'Esta chave de idempotência já foi usada com dados diferentes.',
  ],
  [
    'BUSINESS_RULE_VIOLATION',
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Não foi possível concluir esta ação.',
  ],
  [
    'REQUEST_REJECTED',
    HttpStatus.BAD_REQUEST,
    'Não foi possível processar a solicitação.',
  ],
  [
    'RATE_LIMITED',
    HttpStatus.TOO_MANY_REQUESTS,
    'Muitas tentativas. Aguarde e tente novamente.',
  ],
  [
    'CUSTOMER_DOCUMENT_ALREADY_EXISTS',
    HttpStatus.CONFLICT,
    'Já existe um cliente cadastrado com este CPF ou CNPJ.',
  ],
  [
    'CUSTOMER_PRIMARY_CONTACT_ALREADY_EXISTS',
    HttpStatus.CONFLICT,
    'Este cliente já possui um contato principal.',
  ],
  [
    'PORTAL_INVITATION_INVALID',
    HttpStatus.CONFLICT,
    'O convite não é válido ou expirou.',
  ],
  [
    'PORTAL_RESET_INVALID',
    HttpStatus.CONFLICT,
    'O link de recuperação não é válido ou expirou.',
  ],
  [
    'ARTIFACT_EXECUTION_INCOMPLETE',
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Conclua os campos e as assinaturas obrigatórias antes de continuar.',
  ],
  [
    'ARTIFACT_EXECUTION_NOT_EDITABLE',
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Esta execução de artefato não pode mais ser editada.',
  ],
  [
    'INVALID_ARTIFACT_EXECUTION_TRANSITION',
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Esta mudança de status não é permitida para a execução de artefato.',
  ],
  [
    'RENDERER_NOT_SUPPORTED',
    HttpStatus.BAD_REQUEST,
    'O formato de documento solicitado não está disponível.',
  ],
  [
    'SIGNATURE_MISSING',
    HttpStatus.UNPROCESSABLE_ENTITY,
    'A assinatura profissional necessária ainda não está disponível.',
  ],
  [
    'SERVICE_REQUEST_NOT_CANCELLABLE',
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Este Chamado não pode mais ser cancelado.',
  ],
  [
    'SERVICE_REQUEST_INVALID_TRANSITION',
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Esta mudança de status não é permitida para o Chamado.',
  ],
  [
    'SERVICE_REQUEST_CONVERSION_NOT_ALLOWED',
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Este Chamado não pode ser convertido em Operação.',
  ],
  [
    'SERVICE_REQUEST_ALREADY_CONVERTED',
    HttpStatus.CONFLICT,
    'Este Chamado já possui uma Operação vinculada.',
  ],
  [
    'CANCELLATION_NOT_ALLOWED',
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Este Chamado não pode mais ser cancelado.',
  ],
  [
    'INVALID_STATUS_TRANSITION',
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Esta mudança de status não é permitida para o Chamado.',
  ],
  [
    'CONVERSION_NOT_ALLOWED',
    HttpStatus.UNPROCESSABLE_ENTITY,
    'Este Chamado não pode ser convertido em Operação.',
  ],
  [
    'REQUEST_ALREADY_CONVERTED',
    HttpStatus.CONFLICT,
    'Este Chamado já possui uma Operação vinculada.',
  ],
  [
    'BUSINESS_UNIT_SCOPE_MISMATCH',
    HttpStatus.CONFLICT,
    'A unidade informada não pertence ao escopo deste Chamado.',
  ],
  [
    // 403: a organização não contratou a área. Não é falta de permissão da
    // pessoa, e a copy não nomeia a capacidade interna.
    'PLAN_CAPABILITY_NOT_AVAILABLE',
    HttpStatus.FORBIDDEN,
    'Seu plano não inclui este recurso.',
  ],
  [
    // 409: teto de quantidade simultânea. A copy fala do que a pessoa vê —
    // usuários, unidades, clientes —, jamais do nome interno do recurso.
    'PLAN_LIMIT_REACHED',
    HttpStatus.CONFLICT,
    'Seu plano atingiu o limite disponível para este item.',
  ],
  [
    'PLAN_USAGE_LIMIT_REACHED',
    HttpStatus.CONFLICT,
    'Seu plano atingiu o limite mensal deste recurso.',
  ],
  [
    // 500: catálogo mal configurado é defeito nosso, e falha fechada. Nunca
    // libera recurso por omissão.
    'PLAN_CONFIGURATION_INVALID',
    HttpStatus.INTERNAL_SERVER_ERROR,
    'Não foi possível concluir a solicitação.',
  ],
  [
    // 404: a organização não tem assinatura. Não é ausência de recurso pedido,
    // é ausência de contrato — e a copy fala do que a pessoa reconhece.
    'SUBSCRIPTION_NOT_FOUND',
    HttpStatus.NOT_FOUND,
    'Não encontramos uma assinatura para esta organização.',
  ],
  [
    'SUBSCRIPTION_NOT_ACTIVE',
    HttpStatus.FORBIDDEN,
    'A assinatura da sua organização não está ativa.',
  ],
  [
    'SUBSCRIPTION_INVALID_TRANSITION',
    HttpStatus.CONFLICT,
    'Esta mudança não é possível para a assinatura no estado atual.',
  ],
  [
    'PLAN_CHANGE_NOT_ALLOWED',
    HttpStatus.CONFLICT,
    'Não é possível trocar de plano agora.',
  ],
  [
    // 409 e deliberadamente vaga: dizer *por que* transformaria a resposta num
    // oráculo para descobrir quem já testou o Orbit a partir de um CNPJ.
    'TRIAL_NOT_ELIGIBLE',
    HttpStatus.CONFLICT,
    'Este período de teste não está disponível.',
  ],
  [
    // 503: a cobrança não está ligada neste ambiente. É indisponibilidade de
    // funcionalidade, não defeito — a tela precisa saber disso sem ver um erro.
    'BILLING_NOT_CONFIGURED',
    HttpStatus.SERVICE_UNAVAILABLE,
    'A cobrança não está disponível no momento.',
  ],
  [
    // 500: configuração nossa inválida. Falha fechada, e a copy não nomeia
    // preço, identificador nem provedor.
    'BILLING_CONFIGURATION_INVALID',
    HttpStatus.INTERNAL_SERVER_ERROR,
    'Não foi possível concluir a solicitação.',
  ],
  [
    'BILLING_CUSTOMER_NOT_AVAILABLE',
    HttpStatus.CONFLICT,
    'Ainda não foi possível preparar a cobrança da sua organização.',
  ],
  [
    'BILLING_CHECKOUT_NOT_ALLOWED',
    HttpStatus.CONFLICT,
    'Não é possível iniciar a contratação agora.',
  ],
  [
    // 503: o provedor não respondeu. Não é pagamento recusado, e a copy não
    // sugere que seja — o acesso de quem está em dia continua valendo.
    'BILLING_PROVIDER_UNAVAILABLE',
    HttpStatus.SERVICE_UNAVAILABLE,
    'A cobrança está indisponível no momento. Tente novamente em instantes.',
  ],
  [
    'BILLING_WEBHOOK_INVALID',
    HttpStatus.BAD_REQUEST,
    'Revise os campos informados.',
  ],
  [
    'EVIDENCE_LIMIT_REACHED',
    HttpStatus.CONFLICT,
    'O limite de evidências desta execução foi atingido.',
  ],
  [
    'UPLOAD_EXPIRED',
    HttpStatus.CONFLICT,
    'O prazo para envio do arquivo expirou. Inicie um novo envio.',
  ],
  ['FILE_INVALID', HttpStatus.BAD_REQUEST, 'O arquivo informado não é válido.'],
  [
    'FILE_TOO_LARGE',
    HttpStatus.BAD_REQUEST,
    'O arquivo excede o tamanho permitido.',
  ],
  [
    'PAYLOAD_TOO_LARGE',
    HttpStatus.PAYLOAD_TOO_LARGE,
    'O arquivo excede o tamanho permitido.',
  ],
  [
    'STORAGE_SIGNATURE_INVALID',
    HttpStatus.FORBIDDEN,
    'O link do arquivo não é válido ou expirou.',
  ],
  [
    'INTERNAL_ERROR',
    HttpStatus.INTERNAL_SERVER_ERROR,
    'Não foi possível concluir a solicitação.',
  ],
  [
    'INTERNAL_SERVER_ERROR',
    HttpStatus.INTERNAL_SERVER_ERROR,
    'Não foi possível concluir a solicitação.',
  ],
  [
    'SERVICE_UNAVAILABLE',
    HttpStatus.SERVICE_UNAVAILABLE,
    'O serviço está temporariamente indisponível. Tente novamente.',
  ],
] as const satisfies readonly (readonly [PublicErrorCode, number, string])[];

function buildCatalog(): ReadonlyMap<PublicErrorCode, PublicErrorDefinition> {
  const catalog = new Map<PublicErrorCode, PublicErrorDefinition>();
  for (const [code, status, message] of entries) {
    if (catalog.has(code))
      throw new Error(`Duplicate public error code: ${code}`);
    catalog.set(code, Object.freeze({ code, status, message }));
  }
  const missing = PUBLIC_ERROR_CODES.filter((code) => !catalog.has(code));
  if (missing.length > 0) {
    throw new Error(`Missing public error definitions: ${missing.join(', ')}`);
  }
  return catalog;
}

export const PUBLIC_ERROR_CATALOG = buildCatalog();

export function publicErrorDefinition(
  code: PublicErrorCode,
): PublicErrorDefinition {
  return PUBLIC_ERROR_CATALOG.get(code)!;
}
