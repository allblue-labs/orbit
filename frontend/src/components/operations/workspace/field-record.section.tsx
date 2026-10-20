"use client";

/**
 * O que o campo registrou: as fotos e o aceite do cliente.
 *
 * ## Por que esta seção existe
 *
 * As duas coisas eram gravadas pelo aplicativo e só apareciam **dentro do PDF**.
 * Quem acompanha o atendimento pela plataforma não tinha como ver se havia
 * evidência nem se o cliente assinou, a não ser emitindo o documento e abrindo o
 * arquivo — o que só é possível depois de o atendimento acabar. Enquanto ele
 * acontecia, a web era cega para a parte mais concreta dele.
 *
 * ## As duas juntas, e separadas
 *
 * Mesma seção porque são a mesma pergunta — "o que o técnico registrou lá?" —, e
 * blocos distintos porque uma foto é prova do serviço e a assinatura é a
 * concordância de quem recebeu. Somá-las num "anexos do atendimento" apagaria o
 * peso da segunda.
 *
 * ## A imagem vem do storage
 *
 * O endereço é assinado e temporário, com host próprio: `<img>` cru, e não
 * `next/image` — não há o que otimizar num endereço que expira.
 */
import { useState } from "react";
import { PenLine } from "lucide-react";

import { PanelFrame, PanelState, type PanelQuery } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/formatters";
import type {
  OperationFieldEvidence,
  OperationFieldRecord,
} from "@/types/operations";

/**
 * A categoria da foto, em português.
 *
 * `BEFORE`/`AFTER` são o par que sustenta a cobrança: mostram o mesmo
 * equipamento antes e depois. Traduzir é o mínimo — o código do banco não é
 * texto para ninguém ler.
 */
const CATEGORIES: Readonly<Record<string, string>> = {
  BEFORE: "Antes",
  AFTER: "Depois",
  GENERAL: "Geral",
  EQUIPMENT: "Equipamento",
  DEFECT: "Defeito",
  MEASUREMENT: "Medição",
};

/** De onde a imagem veio: tirada na hora, ou escolhida da galeria. */
const SOURCES: Readonly<Record<string, string>> = {
  CAMERA: "Câmera",
  GALLERY: "Galeria",
};

export function FieldRecordSection({
  query,
}: {
  query: PanelQuery<OperationFieldRecord>;
}) {
  const [aberta, setAberta] = useState<OperationFieldEvidence | null>(null);

  return (
    <PanelFrame
      panelId="operation-field-record"
      title="Registro de campo"
      description="Fotos do atendimento e o aceite do cliente"
    >
      <PanelState query={query} loadingRows={3}>
        {(record) =>
          record.evidence.length === 0 && !record.acknowledgement ? (
            <p className="text-sm text-muted-foreground">
              Nada foi registrado em campo ainda. As fotos e o aceite do cliente
              aparecem aqui conforme o técnico os envia.
            </p>
          ) : (
            <div className="space-y-6">
              {record.evidence.length > 0 ? (
                <section className="space-y-3">
                  <header className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Evidências</h3>
                    <span className="text-xs text-muted-foreground">
                      {record.evidence.length}{" "}
                      {record.evidence.length === 1 ? "foto" : "fotos"}
                    </span>
                  </header>

                  <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {record.evidence.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setAberta(item)}
                          className="group focus-visible:ring-ring block w-full space-y-1.5 text-left focus-visible:ring-2 focus-visible:outline-none"
                        >
                          <span className="block overflow-hidden rounded-lg border border-border bg-muted/30">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.url}
                              alt={
                                CATEGORIES[item.category] ?? item.category
                              }
                              loading="lazy"
                              className="aspect-4/3 w-full object-cover transition group-hover:opacity-90"
                            />
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="secondary" className="text-xs">
                              {CATEGORIES[item.category] ?? item.category}
                            </Badge>
                            {SOURCES[item.source] ? (
                              <span className="text-xs text-muted-foreground">
                                {SOURCES[item.source]}
                              </span>
                            ) : null}
                          </span>
                          {item.capturedBy ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {item.capturedBy.displayName}
                              {item.capturedAt
                                ? ` · ${formatDateTime(item.capturedAt)}`
                                : ""}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {record.acknowledgement ? (
                <section className="space-y-2 rounded-lg border border-border p-3">
                  <header className="flex items-center gap-2">
                    <PenLine className="size-4 text-muted-foreground" />
                    <h3 className="text-sm font-medium">Aceite do cliente</h3>
                  </header>
                  <p className="text-sm">
                    {record.acknowledgement.signerName}
                    <span className="text-muted-foreground">
                      {" · "}
                      {formatDateTime(record.acknowledgement.acknowledgedAt)}
                    </span>
                  </p>
                  {record.acknowledgement.capturedBy ? (
                    <p className="text-xs text-muted-foreground">
                      Colhido por{" "}
                      {record.acknowledgement.capturedBy.displayName}
                    </p>
                  ) : null}

                  {/* Sobre branco, que é o fundo em que ela é aplicada no
                      documento: traço claro sobre cinza parece legível aqui e
                      some no PDF. */}
                  {record.acknowledgement.signature ? (
                    <div className="flex h-24 items-center justify-center rounded-md border border-border bg-white p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={record.acknowledgement.signature.url}
                        alt={`Assinatura de ${record.acknowledgement.signerName}`}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  ) : (
                    /* Aceite sem assinatura acontece, e é diferente de não haver
                       aceite: o cliente reconheceu o atendimento e não assinou na
                       tela. Dizer isso evita a conclusão de que faltou colher. */
                    <p className="text-xs text-muted-foreground">
                      O cliente reconheceu o atendimento sem assinar na tela.
                    </p>
                  )}
                </section>
              ) : null}
            </div>
          )
        }
      </PanelState>

      {/* A foto em tamanho de leitura: numa grade de miniaturas não se enxerga a
          etiqueta do equipamento nem o estado do filtro, que é o que o dono
          precisa ver quando o cliente contesta. */}
      <Dialog open={aberta !== null} onOpenChange={() => setAberta(null)}>
        <DialogContent className="max-w-3xl">
          <DialogTitle className="text-sm font-medium">
            {aberta ? (CATEGORIES[aberta.category] ?? aberta.category) : ""}
            {aberta?.capturedAt ? ` · ${formatDateTime(aberta.capturedAt)}` : ""}
          </DialogTitle>
          {aberta ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={aberta.url}
              alt={CATEGORIES[aberta.category] ?? aberta.category}
              className="max-h-[70vh] w-full rounded-md object-contain"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </PanelFrame>
  );
}
