/**
 * A assinatura autoriza usar o produto agora?
 *
 * ## Por que isto não é só o status
 *
 * Uma avaliação vence pelo **relógio**: a linha continua dizendo `TRIALING`
 * até alguém reconciliá-la, e ninguém reconcilia à meia-noite. Olhando só o
 * status, a interface concluía "assinatura ativa" no trigésimo primeiro dia
 * enquanto o servidor já recusava toda escrita com `402` — a pessoa clicava em
 * salvar e recebia um erro que a tela não sabia explicar.
 *
 * `ActivePlanGuard`, no backend, decide por status **e** fim de período. Esta
 * função é a mesma regra, do lado de cá, para que as duas pontas concordem.
 * Módulo sem `"use client"`: quem a chama é o resolvedor de sessão, no
 * servidor.
 */

/** Os estados em que a assinatura ainda libera o produto. */
export const STATUS_COM_ACESSO: readonly string[] = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE_PERIOD",
];

export function assinaturaVigente(
  status: string | undefined,
  fimDoPeriodo: string | null | undefined,
  agora: Date = new Date(),
): boolean {
  if (!status || !STATUS_COM_ACESSO.includes(status)) return false;

  /* A carência é posterior ao período pago; a data dele estar no passado é
     justamente o motivo deste estado e não deve esconder o acesso concedido. */
  if (status === "PAST_DUE" || status === "GRACE_PERIOD") return true;

  /* Sem período definido não há o que vencer — é o caso das contas anteriores
     à cobrança, que nunca tiveram data. */
  if (!fimDoPeriodo) return true;

  const fim = new Date(fimDoPeriodo).getTime();
  /* Data ilegível não derruba ninguém: o servidor é quem decide, e ele
     responderá 402 na primeira escrita se for o caso. */
  if (Number.isNaN(fim)) return true;

  return fim > agora.getTime();
}
