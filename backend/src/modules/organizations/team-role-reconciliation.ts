/**
 * O que falta em um papel de sistema já gravado, comparado ao catálogo.
 *
 * ## O defeito que isto corrige
 *
 * Papéis de sistema são **copiados** para cada organização no momento em que ela
 * nasce (`organization.repository`, `role.createMany`). A partir daí, nada os
 * acompanhava: acrescentar uma permissão ao catálogo valia só para organizações
 * criadas depois.
 *
 * Foi assim que `pmoc.execute` — que deu ao técnico de campo o direito de atender
 * o PMOC atribuído a ele, em 29/09 — nunca chegou ao técnico de nenhuma
 * organização anterior. O técnico abria o atendimento, e no fim era recusado:
 * a evidência do PMOC exige `pmoc.manage` ou `pmoc.execute`, e a fila deixava de
 * publicar o "concluir".
 *
 * ## Por que é seguro acompanhar o catálogo
 *
 * Papel de sistema **não é editável** pela organização (`updateRole` recusa
 * `isSystem`). Então a única fonte de diferença entre o gravado e o catálogo é o
 * próprio catálogo ter mudado — e quem decide o catálogo é a plataforma.
 *
 * ## Por que só acrescenta
 *
 * Retirar uma permissão num deploy revoga acesso de quem está trabalhando
 * naquele instante, e uma permissão renomeada no catálogo apareceria aqui como
 * "sobra". O que falta é acrescentado; o que sobra é **relatado**, para alguém
 * decidir. Revogar acesso não é efeito colateral de subir uma versão.
 */
export interface CatalogueRole {
  readonly key: string;
  readonly permissions: readonly string[];
  readonly allowedSurfaces: readonly string[];
}

export interface PersistedRole {
  readonly key: string;
  readonly permissions: readonly string[];
  readonly allowedSurfaces: readonly string[];
}

export interface RoleReconciliation {
  /** O conjunto a gravar, ou `null` quando nada falta. */
  readonly permissions: string[] | null;
  readonly allowedSurfaces: string[] | null;
  /** O que o catálogo não tem mais. Relatado, nunca retirado. */
  readonly extraPermissions: string[];
}

export function reconcileRole(
  catalogue: CatalogueRole,
  persisted: PersistedRole,
): RoleReconciliation {
  const faltantes = catalogue.permissions.filter(
    (permission) => !persisted.permissions.includes(permission),
  );
  const superficiesFaltantes = catalogue.allowedSurfaces.filter(
    (surface) => !persisted.allowedSurfaces.includes(surface),
  );

  return {
    /* A ordem do gravado é preservada e o que falta vai ao fim: reescrever a
       lista inteira na ordem do catálogo produziria um diff em toda linha. */
    permissions: faltantes.length
      ? [...persisted.permissions, ...faltantes]
      : null,
    allowedSurfaces: superficiesFaltantes.length
      ? [...persisted.allowedSurfaces, ...superficiesFaltantes]
      : null,
    extraPermissions: persisted.permissions.filter(
      (permission) => !catalogue.permissions.includes(permission),
    ),
  };
}
