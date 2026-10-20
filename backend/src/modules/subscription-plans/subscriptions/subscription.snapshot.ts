/**
 * O retrato dos direitos, tirado no momento da contratação.
 *
 * É deliberadamente o **mesmo formato** que o perfil declarado na linha do
 * plano já usa (`{ capabilities, allocation, usage }`), porque assim existe um
 * único caminho de leitura e uma única validação: o retrato de uma assinatura
 * e o perfil de um plano de teste passam pelo mesmo verificador fecha-falha.
 *
 * `null` é ilimitado — e só aqui, onde a semântica está escrita e validada.
 */
import {
  AllocationResource,
  UsageResource,
  type PlanDefinition,
  type PlanLimit,
} from '../catalog/plan-catalog.types';

export interface EntitlementsSnapshot {
  readonly capabilities: readonly string[];
  readonly allocation: Readonly<Record<string, number | null>>;
  readonly usage: Readonly<Record<string, number | null>>;
}

export function snapshotOf(plan: PlanDefinition): EntitlementsSnapshot {
  return {
    capabilities: [...plan.capabilities],
    allocation: numeros(AllocationResource, plan.allocation),
    usage: numeros(UsageResource, plan.usage),
  };
}

function numeros<T extends string>(
  recursos: Record<string, T>,
  limites: Readonly<Record<T, PlanLimit>>,
): Record<string, number | null> {
  return Object.values(recursos).reduce<Record<string, number | null>>(
    (mapa, recurso) => {
      const limite = limites[recurso];
      mapa[recurso] = limite.kind === 'UNLIMITED' ? null : limite.value;
      return mapa;
    },
    {},
  );
}
