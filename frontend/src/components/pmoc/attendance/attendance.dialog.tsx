"use client";

/**
 * O atendimento de um equipamento, na web.
 *
 * ## Por que existe
 *
 * A tela de PMOC mostrava "Pronto para execução em campo" e não oferecia como
 * executar. O dono precisava do aplicativo — ou de ninguém, quando o técnico
 * faltou. Todas as rotas existiam; faltava a porta.
 *
 * ## Abertura, coleta, revisão e relatório
 *
 * Escalar abre a execução e a ordem de serviço 1:1 dela. O roteiro é o que o
 * plano manda conferir, lido pelo servidor — o mesmo texto que o PDF imprime.
 * A revisão reúne equipe, roteiro, imagens e observações. Confirmar conclui a
 * manutenção e solicita o relatório. Uma falha na emissão permite repetir essa
 * etapa sem concluir o atendimento novamente.
 *
 * ## A autoridade é do servidor
 *
 * `allowedActions` decide em que passo o atendimento está, e `eligibility` diz se
 * pode começar. A tela lê as duas; não deduz nada de `status`. As regras moram em
 * `attendance.model.ts`, com teste.
 */
import { useState } from "react";
import { AttendanceEvidence } from "./attendance-evidence";
import { AttendanceReport } from "./attendance-report";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCheck,
  FileText,
  Loader2,
  Package,
} from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  useCompletePmocExecution,
  useGeneratePmocExecutionArtifact,
  usePmocExecutionPreparation,
  useStartPmocExecution,
} from "@/hooks/pmoc/use-pmoc";
import { executionBlockedLabel, knownBlockedReason } from "@/registry";

import { useTimeZone } from "@/hooks/use-timezone";
import { useDateFormatters } from "@/hooks/use-date-formatters";
import { notifySuccess } from "@/lib/notify";
import { cn } from "@/lib/utils";
import type { PmocExecutionPreparation } from "@/types/pmoc";
import {
  ATTENDANCE_STEPS,
  STEP_TITLES,
  completePayload,
  currentStep,
  emptyDraft,
  isFinished,
  startPayload,
  stepIssues,
  type AttendanceDraft,
  type AttendanceStep,
} from "./attendance.model";

export function PmocAttendanceDialog({
  planId,
  cycleId,
  assetId,
  open,
  onOpenChange,
}: {
  planId: string;
  cycleId: string;
  assetId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  /* Desmontar ao fechar zera o rascunho: reabrir depois de desistir começa do
     começo, não continua um formulário abandonado. */
  if (!open || !assetId) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <Body
          planId={planId}
          cycleId={cycleId}
          assetId={assetId}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  planId,
  cycleId,
  assetId,
  onOpenChange,
}: {
  planId: string;
  cycleId: string;
  assetId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const preparation = usePmocExecutionPreparation(planId, cycleId, assetId);

  if (preparation.isPending) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Atender equipamento</DialogTitle>
        </DialogHeader>
        <Skeleton className="h-64 w-full" />
      </>
    );
  }

  if (preparation.error || !preparation.data) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Atender equipamento</DialogTitle>
        </DialogHeader>
        <MutationError error={preparation.error} />
      </>
    );
  }

  return (
    <Attendance
      key={`${planId}:${cycleId}:${assetId}`}
      planId={planId}
      cycleId={cycleId}
      assetId={assetId}
      preparation={preparation.data}
      onOpenChange={onOpenChange}
    />
  );
}

function Attendance({
  planId,
  cycleId,
  assetId,
  preparation,
  onOpenChange,
}: {
  planId: string;
  cycleId: string;
  assetId: string;
  preparation: PmocExecutionPreparation;
  onOpenChange: (open: boolean) => void;
}) {
  const { formatDate } = useDateFormatters();
  const { timeZone } = useTimeZone();
  const execution = preparation.existingExecution;

  const [draft, setDraft] = useState<AttendanceDraft>(() => ({
    ...emptyDraft(
      execution?.responsibleFieldTechnician.id ??
        preparation.fieldTechnicians[0]?.id ??
        null,
    ),
    auxiliaryTechnicianIds:
      execution?.auxiliaryTechnicians.map((person) => person.id) ?? [],
    notes: execution?.notes ?? "",
  }));
  /*
   * O passo de entrada vem do servidor; daqui em diante o avanço é local dentro
   * do mesmo atendimento. As mutações avançam após confirmação do servidor,
   * preservando os dados digitados e a navegação de revisão.
   */
  const [step, setStep] = useState<AttendanceStep>(() =>
    currentStep(preparation),
  );

  const start = useStartPmocExecution(planId, cycleId, assetId);
  const complete = useCompletePmocExecution(
    planId,
    cycleId,
    assetId,
    execution?.id ?? "",
  );
  const artifact = useGeneratePmocExecutionArtifact(
    planId,
    cycleId,
    assetId,
    execution?.id ?? "",
  );

  const patch = (changes: Partial<AttendanceDraft>) =>
    setDraft((atual) => ({ ...atual, ...changes }));

  const [uploading, setUploading] = useState(false);
  const issues = stepIssues(step, draft, preparation, timeZone);
  const pending =
    start.isPending || complete.isPending || artifact.isPending || uploading;
  const finished = isFinished(preparation);
  const previous =
    ATTENDANCE_STEPS.indexOf(step as (typeof ATTENDANCE_STEPS)[number]) - 1;
  const issueAndClose = async () => {
    await artifact.mutateAsync(undefined);
    notifySuccess(
      "Atendimento de PMOC finalizado",
      "O relatório de execução fica disponível no equipamento atendido.",
    );
    onOpenChange(false);
  };
  const confirm = async () => {
    try {
      await complete.mutateAsync(completePayload(draft, timeZone));
      setStep("emitir");
      await issueAndClose();
    } catch {
      /* Os hooks preservam a mensagem e permitem repetir somente a etapa que falhou. */
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <Package className="size-4 text-muted-foreground" aria-hidden />
          {preparation.equipment.name}
          {execution ? (
            <Badge variant="outline" className="tabular-nums">
              Manutenção {execution.sequenceNumber}
            </Badge>
          ) : null}
        </DialogTitle>
        <DialogDescription>
          {preparation.plan.code} · {preparation.customer.name} · vencimento{" "}
          {formatDate(preparation.cycle.dueOn)}
        </DialogDescription>
      </DialogHeader>

      <Progress current={step} />

      <div className="space-y-4 py-2">
        {step === "escalar" ? (
          <AssignStep
            draft={draft}
            preparation={preparation}
            onChange={patch}
            readOnly={Boolean(execution)}
          />
        ) : step === "roteiro" ? (
          <ProcedureStep
            draft={draft}
            preparation={preparation}
            onChange={patch}
            evidence={
              <AttendanceEvidence
                preparation={preparation}
                planId={planId}
                cycleId={cycleId}
                assetId={assetId}
                onBusy={setUploading}
              />
            }
          />
        ) : step === "concluir" ? (
          <CompleteStep draft={draft} onChange={patch} />
        ) : step === "resumo" ? (
          <SummaryStep draft={draft} preparation={preparation} />
        ) : (
          <>
            <IssueStep preparation={preparation} finished={finished} />
            <AttendanceReport
              artifactId={execution?.artifactExecution?.id ?? null}
            />
          </>
        )}
      </div>

      {issues.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-border px-3 py-2">
          {issues.map((issue) => (
            <li key={issue} className="text-xs text-muted-foreground">
              {issue}
            </li>
          ))}
        </ul>
      ) : null}

      <MutationError error={start.error ?? complete.error ?? artifact.error} />

      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          type="button"
          variant="ghost"
          disabled={previous < 0 || step === "emitir" || pending}
          onClick={() => setStep(ATTENDANCE_STEPS[previous])}
        >
          <ArrowLeft className="size-4" />
          Voltar
        </Button>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Fechar
          </Button>

          {step === "escalar" ? (
            <Button
              type="button"
              disabled={issues.length > 0 || pending}
              onClick={() =>
                execution
                  ? setStep("roteiro")
                  : start.mutate(startPayload(draft), {
                      onSuccess: () => setStep("roteiro"),
                    })
              }
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              {execution ? "Continuar" : "Abrir atendimento"}
            </Button>
          ) : step === "roteiro" ? (
            <Button
              type="button"
              disabled={issues.length > 0 || pending}
              onClick={() => setStep("concluir")}
            >
              Continuar
              <ArrowRight className="size-4" />
            </Button>
          ) : step === "concluir" ? (
            <Button
              type="button"
              disabled={issues.length > 0 || pending}
              onClick={() => setStep("resumo")}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Revisar atendimento
            </Button>
          ) : step === "resumo" ? (
            <Button
              type="button"
              disabled={
                issues.length > 0 ||
                pending ||
                !preparation.allowedActions.includes("COMPLETE")
              }
              onClick={() => void confirm()}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Confirmar e gerar relatório
            </Button>
          ) : finished || execution?.status !== "COMPLETED" ? null : (
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                void issueAndClose().catch(() => {
                  // The mutation error stays visible for a new attempt.
                })
              }
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileText className="size-4" />
              )}
              Emitir relatório
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function Progress({ current }: { current: AttendanceStep }) {
  const atual =
    current === "emitir"
      ? ATTENDANCE_STEPS.length
      : ATTENDANCE_STEPS.indexOf(current);

  return (
    <ol className="flex flex-wrap gap-1.5">
      {ATTENDANCE_STEPS.map((step, indice) => (
        <li key={step}>
          <span
            className={cn(
              "rounded-full px-3 py-1 text-xs",
              indice === atual && "bg-primary text-primary-foreground",
              indice < atual && "bg-surface-strong text-foreground",
              indice > atual && "text-muted-foreground",
            )}
          >
            {indice + 1}. {STEP_TITLES[step]}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Quem atende.
 *
 * Só técnicos elegíveis para a unidade — a lista vem do servidor, que já aplicou
 * essa regra. A partir de abrir, **só o escalado ou o dono** concluem.
 */
function AssignStep({
  draft,
  preparation,
  onChange,
  readOnly,
}: {
  readOnly: boolean;
  draft: AttendanceDraft;
  preparation: PmocExecutionPreparation;
  onChange: (patch: Partial<AttendanceDraft>) => void;
}) {
  const bloqueios = preparation.eligibility.blockedReasons;

  return (
    <div className="space-y-4">
      {bloqueios.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          {bloqueios.map((reason) => (
            <li key={reason} className="text-xs text-amber-400">
              {executionBlockedLabel(reason, knownBlockedReason)}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="attendance-technician">Técnico em campo</Label>
        <Select
          disabled={readOnly}
          value={draft.responsibleFieldTechnicianId ?? undefined}
          onValueChange={(value) =>
            onChange({ responsibleFieldTechnicianId: value })
          }
        >
          <SelectTrigger id="attendance-technician">
            <SelectValue placeholder="Escolher técnico" />
          </SelectTrigger>
          <SelectContent>
            {preparation.fieldTechnicians.map((pessoa) => (
              <SelectItem key={pessoa.id} value={pessoa.id}>
                {pessoa.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          É quem responde por esta manutenção, e o nome que o relatório carrega.
          Depois de abrir, só ele — ou o dono da organização — pode registrar a
          conclusão.
        </p>
      </div>

      {readOnly ? (
        <p className="text-xs text-muted-foreground">
          A equipe foi registrada na abertura deste atendimento.
        </p>
      ) : null}
      {preparation.auxiliaryTechnicians.length > 0 ? (
        <div className="space-y-2">
          <Label>Auxiliares</Label>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {preparation.auxiliaryTechnicians
              .filter(
                (pessoa) => pessoa.id !== draft.responsibleFieldTechnicianId,
              )
              .map((pessoa) => {
                const marcado = draft.auxiliaryTechnicianIds.includes(
                  pessoa.id,
                );
                return (
                  <label
                    key={pessoa.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <Checkbox
                      disabled={readOnly}
                      checked={marcado}
                      onCheckedChange={() =>
                        onChange({
                          auxiliaryTechnicianIds: marcado
                            ? draft.auxiliaryTechnicianIds.filter(
                                (id) => id !== pessoa.id,
                              )
                            : [...draft.auxiliaryTechnicianIds, pessoa.id],
                        })
                      }
                    />
                    {pessoa.name}
                  </label>
                );
              })}
          </div>
          <p className="text-xs text-muted-foreground">
            Acompanham o atendimento e aparecem no relatório. Não assinam.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * O roteiro do plano.
 *
 * Lido pelo servidor a partir de `procedure` — JSON livre com duas formas em
 * produção. É o mesmo texto que o PDF imprime, então o que se confere aqui é o
 * que o documento vai afirmar.
 */
function ProcedureStep({
  draft,
  preparation,
  onChange,
  evidence,
}: {
  evidence: React.ReactNode;
  draft: AttendanceDraft;
  preparation: PmocExecutionPreparation;
  onChange: (patch: Partial<AttendanceDraft>) => void;
}) {
  /*
   * Acesso tolerante, como todo este payload.
   *
   * A preparação não tem Read Model publicado — o tipo em `types/pmoc.ts`
   * reproduz a resposta à mão, e a própria documentação dele avisa que uma
   * mudança no serviço não quebra a compilação, quebra em runtime. Um servidor
   * anterior a `procedureGroups` faria `grupos.length` estourar e derrubar o
   * diálogo inteiro.
   */
  const grupos = preparation.procedureGroups ?? [];

  return (
    <div className="space-y-4">
      {grupos.length === 0 ? (
        <p className="rounded-lg border border-border px-3 py-4 text-sm text-muted-foreground">
          Este plano não declara roteiro. O relatório sai com o que for
          registrado nas observações.
        </p>
      ) : (
        <div className="space-y-3">
          {grupos.map((grupo) => (
            <section key={grupo.group} className="space-y-1.5">
              <h4 className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase">
                <ClipboardCheck className="size-3.5" aria-hidden />
                {grupo.group}
              </h4>
              <ul className="space-y-1 pl-5">
                {grupo.items.map((item) => (
                  <li key={item} className="list-disc text-sm">
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/*
        A confirmação é da pessoa, não do servidor.

        O domínio não guarda item-a-item do roteiro nesta rota — marcar cada linha
        aqui gravaria em algum lugar que não existe. O que se afirma é que o
        roteiro foi percorrido, e é isso que o texto diz.
      */}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3">
        <Checkbox
          checked={draft.reviewedProcedure}
          onCheckedChange={(checked) =>
            onChange({ reviewedProcedure: checked === true })
          }
        />
        <span className="text-sm">Roteiro conferido</span>
      </label>
      {evidence}
    </div>
  );
}

/** Quando a manutenção aconteceu, e o que houve de diferente. */
function CompleteStep({
  draft,
  onChange,
}: {
  draft: AttendanceDraft;
  onChange: (patch: Partial<AttendanceDraft>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="attendance-performed-at">Data e hora</Label>
        <Input
          id="attendance-performed-at"
          type="datetime-local"
          value={draft.performedAt}
          onChange={(event) => onChange({ performedAt: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Em branco, vale <strong>agora</strong>, pelo relógio do servidor — a
          hora da manutenção é registro legal, e o relógio do navegador pode
          estar errado.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="attendance-notes">Observações</Label>
        <Textarea
          id="attendance-notes"
          value={draft.notes}
          rows={4}
          maxLength={1000}
          placeholder="O que foi encontrado, o que foi trocado, o que precisa de retorno."
          onChange={(event) => onChange({ notes: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Sai no relatório deste equipamento.
        </p>
      </div>
    </div>
  );
}

/** O relatório, e o que ele significa. */
function IssueStep({
  preparation,
  finished,
}: {
  preparation: PmocExecutionPreparation;
  finished: boolean;
}) {
  const execution = preparation.existingExecution;
  const documento = execution?.artifactExecution ?? null;

  if (!execution) {
    return (
      <p className="rounded-lg border border-border px-3 py-4 text-sm text-muted-foreground">
        Nada foi aberto para este equipamento neste ciclo, e o servidor não
        liberou a abertura agora.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Manutenção</dt>
          <dd className="mt-1 text-sm tabular-nums">
            {execution.sequenceNumber}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Técnico em campo</dt>
          <dd className="mt-1 text-sm">
            {execution.responsibleFieldTechnician.displayName}
          </dd>
        </div>
      </dl>

      {finished && documento ? (
        <div className="space-y-2 rounded-lg border border-border px-3 py-3">
          <p className="text-sm">
            Relatório emitido —{" "}
            <span className="font-mono text-xs">{documento.code}</span>
          </p>
          <Button asChild size="sm" variant="outline">
            <a href={`/execucoes/${documento.id}`}>Abrir o documento</a>
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {execution.status === "COMPLETED"
            ? "Manutenção registrada. O relatório está sendo preparado ou pode ser emitido novamente abaixo."
            : "Este atendimento ainda está em andamento. A conclusão é feita pelo técnico atribuído ou pelo proprietário."}
        </p>
      )}
    </div>
  );
}

function SummaryStep({
  draft,
  preparation,
}: {
  draft: AttendanceDraft;
  preparation: PmocExecutionPreparation;
}) {
  const { timeZone } = useTimeZone();
  const { formatDateTime } = useDateFormatters();
  const execution = preparation.existingExecution;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Confira os dados antes de concluir a manutenção e solicitar o relatório
        de execução.
      </p>
      <dl className="grid gap-4 rounded-xl border p-4 sm:grid-cols-2">
        {[
          ["Plano", `${preparation.plan.code} · ${preparation.plan.name}`],
          ["Cliente", preparation.customer.name],
          ["Equipamento", preparation.equipment.name],
          [
            "Técnico operacional",
            execution?.responsibleFieldTechnician.displayName ?? "—",
          ],
          [
            "Auxiliares",
            execution?.auxiliaryTechnicians
              .map((person) => person.displayName)
              .join(", ") || "Nenhum",
          ],
          [
            "Data e hora",
            draft.performedAt
              ? formatDateTime(completePayload(draft, timeZone).performedAt!)
              : "No momento da confirmação",
          ],
          ["Roteiro", draft.reviewedProcedure ? "Conferido" : "Não confirmado"],
          [
            "Responsável técnico",
            preparation.technicalResponsible?.displayName ?? "—",
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-words text-sm">{value}</dd>
          </div>
        ))}
      </dl>
      <section className="space-y-2">
        <h4 className="text-sm font-medium">Observações</h4>
        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {draft.notes.trim() || "Nenhuma observação registrada."}
        </p>
      </section>
      <section className="space-y-2">
        <h4 className="text-sm font-medium">
          Evidências ({execution?.evidence.length ?? 0})
        </h4>
        {execution?.evidence.length ? (
          <ul className="space-y-1 text-sm">
            {execution.evidence.map((item) => (
              <li key={item.id} className="break-words">
                {item.file.fileName}
                {item.caption ? ` — ${item.caption}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhuma imagem anexada.
          </p>
        )}
      </section>
      {(preparation.procedureGroups ?? []).map((group) => (
        <section key={group.group}>
          <h4 className="text-sm font-medium">{group.group}</h4>
          <ul className="list-inside list-disc text-sm text-muted-foreground">
            {group.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
