"use client";

/**
 * Cadastro e edição de um tipo de manutenção de RVT.
 *
 * ## A chave não se edita
 *
 * `key` é o identificador estável do tipo dentro da organização — é por ele que
 * a migração casou os contratos antigos, e `UpdateRvtMaintenanceTypeDto` o
 * marca como ausente. Renomear é para o rótulo, que é o que as pessoas leem.
 * Na criação a chave sai do rótulo, porque ninguém deveria ter que inventar
 * uma.
 *
 * ## Dia ou mês, e a escolha é explícita
 *
 * Dois campos exclusivos viram um seletor de unidade mais um número. Deixar os
 * dois abertos convidaria a preencher ambos, que é exatamente o que o servidor
 * recusa.
 */
import { useState } from "react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { useChecklistTemplates } from "@/hooks/operations/use-operations";
import {
  useCreateRvtMaintenanceType,
  useUpdateRvtMaintenanceType,
} from "@/hooks/rvt/use-rvt";
import type { RvtMaintenanceType } from "@/types/rvt";

/** Sem roteiro é uma escolha válida, e `Select` não aceita valor vazio. */
const SEM_ROTEIRO = "__nenhum__";

export function RvtMaintenanceTypeFormDialog({
  tipo,
  open,
  onOpenChange,
}: {
  tipo: RvtMaintenanceType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {/** Remontado a cada abertura: o formulário parte sempre do salvo. */}
        {open ? (
          <Form
            key={tipo?.id ?? "new"}
            tipo={tipo}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A chave a partir do rótulo.
 *
 * Maiúsculas sem acento, porque é o formato dos tipos que a organização já
 * recebe no cadastro inicial (`MONTHLY`, `QUARTERLY`) e misturar convenções num
 * mesmo `@@unique` só produz duplicata disfarçada.
 */
function chaveDe(rotulo: string): string {
  return rotulo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function Form({
  tipo,
  onDone,
}: {
  tipo: RvtMaintenanceType | null;
  onDone: () => void;
}) {
  const criar = useCreateRvtMaintenanceType();
  const atualizar = useUpdateRvtMaintenanceType(tipo?.id ?? "");
  const roteiros = useChecklistTemplates();

  const [label, setLabel] = useState(tipo?.label ?? "");
  const [unidade, setUnidade] = useState<"dias" | "meses">(
    tipo?.intervalDays ? "dias" : "meses",
  );
  const [intervalo, setIntervalo] = useState(
    String(tipo?.intervalDays ?? tipo?.intervalMonths ?? ""),
  );
  const [roteiro, setRoteiro] = useState(tipo?.checklist?.id ?? SEM_ROTEIRO);

  const numero = Number(intervalo);
  const limite = unidade === "dias" ? 366 : 60;
  const cadenciaValida =
    Number.isInteger(numero) && numero >= 1 && numero <= limite;

  const chave = tipo?.key ?? chaveDe(label);
  const ready = label.trim().length >= 2 && chave.length >= 2 && cadenciaValida;

  const pendente = criar.isPending || atualizar.isPending;

  const submit = () => {
    if (!ready) return;
    if (tipo) {
      /*
        A cadência vai inteira, com a unidade descartada explicitamente nula —
        mandar só a nova deixaria as duas preenchidas no servidor. O mesmo para
        o roteiro: "sem roteiro" é `null`, e não ausência.
      */
      atualizar.mutate(
        {
          label: label.trim(),
          intervalDays: unidade === "dias" ? numero : null,
          intervalMonths: unidade === "meses" ? numero : null,
          checklistTemplateId: roteiro === SEM_ROTEIRO ? null : roteiro,
        },
        { onSuccess: onDone },
      );
      return;
    }
    criar.mutate(
      {
        key: chave,
        label: label.trim(),
        ...(unidade === "dias"
          ? { intervalDays: numero }
          : { intervalMonths: numero }),
        ...(roteiro === SEM_ROTEIRO ? {} : { checklistTemplateId: roteiro }),
      },
      { onSuccess: onDone },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {tipo ? "Editar tipo de manutenção" : "Novo tipo de manutenção"}
        </DialogTitle>
        <DialogDescription>
          A cadência define quando as visitas do contrato caem. O roteiro é o
          que o técnico preenche em cada uma.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="rvt-tipo-label">Nome</Label>
          <Input
            id="rvt-tipo-label"
            value={label}
            maxLength={120}
            placeholder="Trimestral"
            onChange={(event) => setLabel(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {tipo
              ? `Chave: ${chave} — não muda, é o que liga os contratos já criados.`
              : chave
                ? `Chave: ${chave}`
                : "A chave é gerada a partir do nome."}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="rvt-tipo-intervalo">Repetir a cada</Label>
            <Input
              id="rvt-tipo-intervalo"
              type="number"
              min={1}
              max={limite}
              value={intervalo}
              onChange={(event) => setIntervalo(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rvt-tipo-unidade">Unidade</Label>
            <Select
              value={unidade}
              onValueChange={(valor) => setUnidade(valor as "dias" | "meses")}
            >
              <SelectTrigger id="rvt-tipo-unidade">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="meses">Meses</SelectItem>
                <SelectItem value="dias">Dias</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/*
          Meses seguem o calendário; dias, a contagem. Um contrato que começa em
          31/01 com cadência mensal cai em 28/02 e volta para 31/03 — e quem
          cadastra precisa saber qual das duas está escolhendo.
        */}
        <p className="text-xs text-muted-foreground">
          {unidade === "meses"
            ? "Meses seguem o calendário: começando em 31/01, as visitas caem em 28/02, 31/03 e assim por diante."
            : "Dias são contados corridos a partir da data de início da vigência."}
        </p>

        <div className="space-y-2">
          <Label htmlFor="rvt-tipo-roteiro">Roteiro da visita</Label>
          <Select value={roteiro} onValueChange={setRoteiro}>
            <SelectTrigger id="rvt-tipo-roteiro">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SEM_ROTEIRO}>Sem roteiro</SelectItem>
              {(roteiros.data?.data ?? []).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {`${item.name} · ${item.items.length} ${
                    item.items.length === 1 ? "item" : "itens"
                  }`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Cadastre os roteiros na aba Atendimentos. Trocar o roteiro vale para
            as visitas seguintes — as já executadas guardam o que preencheram.
          </p>
        </div>
      </div>

      <MutationError error={criar.error ?? atualizar.error} />

      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={pendente}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={!ready || pendente}>
          {tipo ? "Salvar" : "Cadastrar"}
        </Button>
      </DialogFooter>
    </>
  );
}
