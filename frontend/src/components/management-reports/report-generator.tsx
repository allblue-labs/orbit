"use client";

/**
 * Gerar um relatório.
 *
 * ## O catálogo manda em tudo
 *
 * Tipos, descrição, domínios, formatos, janela máxima e **quais parâmetros
 * cada tipo aceita** vêm de `GET /management-reports/catalog`. Não há lista de
 * tipos escrita aqui: um tipo novo aparece sozinho, um que saiu some sozinho,
 * e um tipo desconhecido é renderizado como qualquer outro — o formulário se
 * monta a partir do que ele declara.
 *
 * ## Autorização é do servidor, e vem resolvida
 *
 * O catálogo publica `allowed` e `blockedReason` **por tipo**, já considerando
 * plano e papel. A tela não recalcula: mostra o cartão desabilitado com o
 * motivo escrito. Recalcular aqui seria manter uma segunda régua de
 * autorização, e ela divergiria no primeiro papel novo.
 *
 * ## Datas vão como dia
 *
 * `YYYY-MM-DD`, sem hora e sem fuso. Quem decide onde o dia começa é o
 * servidor, a partir da unidade de negócio — converter aqui faria o mesmo
 * "outubro" começar em horas diferentes conforme quem clicou.
 */
import { useMemo, useState } from "react";
import { CalendarRange, Play } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelError, PanelFrame, PanelLoading } from "@/components/panels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useGenerateReport,
  useReportCatalog,
} from "@/hooks/management-reports/use-management-reports";
import { cn } from "@/lib/utils";
import { useActiveScope } from "@/providers/use-active-scope";
import {
  REPORT_PARAMETER_LABELS,
  type ReportCatalogType,
} from "@/types/management-reports";
import { OperationKind, OperationStatus } from "@/types/contracts";
import {
  OPERATION_KIND_LABELS,
  OPERATION_STATUS_LABELS,
} from "@/types/operations";
import { DomainBadges } from "./report-presentation";

const ANY = "__any__";

/** Primeiro e último dia do mês passado — o recorte que quase sempre se quer. */
function defaultPeriod(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
  };
}

export function ReportGenerator({
  canManage,
  onGenerated,
  initialType,
  initialPeriod,
}: {
  canManage: boolean;
  /** Chamado com o id da solicitação — quem acompanha é a tela de cima. */
  onGenerated: (reportId: string) => void;
  initialType?: string;
  /**
   * Recorte escolhido em outra aba.
   *
   * Quem olhou "como foi o mês passado" na Visão geral já decidiu o período;
   * pedir que digite de novo aqui transformaria uma decisão em duas digitações,
   * e a segunda erraria.
   */
  initialPeriod?: { from: string; to: string };
}) {
  const catalog = useReportCatalog();
  const [selected, setSelected] = useState<string | null>(initialType ?? null);

  if (catalog.isPending) {
    return (
      <PanelFrame
        panelId="reports-generator-loading"
        title="Gerar relatório"
        description="Carregando o catálogo de relatórios"
      >
        <PanelLoading rows={4} />
      </PanelFrame>
    );
  }

  if (catalog.error) {
    return (
      <PanelFrame
        panelId="reports-generator-error"
        title="Gerar relatório"
        description="Tipos de relatório disponíveis"
      >
        <PanelError
          error={catalog.error}
          onRetry={() => void catalog.refetch()}
        />
      </PanelFrame>
    );
  }

  const types = catalog.data?.types ?? [];
  const current = types.find((type) => type.type === selected) ?? null;

  return (
    <div className="space-y-6">
      <PanelFrame
        panelId="reports-generator-catalog"
        title="O que você quer olhar"
        description="Cada relatório usa os domínios que declara — e exige o acesso a eles."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {types.map((type) => (
            <TypeCard
              key={type.type}
              type={type}
              selected={type.type === selected}
              onSelect={() => setSelected(type.type)}
            />
          ))}
        </div>
      </PanelFrame>

      {current ? (
        <ParametersForm
          key={`${current.type}:${initialPeriod?.from ?? ""}:${initialPeriod?.to ?? ""}`}
          type={current}
          canManage={canManage}
          onGenerated={onGenerated}
          initialPeriod={initialPeriod}
        />
      ) : null}
    </div>
  );
}

function TypeCard({
  type,
  selected,
  onSelect,
}: {
  type: ReportCatalogType;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!type.allowed}
      className={cn(
        "rounded-lg border p-3 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/40",
        type.allowed ? "" : "cursor-not-allowed opacity-60",
      )}
    >
      <p className="font-medium">{type.name}</p>
      <p className="mt-1 text-xs text-muted-foreground">{type.description}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <DomainBadges domains={type.domains} />
      </div>
      {/*
        O motivo vem escrito do servidor.

        "Este relatório usa Financeiro, e seu acesso não inclui Financeiro" é
        uma frase útil; um cartão que some sem explicação faz a pessoa procurar
        um relatório que ela acha que existia.
      */}
      {type.blockedReason ? (
        <p className="mt-2 text-xs text-warning">{type.blockedReason}</p>
      ) : null}
    </button>
  );
}

function ParametersForm({
  type,
  canManage,
  onGenerated,
  initialPeriod,
}: {
  type: ReportCatalogType;
  canManage: boolean;
  onGenerated: (reportId: string) => void;
  initialPeriod?: { from: string; to: string };
}) {
  const scope = useActiveScope();
  const generate = useGenerateReport();
  /**
   * Congelado na montagem: o padrão não deve mudar sob quem está digitando.
   *
   * A `key` do formulário inclui o recorte recebido, então escolher outro
   * período na Visão geral remonta o formulário com ele — e não sobrescreve o
   * que alguém está digitando aqui.
   */
  const period = useMemo(
    () => initialPeriod ?? defaultPeriod(),
    [initialPeriod],
  );

  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const [businessUnitId, setBusinessUnitId] = useState(ANY);
  const [operationKind, setOperationKind] = useState(ANY);
  const [operationStatus, setOperationStatus] = useState(ANY);
  const [format, setFormat] = useState(type.formats[0] ?? "PDF");

  /*
    Trocar de tipo zera os filtros sem efeito nenhum: o formulário é montado
    com `key={type.type}`, então mudar de tipo o remonta. Um `useEffect` que
    limpasse estado depois da renderização mostraria, por um quadro, os filtros
    do tipo anterior sobre o tipo novo.
  */

  const accepts = (parameter: string) => type.parameters.includes(parameter);

  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
  const invalidPeriod = !from || !to || Number.isNaN(days) || days < 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    generate.mutate(
      {
        type: type.type,
        dateFrom: from,
        dateTo: to,
        format,
        /** Só o que o tipo declara aceitar — o backend recusa o resto. */
        ...(accepts("businessUnitId") && businessUnitId !== ANY
          ? { businessUnitId }
          : {}),
        ...(accepts("operationKind") && operationKind !== ANY
          ? { operationKind }
          : {}),
        ...(accepts("operationStatus") && operationStatus !== ANY
          ? { operationStatus }
          : {}),
      },
      { onSuccess: (report) => onGenerated(report.id) },
    );
  };

  return (
    <PanelFrame
      panelId="reports-generator-parameters"
      title={type.name}
      description="O período é obrigatório; o resto é o que este relatório aceita."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="report-from">Início do período</Label>
            <Input
              id="report-from"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="report-to">Fim do período</Label>
            <Input
              id="report-to"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              required
            />
          </div>
        </div>

        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarRange className="size-4" aria-hidden />
          Até {type.maxRangeDays} dias por relatório. O fuso é o da unidade — as
          datas são dias, não horários.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          {accepts("businessUnitId") ? (
            <div className="space-y-2">
              <Label htmlFor="report-unit">
                {REPORT_PARAMETER_LABELS.businessUnitId}
              </Label>
              <Select value={businessUnitId} onValueChange={setBusinessUnitId}>
                <SelectTrigger id="report-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Toda a organização</SelectItem>
                  {scope.businessUnits.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.tradeName ?? unit.legalName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {accepts("operationKind") ? (
            <div className="space-y-2">
              <Label htmlFor="report-kind">
                {REPORT_PARAMETER_LABELS.operationKind}
              </Label>
              <Select value={operationKind} onValueChange={setOperationKind}>
                <SelectTrigger id="report-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Todos</SelectItem>
                  {Object.values(OperationKind).map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {OPERATION_KIND_LABELS[kind] ?? kind}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {accepts("operationStatus") ? (
            <div className="space-y-2">
              <Label htmlFor="report-status">
                {REPORT_PARAMETER_LABELS.operationStatus}
              </Label>
              <Select
                value={operationStatus}
                onValueChange={setOperationStatus}
              >
                <SelectTrigger id="report-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Todas</SelectItem>
                  {Object.values(OperationStatus).map((status) => (
                    <SelectItem key={status} value={status}>
                      {OPERATION_STATUS_LABELS[status] ?? status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="report-format">Formato</Label>
            <Select value={format} onValueChange={setFormat}>
              <SelectTrigger id="report-format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {type.formats.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/*
          `customerId` é declarado por alguns tipos, mas não há seletor.

          A busca de cliente por rótulo não faz parte do contrato de relatórios,
          e um campo de identificador para digitar à mão não serviria a
          ninguém. A ausência está declarada na documentação em vez de virar um
          formulário que ninguém consegue preencher.
        */}

        <MutationError error={generate.error} />

        <div className="flex items-center gap-3">
          <Button
            type="submit"
            disabled={!canManage || invalidPeriod || generate.isPending}
          >
            <Play className="size-4" />
            {generate.isPending ? "Enviando…" : "Gerar relatório"}
          </Button>
          {canManage ? null : (
            <p className="text-xs text-muted-foreground">
              Você pode consultar relatórios, mas gerar exige permissão de
              gestão.
            </p>
          )}
        </div>
      </form>
    </PanelFrame>
  );
}
