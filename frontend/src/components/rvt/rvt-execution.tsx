"use client";

/**
 * A visita física.
 *
 * ## Uma consulta, N equipamentos
 *
 * `GET /rvt/executions/:id` já devolve equipamentos, equipe, evidências,
 * aceite e documento. Nada aqui busca equipamento por linha: o Read Model
 * agregado existe exatamente para que uma visita com vinte máquinas custe uma
 * requisição, não vinte e uma.
 *
 * ## Papéis são distintos
 *
 * Técnico em Campo, auxiliares técnico e Responsável Técnico aparecem
 * separados, com os termos da FE-02. "Equipe técnica" como rótulo único
 * apagaria justamente a distinção que o domínio mantém — e a mesma pessoa
 * pode ocupar dois papéis na mesma visita, o que só se enxerga se os dois
 * estiverem escritos.
 *
 * ## Execução não é documento
 *
 * Concluir a visita e emitir o RVT são fatos separados. O documento aparece
 * quando existe, com o estado que o servidor publica, e o download passa pelo
 * pipeline canônico de artefatos — esta tela não renderiza PDF.
 */
import { useState } from "react";
import { FileText, Images, Package, Route, UserRound } from "lucide-react";
import Link from "next/link";

import { DocumentViewer } from "@/components/documents/document-viewer";
import { PanelError } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRvtExecution } from "@/hooks/rvt/use-rvt";
import { formatDateTime } from "@/lib/formatters";
import { ROUTES } from "@/lib/routes";
import { readAcknowledgement, readNotes, type RvtNote } from "@/types/rvt";
import type { RvtExecution } from "@/types/rvt";
import {
  DocumentStatusBadge,
  ExecutionStatusBadge,
  RenderStatusBadge,
} from "./rvt-presentation";

export function RvtExecutionWorkspace({
  executionId,
}: {
  executionId: string;
}) {
  const execution = useRvtExecution(executionId);

  if (execution.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (execution.error) {
    return (
      <PanelError
        error={execution.error}
        onRetry={() => void execution.refetch()}
      />
    );
  }

  if (!execution.data) return null;

  return (
    <div className="space-y-5">
      <ExecutionHeader execution={execution.data} />
      <TeamSection execution={execution.data} />
      <EquipmentSection execution={execution.data} />
      <NotesSection execution={execution.data} />
      <EvidenceSection execution={execution.data} />
      <AcknowledgementSection execution={execution.data} />
      <DocumentSection execution={execution.data} />
    </div>
  );
}

function ExecutionHeader({ execution }: { execution: RvtExecution }) {
  return (
    <header className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Visita técnica</h2>
          <p className="text-xs text-muted-foreground">
            Iniciada em {formatDateTime(execution.startedAt)}
            {execution.completedAt
              ? ` · concluída em ${formatDateTime(execution.completedAt)}`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExecutionStatusBadge status={execution.status} />
          <Button asChild variant="ghost" size="sm">
            <Link href={ROUTES.rvt}>
              <Route className="size-3.5" />
              Visitas técnicas
            </Link>
          </Button>
        </div>
      </div>

      {/**
       * A Operation espelhada é **projeção operacional**, não a visita.
       *
       * Ela existe para o atendimento aparecer nos fluxos de OS. Mostrá-la como
       * atalho preserva o contexto sem sugerir que o RVT é uma Operation com
       * outro tipo.
       */}
      {execution.operation ? (
        <p className="text-xs text-muted-foreground">
          Atendimento vinculado:{" "}
          <Link
            href={`${ROUTES.operations}/${execution.operation.id}`}
            className="font-mono hover:underline"
          >
            {execution.operation.code}
          </Link>
        </p>
      ) : null}
    </header>
  );
}

function TeamSection({ execution }: { execution: RvtExecution }) {
  return (
    <section
      className="space-y-3 rounded-xl border border-border p-4"
      aria-label="Equipe da visita"
    >
      <h3 className="text-sm font-semibold">Equipe</h3>

      <div className="grid gap-3 sm:grid-cols-3">
        <Role
          label="Técnico em Campo"
          people={[execution.responsibleFieldTechnician]}
        />
        <Role
          label="auxiliares técnico"
          people={execution.auxiliaryTechnicians}
          empty="Nenhum auxiliar registrado."
        />
        {/**
         * RT ausente **não é erro** quando a configuração não o exige. O
         * texto neutro diz o que se sabe: não houve RT nesta visita. A
         * exigência é da configuração, e é lá que ela aparece.
         */}
        <Role
          label="Responsável Técnico"
          people={
            execution.technicalResponsible
              ? [execution.technicalResponsible]
              : []
          }
          empty="Sem Responsável Técnico nesta visita."
        />
      </div>
    </section>
  );
}

function Role({
  label,
  people,
  empty,
}: {
  label: string;
  people: readonly { id: string; name: string }[];
  empty?: string;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <UserRound className="size-3" />
        {label}
      </p>
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {people.map((person) => (
            <li key={person.id} className="truncate text-sm">
              {person.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EquipmentSection({ execution }: { execution: RvtExecution }) {
  return (
    <section
      className="space-y-3 rounded-xl border border-border p-4"
      aria-label="Equipamentos visitados"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Equipamentos visitados</h3>
        <Badge variant="secondary">{execution.equipment.length}</Badge>
      </div>

      {execution.equipment.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Package className="size-4" />
          Nenhum equipamento registrado nesta visita.
        </p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {execution.equipment.map((item) => (
            <li
              key={item.id}
              className="min-w-0 rounded-lg border border-border px-3 py-2"
            >
              <p className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate text-sm font-medium">
                  {item.name}
                </span>
                {/**
                 * Equipamento cadastrado durante a visita é fato do domínio —
                 * o app de campo cria o ativo no ato. Marcar isso explica por
                 * que ele não estava na configuração.
                 */}
                {item.addedDuringExecution ? (
                  <Badge
                    variant="secondary"
                    className="border-none bg-surface-strong text-[10px] text-muted-foreground"
                  >
                    Cadastrado em campo
                  </Badge>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {item.category}
                {item.identifier ? ` · ${item.identifier}` : ""}
                {item.serialNumber ? ` · série ${item.serialNumber}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Observações e recomendações.
 *
 * O contrato publica os dois como JSON livre — o backend não define forma, e o
 * app de campo grava o que o procedimento pedir. Em vez de inventar um
 * esquema, a tela mostra os pares de texto que existirem. `recomendação livre`
 * é campo tipado e aparece como o texto que é.
 */
function NotesSection({ execution }: { execution: RvtExecution }) {
  const observations = readNotes(execution.observations);
  const recommendations = readNotes(execution.recommendations);
  const free = execution.freeTextRecommendation?.trim();

  if (observations.length === 0 && recommendations.length === 0 && !free) {
    return null;
  }

  return (
    <section className="grid gap-4 md:grid-cols-2">
      <NoteGroup
        title="Observações"
        notes={observations}
        empty="Nenhuma observação registrada."
      />
      <div className="space-y-3 rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold">Recomendações</h3>
        {recommendations.length === 0 && !free ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma recomendação registrada.
          </p>
        ) : (
          <>
            <NoteList notes={recommendations} />
            {free ? (
              <p className="whitespace-pre-wrap break-words text-sm">{free}</p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function NoteGroup({
  title,
  notes,
  empty,
}: {
  title: string;
  notes: readonly RvtNote[];
  empty: string;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {notes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <NoteList notes={notes} />
      )}
    </div>
  );
}

function NoteList({ notes }: { notes: readonly RvtNote[] }) {
  return (
    <ul className="space-y-2">
      {notes.map((note, index) => (
        <li
          key={index}
          className="rounded-lg border border-border px-3 py-2 text-sm"
        >
          {note.entries.map((entry) => (
            <p
              key={entry.label}
              className="break-words text-sm [overflow-wrap:anywhere]"
            >
              {entry.label ? (
                <span className="text-xs text-muted-foreground">
                  {entry.label}:{" "}
                </span>
              ) : null}
              {entry.value}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}

/**
 * As evidências desta visita.
 *
 * A coleção vem dentro da execução, então não há como as fotos de uma visita
 * aparecerem em outra. O que se mostra é o registro — legenda, tipo e a que
 * equipamento pertence. Bytes de imagem não são carregados aqui: o pipeline
 * de mídia entrega URL assinada de vida curta, e um mural de miniaturas
 * pediria uma assinatura por arquivo a cada abertura da tela.
 */
function EvidenceSection({ execution }: { execution: RvtExecution }) {
  const byAsset = new Map(
    execution.equipment.map((item) => [item.id, item.name]),
  );

  return (
    <section
      className="space-y-3 rounded-xl border border-border p-4"
      aria-label="Evidências"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Evidências</h3>
        <Badge variant="secondary">{execution.evidence.length}</Badge>
      </div>

      {execution.evidence.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Images className="size-4" />
          Nenhuma evidência registrada.
        </p>
      ) : (
        <ul className="space-y-2">
          {execution.evidence.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {item.kind === "PHOTO"
                  ? "Foto"
                  : item.kind === "VIDEO"
                    ? "Vídeo"
                    : "Documento"}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {item.caption ?? "Sem legenda"}
              </span>
              {item.assetId && byAsset.has(item.assetId) ? (
                <span className="truncate text-xs text-muted-foreground">
                  {byAsset.get(item.assetId)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A ciência do cliente.
 *
 * É **opcional** por política do servidor (`customerSignatureRequired: false`),
 * então a ausência não é falha e não vira alerta. O que se mostra quando
 * existe é o instantâneo: quem assinou e quando. Não é alteração cadastral do
 * cliente — é o registro de que alguém, presente na visita, deu ciência.
 */
function AcknowledgementSection({ execution }: { execution: RvtExecution }) {
  const acknowledgement = readAcknowledgement(
    execution.customerAcknowledgement,
  );

  return (
    <section
      className="space-y-2 rounded-xl border border-border p-4"
      aria-label="Ciência do cliente"
    >
      <h3 className="text-sm font-semibold">Ciência do cliente</h3>
      {acknowledgement ? (
        <>
          <p className="text-sm">
            <span className="font-medium">{acknowledgement.name}</span>
            {acknowledgement.signedAt
              ? ` · ${formatDateTime(acknowledgement.signedAt)}`
              : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Registro do aceite colhido em campo. Não altera o cadastro do
            cliente.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Sem ciência registrada. A assinatura do cliente é opcional nesta
          visita.
        </p>
      )}
    </section>
  );
}

/**
 * O documento RVT.
 *
 * Nasce da **execução** — nem da configuração, nem da ocorrência isolada. Duas
 * informações distintas: o estado do documento e o do arquivo. Um RVT pode
 * estar emitido e ainda não ter PDF pronto, e prometer download nesse momento
 * levaria o usuário a um erro.
 *
 * Não há botão de gerar: `POST /executions/:id/artifact` exige `rvt.execute` e
 * pertence ao encerramento em campo. O que existe aqui é ler o que foi
 * emitido, pelo visualizador canônico de artefatos — preview e download com
 * URL assinada pedida ao backend.
 */
function DocumentSection({ execution }: { execution: RvtExecution }) {
  const [viewing, setViewing] = useState<string | null>(null);
  const artifact = execution.artifact;

  return (
    <section
      className="space-y-3 rounded-xl border border-border p-4"
      aria-label="Documento RVT"
    >
      <h3 className="text-sm font-semibold">Documento RVT</h3>

      {artifact ? (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-mono text-xs text-muted-foreground">
              {artifact.code}
            </span>
            <DocumentStatusBadge status={artifact.status} />
            <RenderStatusBadge status={artifact.renderStatus} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => setViewing(artifact.id)}
            >
              <FileText className="size-3.5" />
              Abrir documento
            </Button>
          </div>
          <DocumentViewer
            executionId={viewing}
            onOpenChange={(open) => {
              if (!open) setViewing(null);
            }}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhum documento emitido. O RVT é gerado a partir da conclusão da
          visita em campo.
        </p>
      )}
    </section>
  );
}
