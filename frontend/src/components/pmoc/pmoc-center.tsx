"use client";

/**
 * O centro de PMOC: a lista e a criação de configurações.
 *
 * O wizard reúne cliente, equipamentos, programação e Responsável Técnico
 * antes de criar e ativar o plano. Configurações existentes são corrigidas
 * no diálogo de edição disponível na listagem e no detalhe.
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
