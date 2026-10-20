"use client";

/**
 * Passo 4 — a conta fecha.
 *
 * ## O extenso vem do mesmo código que o PDF imprime
 *
 * `valorPorExtenso` mora nos contratos sincronizados justamente para isto: a tela
 * mostra a frase que vai sair no papel. Duas implementações escreveriam o mesmo
 * número de formas diferentes na primeira vez que alguém corrigisse uma só — e a
 * divergência apareceria como "a tela diz uma coisa e o PDF diz outra" sobre
 * dinheiro.
 *
 * ## Esta é a única vez que o cliente soma
 *
 * E só porque a proposta ainda não existe no servidor: não há o que pedir. Depois
 * de criada, todo valor vem calculado do backend, e esta conta não confere nada —
 * ela é substituída.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { FORMATTERS } from "@/metrics";
import { valorPorExtenso } from "@/types/contracts/amount-in-words";
import { draftTotals, type QuoteDraft } from "../quote-wizard.model";

export function AmountsStep({
  draft,
  onChange,
}: {
  draft: QuoteDraft;
  onChange: (patch: Partial<QuoteDraft>) => void;
}) {
  const totais = draftTotals(draft);

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qtd.</TableHead>
              <TableHead className="text-right">Unitário</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {draft.items.map((item) => (
              <TableRow key={item.key}>
                <TableCell>
                  <span className="block max-w-[18rem] truncate">
                    {item.description}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {item.kind === "SERVICE" ? "Serviço" : "Material"}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.quantity} {item.unit}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {FORMATTERS.currency(item.unitPrice)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {FORMATTERS.currency(item.quantity * item.unitPrice)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="wizard-discount">Desconto</Label>
          <Input
            id="wizard-discount"
            value={String(draft.discount)}
            inputMode="decimal"
            onChange={(event) =>
              onChange({
                discount: Number(event.target.value.replace(",", ".")) || 0,
              })
            }
          />
          <p className="text-xs text-muted-foreground">
            Sobre o total da proposta. Não pode passar do subtotal — um total
            negativo viraria despesa disfarçada de receita.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="wizard-discount-reason">Motivo do desconto</Label>
          <Textarea
            id="wizard-discount-reason"
            value={draft.discountReason}
            rows={2}
            maxLength={500}
            placeholder="Ex.: contrato anual de manutenção"
            onChange={(event) =>
              onChange({ discountReason: event.target.value })
            }
          />
          <p className="text-xs text-muted-foreground">
            Sai impresso junto do abatimento. Opcional — centavos para fechar a
            conta não pedem justificativa.
          </p>
        </div>
      </div>

      <dl className="space-y-2 rounded-xl border border-border p-4">
        <Line label="Subtotal" value={totais.subtotal} muted />
        {totais.discount > 0 ? (
          <Line label="Desconto" value={-totais.discount} muted />
        ) : null}
        <div className="flex items-baseline justify-between border-t border-border pt-3">
          <dt className="text-sm font-medium">Valor total</dt>
          <dd className="font-mono text-lg tabular-nums">
            {FORMATTERS.currency(totais.total)}
          </dd>
        </div>
        {/* O extenso é a defesa contra adulteração — e é o que se confere em voz
            alta ao aprovar por telefone. */}
        <p className="text-right text-xs text-muted-foreground">
          {valorPorExtenso(totais.total)}
        </p>
      </dl>
    </div>
  );
}

function Line({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: number;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className={
          muted
            ? "font-mono text-sm tabular-nums text-muted-foreground"
            : "font-mono text-sm tabular-nums"
        }
      >
        {FORMATTERS.currency(value)}
      </dd>
    </div>
  );
}
