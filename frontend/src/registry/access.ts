/**
 * Exigências de acesso declaradas pelos registries.
 *
 * Três registries chegaram à mesma função com três nomes — `isTemplateActionEnabled`,
 * `isDocumentActionEnabled` e o `allows` interno de `useEntityAccess`. Todas
 * fazem exatamente o mesmo: a ação existe? o papel tem a permissão? o plano
 * tem a capability?
 *
 * ## Isto não é autorização
 *
 * Quem autoriza é o backend, e ele recusa com 403 independentemente do que
 * aconteça aqui. O que estas funções evitam é **oferecer um botão que já se
 * sabe que seria recusado** — o registry declara o que o servidor exige, e a
 * sessão responde se vale mostrar.
 *
 * A consequência: exigência não declarada libera. Uma ação sem `permission` e
 * sem `capability` é sempre oferecida, e o servidor continua no comando.
 */

/** O que um registro exige da sessão para ser oferecido. */
export interface AccessRequirement {
  /** Permissão exigida pelo backend (`@Permissions`). */
  readonly permission?: string;
  /** Capability exigida pelo plano (`@Capabilities`). */
  readonly capability?: string;
  /** Canonical purchased product entitlement (not a route capability). */
  readonly productCapability?: string;
  /** Server-published implementation availability. */
  readonly feature?: string;
  /**
   * `false` quando o contrato não existe.
   *
   * Diferente de "não autorizado": a plataforma inteira não tem o endpoint. A
   * interface declara a ausência em vez de esconder a ação.
   */
  readonly available?: boolean;
  readonly unavailableReason?: string;
}

/** A parte da sessão que decide visibilidade. */
export interface AccessContext {
  hasPermission: (permission: string) => boolean;
  hasCapability: (capability: string) => boolean;
  hasProductCapability?: (capability: string) => boolean;
  hasFeature?: (feature: string) => boolean;
}

/**
 * A sessão permite oferecer isto?
 *
 * `undefined` responde `false`: pedir por um id que não existe não deve
 * revelar um botão.
 */
export function allowsAccess(
  requirement: AccessRequirement | undefined,
  access: AccessContext,
): boolean {
  if (!requirement) return false;
  if (requirement.available === false) return false;
  if (requirement.permission && !access.hasPermission(requirement.permission)) {
    return false;
  }
  if (requirement.capability && !access.hasCapability(requirement.capability)) {
    return false;
  }
  if (
    requirement.productCapability &&
    !access.hasProductCapability?.(requirement.productCapability)
  )
    return false;
  if (requirement.feature && !access.hasFeature?.(requirement.feature))
    return false;
  return true;
}

/**
 * Por que isto não aparece — para dizer ao usuário em vez de sumir.
 *
 * `null` quando está liberado.
 */
export function accessBlockReason(
  requirement: AccessRequirement | undefined,
  access: AccessContext,
): string | null {
  if (!requirement) return "Ação desconhecida.";
  if (requirement.available === false) {
    return requirement.unavailableReason ?? "Recurso ainda não disponível.";
  }
  if (requirement.capability && !access.hasCapability(requirement.capability)) {
    return "O plano atual não inclui este recurso.";
  }
  if (
    requirement.productCapability &&
    !access.hasProductCapability?.(requirement.productCapability)
  )
    return "O produto contratado não inclui este recurso.";
  if (requirement.feature && !access.hasFeature?.(requirement.feature))
    return "Recurso ainda não disponível.";
  if (requirement.permission && !access.hasPermission(requirement.permission)) {
    return "Seu perfil não tem permissão para esta ação.";
  }
  return null;
}
