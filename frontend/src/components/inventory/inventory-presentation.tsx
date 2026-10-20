"use client";

/**
 * Como o estoque aparece.
 *
 * Nada aqui soma, subtrai ou compara com o mínimo: `available` e `status` vêm
 * do servidor. A única conta é `Number()` para formatar.
 */
import { cn } from "@/lib/utils";
import {
  INVENTORY_STATUS_LABELS,
  INVENTORY_TYPE_LABELS,
  type InventoryBalance,
  type InventoryMovement,
} from "@/types/inventory";

/**
 * Quantidade com até três casas, sem zeros inúteis.
 *
 * O contrato publica `"4.000"`; mostrar assim faria toda peça parecer medida
 * em milésimos. `2.500` continua `2,5`, porque meio quilo de gás existe.
 */
export function Quantity({
  value,
  unit,
  className,
}: {
  value: string;
  unit?: string;
  className?: string;
}) {
  const amount = Number(value);
  const text = Number.isFinite(amount)
    ? amount.toLocaleString("pt-BR", { maximumFractionDigits: 3 })
    : value;

  return (
    <span className={cn("font-mono tabular-nums", className)}>
      {text}
      {unit ? <span className="ml-1 text-xs text-muted-foreground">{unit}</span> : null}
    </span>
  );
}

const STATUS_CLASSES: Readonly<Record<string, string>> = {
  OK: "bg-emerald-500/15 text-emerald-400",
  LOW: "bg-amber-500/15 text-amber-400",
  OUT_OF_STOCK: "bg-rose-500/15 text-rose-400",
};

/**
 * Situação do saldo — **decidida pelo servidor**.
 *
 * O componente só pinta o que recebe. Comparar `available` com `minimumStock`
 * aqui criaria uma segunda régua, e as duas discordariam sobre o que é "baixo"
 * no primeiro empate.
 */
export function StockStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium",
        STATUS_CLASSES[status] ?? "bg-surface-strong text-muted-foreground",
        className,
      )}
    >
      {INVENTORY_STATUS_LABELS[status] ?? status}
    </span>
  );
}

const DIRECTION_CLASSES: Readonly<Record<string, string>> = {
  IN: "bg-emerald-500/15 text-emerald-400",
  OUT: "bg-rose-500/15 text-rose-400",
};

/**
 * Tipo do movimento, com a direção que o servidor resolveu.
 *
 * `direction` é publicado no Read Model — a tela não deduz do tipo, e por isso
 * um tipo novo do backend aparece com a cor certa sem passar por aqui.
 */
export function MovementTypeBadge({ movement }: { movement: InventoryMovement }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium",
        DIRECTION_CLASSES[movement.direction] ??
          "bg-surface-strong text-muted-foreground",
      )}
    >
      {INVENTORY_TYPE_LABELS[movement.type] ?? movement.type}
    </span>
  );
}

/**
 * Os quatro números do saldo, nunca resumidos em um.
 *
 * Em estoque, reservado, disponível e mínimo respondem perguntas diferentes:
 * o que há na prateleira, o que já tem dono, o que dá para prometer, e a
 * partir de quando repor. Um "saldo" único apagaria a distinção justo quando
 * ela passar a existir.
 */
export function BalanceFigures({
  balance,
  compact = false,
}: {
  balance: InventoryBalance;
  compact?: boolean;
}) {
  return (
    <dl
      className={cn(
        "grid gap-3",
        compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4",
      )}
    >
      <Figure label="Em estoque" hint="O que está fisicamente na unidade.">
        <Quantity
          value={balance.onHand}
          unit={balance.item.unit}
          className="text-lg font-semibold"
        />
      </Figure>
      <Figure
        label="Reservado"
        hint="Comprometido e ainda não consumido. Nenhum fluxo reserva hoje."
      >
        <Quantity value={balance.reserved} className="text-muted-foreground" />
      </Figure>
      <Figure label="Disponível" hint="Em estoque menos reservado.">
        <Quantity value={balance.available} className="text-lg font-semibold" />
      </Figure>
      <Figure
        label="Mínimo"
        hint="Política de reposição. Zero desliga o alerta."
      >
        <Quantity value={balance.minimumStock} className="text-muted-foreground" />
      </Figure>
    </dl>
  );
}

function Figure({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground" title={hint}>
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * O aviso que a tela precisa dar sobre reserva.
 *
 * `reserved` aparece em toda linha de saldo, e a pergunta "como eu reservo?"
 * vem logo depois. A resposta honesta é que não dá — ainda.
 */
export function ReservedNotice({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      <strong className="text-foreground">Reservado é somente leitura.</strong>{" "}
      O campo já existe e é calculado <em>disponível</em> a partir dele,
      mas ainda não existe fluxo de reserva — nada no sistema reserva material
      hoje.
    </p>
  );
}

/**
 * O que um ajuste é, dito onde ele é feito.
 *
 * A confusão comum é achar que ajuste "corrige o saldo". Ele não corrige: cria
 * um movimento a mais, e o saldo passa a ser a soma incluindo esse movimento.
 * É a diferença entre consertar a foto e registrar o que aconteceu.
 */
export function AdjustmentNotice({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
    >
      <strong className="text-foreground">
        Ajuste não altera o saldo diretamente.
      </strong>{" "}
      Ele cria uma movimentação no histórico, com motivo e autor — o saldo
      anterior continua explicável. Não existe &quot;definir novo saldo&quot;:
      informe <em>quanto</em> sobrou ou faltou na contagem.
    </p>
  );
}
