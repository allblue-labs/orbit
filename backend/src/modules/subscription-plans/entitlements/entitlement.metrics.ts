/**
 * Contadores de decisão de plano, com cardinalidade fechada.
 *
 * As etiquetas são capacidade, recurso e desfecho — todas de um conjunto
 * finito e conhecido em tempo de compilação. `organizationId` **não** é
 * etiqueta (§138): uma série por inquilino cresce sem teto e transforma
 * observabilidade em problema de armazenamento.
 *
 * Não há exportador aqui de propósito: o Orbit ainda não tem um, e trazer um
 * cliente de métricas nesta PR seria decidir por outra. O registro é lido em
 * processo, e ganha exportador quando houver um para todo o backend.
 */
import { Injectable } from '@nestjs/common';
import type {
  PlanCapability,
  PlanResource,
} from '../catalog/plan-catalog.types';

export type EntitlementOutcome = 'ALLOWED' | 'DENIED';

export interface EntitlementMetricsSnapshot {
  readonly capabilityChecks: Readonly<Record<string, number>>;
  readonly limitChecks: Readonly<Record<string, number>>;
  readonly usageConsumed: Readonly<Record<string, number>>;
}

@Injectable()
export class EntitlementMetrics {
  private readonly capabilityChecks = new Map<string, number>();
  private readonly limitChecks = new Map<string, number>();
  private readonly usageConsumed = new Map<string, number>();

  capability(capability: PlanCapability, outcome: EntitlementOutcome): void {
    increment(this.capabilityChecks, `${capability}:${outcome}`, 1);
  }

  limit(resource: PlanResource, outcome: EntitlementOutcome): void {
    increment(this.limitChecks, `${resource}:${outcome}`, 1);
  }

  consumed(resource: PlanResource, quantity: number): void {
    increment(this.usageConsumed, resource, quantity);
  }

  snapshot(): EntitlementMetricsSnapshot {
    return {
      capabilityChecks: Object.fromEntries(this.capabilityChecks),
      limitChecks: Object.fromEntries(this.limitChecks),
      usageConsumed: Object.fromEntries(this.usageConsumed),
    };
  }
}

function increment(store: Map<string, number>, key: string, by: number): void {
  store.set(key, (store.get(key) ?? 0) + by);
}
