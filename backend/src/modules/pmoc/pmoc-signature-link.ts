/**
 * O link temporário de assinatura do contrato de PMOC.
 *
 * ## O que este módulo decide
 *
 * Se um link ainda vale, e o que responder quando não vale. Nada mais: gerar o
 * segredo, gravar e ler são do serviço e do repositório.
 *
 * ## Por que a razão da recusa é separada do "não vale"
 *
 * Porque a página pública precisa dizer **qual** problema aconteceu. "Link inválido"
 * para três situações diferentes — expirou, foi substituído, já foi assinado —
 * manda o contratante perguntar ao dono o que ele mesmo podia ter lido na tela. E a
 * terceira não é nem erro: contrato já assinado é o fim feliz.
 */

/** O estado de um link, na ordem em que a página pública precisa saber. */
export type EstadoDoLink = 'VALIDO' | 'EXPIRADO' | 'REVOGADO' | 'JA_ASSINADO';

export interface LinkParaAvaliar {
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly signedAt: Date | null;
}

/**
 * Em que estado o link está.
 *
 * A ordem das verificações é a ordem da verdade mais forte: um link assinado é
 * assinado mesmo depois de a validade passar, e um revogado é revogado mesmo que a
 * validade ainda corra. Avaliar a expiração primeiro faria um contrato assinado na
 * semana passada aparecer como "expirado" — e aí o contratante acharia que a
 * assinatura dele não valeu.
 */
export function estadoDoLink(
  link: LinkParaAvaliar,
  agora = new Date(),
): EstadoDoLink {
  if (link.signedAt) return 'JA_ASSINADO';
  if (link.revokedAt) return 'REVOGADO';
  if (link.expiresAt.getTime() <= agora.getTime()) return 'EXPIRADO';
  return 'VALIDO';
}

/** O que a página pública mostra em cada estado. */
export const MOTIVO_DO_ESTADO: Readonly<Record<EstadoDoLink, string>> = {
  VALIDO: '',
  EXPIRADO: 'Este link expirou. Peça um novo a quem enviou o contrato.',
  REVOGADO:
    'Este link foi substituído por um mais recente. Use o último que você recebeu.',
  JA_ASSINADO:
    'Este contrato já foi assinado. Nada mais é necessário da sua parte.',
};

/** Quantas horas um link vale. */
export const HORAS_DE_VALIDADE = 72;

/**
 * Até quando o link vale.
 *
 * Setenta e duas horas: tempo de o contratante receber por e-mail ou WhatsApp, ler o
 * contrato e assinar — inclusive atravessando um fim de semana, que é quando o
 * administrativo de uma empresa pequena para. Menos que isso transformaria o recurso
 * em "assine agora ou peça outro"; muito mais deixaria um link de contrato aberto
 * circulando por semanas.
 */
export function validadeDoLink(agora = new Date()): Date {
  return new Date(agora.getTime() + HORAS_DE_VALIDADE * 60 * 60 * 1000);
}
