/**
 * Navigation Core — de onde vem cada destino da aplicação.
 *
 * A regra é uma: **nenhuma rota é montada à mão.** Caminho de listagem vem do
 * Entity Registry (`basePath`), caminho de registro vem de `entityHref`, e
 * áreas que não são de entidade vêm de `ROUTES`. Uma string `"/ativos/"` num
 * componente é um erro esperando a renomeação da rota.
 *
 * Este módulo é a camada que faltava entre os registries e as superfícies de
 * navegação — menu lateral, trilha do topo e paleta de comandos. Antes, cada
 * uma montava a sua lista: o menu derivava do Entity Registry, a trilha era
 * escrita à mão em cada página, e a paleta tinha itens fixos que não levavam a
 * lugar nenhum.
 */
import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";

import { allEntities, resolveEntity, type EntityId } from "@/entities";
import { ROUTES } from "@/lib/routes";

export type NavigationIcon = ComponentType<LucideProps>;

/** Um destino navegável, venha ele de onde vier. */
export interface NavigationTarget {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly icon: NavigationIcon;
  readonly href: string;
  /** Capability exigida — a superfície não oferece o que seria recusado. */
  readonly capability?: string;
  /** Permission required by the authoritative backend route. */
  readonly permission?: string;
  /** Entidade dona, quando o destino é a listagem de uma. */
  readonly entity?: EntityId;
}

/**
 * As listagens de entidade, do Entity Registry.
 *
 * Rótulo, ícone, rota e capability saem todos de lá — é a mesma fonte que o
 * menu lateral usa, e por isso os dois não podem divergir.
 */
export function entityTargets(): readonly NavigationTarget[] {
  return allEntities().map((entity) => ({
    id: entity.id,
    label: entity.labelPlural,
    description: entity.description,
    icon: entity.icon,
    href: entity.basePath,
    capability: entity.capability.read,
    permission: entity.permissions.read,
    entity: entity.id,
  }));
}

/**
 * Um degrau da trilha.
 *
 * `href` ausente marca o degrau atual — a página onde se está não é um link
 * para si mesma.
 */
export interface Crumb {
  readonly label: string;
  readonly href?: string;
}

/**
 * Trilha de uma tela de entidade.
 *
 * ```ts
 * entityCrumbs("asset");                 // Ativos
 * entityCrumbs("asset", "Compressor 3"); // Ativos › Compressor 3
 * ```
 *
 * O rótulo do primeiro degrau **nunca** é escrito na página: sai do registry,
 * junto com a rota. Renomear "Ativos" para "Equipamentos" chega à trilha, ao
 * menu e ao título pelo mesmo caminho.
 */
export function entityCrumbs(entity: EntityId, current?: string): Crumb[] {
  const definition = resolveEntity(entity);
  const root: Crumb = current
    ? { label: definition.labelPlural, href: definition.basePath }
    : { label: definition.labelPlural };

  return current ? [root, { label: current }] : [root];
}

/** Trilha de uma área que não é de entidade (Organização, Notificações…). */
export function crumbs(...labels: readonly string[]): Crumb[] {
  return labels.map((label) => ({ label }));
}

/**
 * Destino inicial de quem acabou de entrar.
 *
 * Delega a `ROUTES`, que já responde por tipo de conta — a decisão é uma só,
 * compartilhada com o middleware.
 */
export { homeRouteFor } from "@/lib/routes";
export { ROUTES };
