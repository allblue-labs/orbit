"use client";

/**
 * Por que os botões de cadastro não estão aqui.
 *
 * ## O silêncio custou a correção
 *
 * As abas da Equipe decidiam mostrar "Nova equipe" com uma ação que estava
 * declarada indisponível no registry. O resultado foi a página inteira parecer
 * somente leitura — e ninguém viu, porque um botão ausente não deixa rastro:
 * nada no console, nada na rede, nenhuma mensagem.
 *
 * Uma frase no lugar do botão transforma o próximo defeito desses em relato.
 * E, quando o bloqueio é real, diz a quem pedir: plano se resolve na assinatura,
 * papel com quem administra a conta.
 */
export function ManagementBlocked({ reason }: { reason: string | null }) {
  if (!reason) return null;

  return (
    <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
      {reason} Por isso o cadastro não é oferecido nesta aba.
    </p>
  );
}
