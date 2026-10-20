"use client";

/**
 * O centro de PMOC: a lista e a criação de configurações.
 *
 * A criação é um diálogo, não um assistente. Os campos obrigatórios do
 * contrato cabem numa tela — cliente, unidade, código, nome, vigência e
 * periodicidade —; cobertura e Responsável Técnico entram depois, no detalhe,
 * porque exigem escolher entre listas que o plano ainda não tem contexto para
 * filtrar. Um assistente de quatro passos para isso adiaria a criação sem
 * reduzir o trabalho.
 */
import { useState } from "react";

import { PmocList } from "./pmoc-list";
import { PmocPlanWizard } from "./pmoc-plan-wizard";

export function PmocCenter() {
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PmocList onCreate={() => setCreating(true)} />
      <PmocPlanWizard open={creating} onOpenChange={setCreating} />
    </>
  );
}
