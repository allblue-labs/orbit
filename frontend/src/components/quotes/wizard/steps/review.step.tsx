"use client";

/**
 * Passo 6 — o resumo e a aprovação.
 *
 * ## A confirmação não é a aprovação do cliente
 *
 * O que se marca aqui é "revisei o que montei". A aprovação do **cliente** é
 * outra coisa, acontece depois, e tem botão próprio na lista — confundir as duas
 * faria a proposta nascer aprovada sem ninguém de fora ter visto.
 *
 * ## Por que travar o botão numa caixa de seleção
 *
 * Porque gerar é irreversível na prática: a proposta ganha número da organização,
 * entra na contagem e vai ao cliente. Um clique a mais entre montar e emitir é
 * barato; descobrir o erro depois de enviado, não.
 */
import { Checkbox } from "@/components/ui/checkbox";
import { FORMATTERS } from "@/metrics";
import { valorPorExtenso } from "@/types/contracts/amount-in-words";
import { formatDay } from "../../quote-presentation";
import { draftTotals, type QuoteDraft } from "../quote-wizard.model";

export function ReviewStep({
  draft,
  responsibleName,
  addressSummary,
  assetNames,
  onChange,
}: {
  draft: QuoteDraft;
  /** Resolvidos por quem tem as consultas; o resumo não busca nada. */
  responsibleName: string | null;
  addressSummary: string | null;
  assetNames: readonly string[];
  onChange: (patch: Partial<QuoteDraft>) => void;
}) {
  const totais = draftTotals(draft);
  const servicos = draft.items.filter((item) => item.kind === "SERVICE");
  const materiais = draft.items.filter((item) => item.kind !== "SERVICE");

  return (
    <div className="space-y-5">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Entry label="Cliente">{draft.customerLabel ?? "—"}</Entry>
        <Entry label="Responsável">{responsibleName ?? "—"}</Entry>
        <Entry label="Válido até">
          {draft.validUntil ? formatDay(draft.validUntil) : "—"}
        </Entry>
        <Entry label="Itens">
          {servicos.length} serviço{servicos.length === 1 ? "" : "s"} ·{" "}
          {materiais.length} material{materiais.length === 1 ? "" : "is"}
        </Entry>
        <Entry label="Título" full>
          {draft.title || "—"}
        </Entry>
        <Entry label="Endereço" full>
          {addressSummary ?? "Sem endereço definido"}
        </Entry>
        {assetNames.length > 0 ? (
          <Entry label="Equipamentos" full>
            {assetNames.join(" · ")}
          </Entry>
        ) : null}
      </dl>

      <div className="space-y-2 rounded-xl border border-border p-4">
        <div className="flex items-baseline justify-between text-sm text-muted-foreground">
          <span>Subtotal</span>
          <span className="font-mono tabular-nums">
            {FORMATTERS.currency(totais.subtotal)}
          </span>
        </div>
        {totais.discount > 0 ? (
          <div className="flex items-baseline justify-between text-sm text-muted-foreground">
            <span>
              Desconto
              {draft.discountReason.trim()
                ? ` — ${draft.discountReason.trim()}`
                : ""}
            </span>
            <span className="font-mono tabular-nums">
              {FORMATTERS.currency(-totais.discount)}
            </span>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between border-t border-border pt-3">
          <span className="text-sm font-medium">Valor total</span>
          <span className="font-mono text-lg tabular-nums">
            {FORMATTERS.currency(totais.total)}
          </span>
        </div>
        <p className="text-right text-xs text-muted-foreground">
          {valorPorExtenso(totais.total)}
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4">
        <Checkbox
          checked={draft.approved}
          onCheckedChange={(checked) =>
            onChange({ approved: checked === true })
          }
        />
        <span className="space-y-1">
          <span className="block text-sm font-medium">
            Revisei e aprovo este orçamento
          </span>
          <span className="block text-xs text-muted-foreground">
            Ao gerar, a proposta recebe número, é impressa com o modelo premium
            e fica <strong>aguardando decisão do cliente</strong>. A aprovação
            do cliente é registrada depois, na lista.
          </span>
        </span>
      </label>
    </div>
  );
}

function Entry({
  label,
  children,
  full = false,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "min-w-0 sm:col-span-2" : "min-w-0"}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}
