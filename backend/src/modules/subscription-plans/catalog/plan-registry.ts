/**
 * O catálogo, validado na carga.
 *
 * Um catálogo mal configurado não pode liberar recurso: a falha tem de
 * aparecer ao subir o processo, não em produção na forma de um teto que
 * ninguém aplicou. Por isso a validação roda uma vez, na importação, e
 * derruba a inicialização quando encontra problema.
 */
import {
  AllocationResource,
  BillingInterval,
  PlanCapability,
  PlanCode,
  UsageResource,
  type PlanCode as PlanCodeType,
  type PlanDefinition,
  type PlanLimit,
  type PlanResource,
} from './plan-catalog.types';
import { PLAN_CATALOG } from './plan-catalog';

export class PlanCatalogError extends Error {}

function validar(catalogo: readonly PlanDefinition[]): void {
  const codigos = new Set<string>();
  const esperadosAlocacao = Object.values(AllocationResource);
  const esperadosUso = Object.values(UsageResource);
  const capacidadesConhecidas = new Set<string>(Object.values(PlanCapability));

  for (const plano of catalogo) {
    if (codigos.has(plano.code)) {
      throw new PlanCatalogError(`Plano duplicado no catálogo: ${plano.code}`);
    }
    codigos.add(plano.code);

    const vistas = new Set<string>();
    for (const capacidade of plano.capabilities) {
      if (!capacidadesConhecidas.has(capacidade)) {
        throw new PlanCatalogError(
          `Capacidade desconhecida em ${plano.code}: ${capacidade}`,
        );
      }
      if (vistas.has(capacidade)) {
        throw new PlanCatalogError(
          `Capacidade repetida em ${plano.code}: ${capacidade}`,
        );
      }
      vistas.add(capacidade);
    }

    // Todo recurso precisa de limite declarado. Ausência não vira ilimitado.
    for (const recurso of esperadosAlocacao) {
      if (!plano.allocation[recurso]) {
        throw new PlanCatalogError(
          `Limite de alocação ausente em ${plano.code}: ${recurso}`,
        );
      }
    }
    for (const recurso of esperadosUso) {
      if (!plano.usage[recurso]) {
        throw new PlanCatalogError(
          `Limite de uso ausente em ${plano.code}: ${recurso}`,
        );
      }
    }

    for (const [recurso, limite] of [
      ...Object.entries(plano.allocation),
      ...Object.entries(plano.usage),
    ]) {
      validarLimite(plano.code, recurso, limite);
    }

    // Toda periodicidade precisa de preço. Plano sem preço não é vendável, e
    // descobrir isso no checkout seria tarde demais.
    for (const intervalo of Object.values(BillingInterval)) {
      const preco = plano.prices[intervalo];
      if (!preco) {
        throw new PlanCatalogError(
          `Preço ausente em ${plano.code}: ${intervalo}`,
        );
      }
      if (!Number.isInteger(preco.amountMinor) || preco.amountMinor < 0) {
        throw new PlanCatalogError(
          `Preço inválido em ${plano.code}.${intervalo}: ${String(preco.amountMinor)}`,
        );
      }
    }
  }

  const faltando = Object.values(PlanCode).filter(
    (codigo) => !codigos.has(codigo),
  );
  if (faltando.length) {
    throw new PlanCatalogError(
      `Planos declarados sem definição: ${faltando.join(', ')}`,
    );
  }
}

function validarLimite(
  plano: string,
  recurso: string,
  limite: PlanLimit,
): void {
  if (limite.kind === 'UNLIMITED') {
    // Ilimitado não carrega número: um valor ao lado seria lido algum dia.
    if ('value' in limite) {
      throw new PlanCatalogError(
        `Limite ilimitado com valor em ${plano}.${recurso}`,
      );
    }
    return;
  }
  if (!Number.isInteger(limite.value) || limite.value < 0) {
    throw new PlanCatalogError(
      `Limite inválido em ${plano}.${recurso}: ${String(limite.value)}`,
    );
  }
}

validar(PLAN_CATALOG);

const POR_CODIGO = new Map<PlanCodeType, PlanDefinition>(
  PLAN_CATALOG.map((plano) => [plano.code, plano]),
);

/** O plano, ou uma falha — nunca um catálogo vazio silencioso. */
export function planDefinition(code: string): PlanDefinition {
  const plano = POR_CODIGO.get(code);
  if (!plano) throw new PlanCatalogError(`Plano desconhecido: ${code}`);
  return plano;
}

export function isKnownPlan(code: string): boolean {
  return POR_CODIGO.has(code);
}

/**
 * O limite de um recurso num plano.
 *
 * Recurso desconhecido **falha**, e não vira ilimitado: um erro de digitação
 * num nome de recurso jamais deve abrir o portão.
 */
export function planLimit(
  plano: PlanDefinition,
  recurso: PlanResource,
): PlanLimit {
  const limite =
    (plano.allocation as Record<string, PlanLimit | undefined>)[recurso] ??
    (plano.usage as Record<string, PlanLimit | undefined>)[recurso];
  if (!limite) {
    throw new PlanCatalogError(
      `Recurso sem limite declarado em ${plano.code}: ${recurso}`,
    );
  }
  return limite;
}

export { PLAN_CATALOG };
