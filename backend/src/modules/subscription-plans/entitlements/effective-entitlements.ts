/**
 * O que a organização tem direito **agora**, qualquer que seja a origem.
 *
 * Hoje a origem é a linha de `plans` apontada pela organização. Amanhã, com a
 * PR-PL-02, será o snapshot da assinatura. Nada acima desta camada precisa
 * saber a diferença: o serviço recebe `organizationId` e devolve direitos —
 * jamais um `planId` (§24).
 *
 * ## Três origens, todas declaradas
 *
 * - `CATALOG` — a chave do plano é um dos quatro códigos congelados. Direitos
 *   vêm do catálogo em código, nunca do banco: o banco pode ter sido editado.
 * - `CUSTOM` — a linha declara um perfil completo em `limits.entitlements`. É
 *   como um plano de teste ganha limites pequenos sem tocar no catálogo de
 *   produção (§163, §165). Perfil incompleto **falha**; não vira ilimitado.
 * - `LEGACY_UNGOVERNED` — planos anteriores a esta PR (`STARTER`,
 *   `OWNER_FULL_ACCESS`, planos de teste). Eles nunca tiveram enforcement
 *   comercial, e passar a aplicar tetos retroativamente quebraria inquilinos
 *   existentes (§105). A decisão é **explícita e nomeada**, não um efeito
 *   colateral de uma busca que não achou nada — é essa diferença que mantém
 *   §128/§129 de pé: ausência continua sendo erro; legado é uma origem.
 */
import {
  AllocationResource,
  PlanCapability,
  UNLIMITED,
  UsageResource,
  limited,
  type PlanDefinition,
  type PlanLimit,
  type PlanResource,
} from '../catalog/plan-catalog.types';
import { PlanConfigurationInvalidException } from './entitlement.errors';

export type EntitlementSource =
  'SUBSCRIPTION' | 'CATALOG' | 'CUSTOM' | 'LEGACY_UNGOVERNED';

export interface EffectiveEntitlements {
  readonly source: EntitlementSource;
  /**
   * A assinatura autoriza uso do produto agora?
   *
   * Suspensa, cancelada ou vencida continua tendo plano e limites — o que ela
   * não tem é acesso. Separar as duas coisas evita responder "seu plano não
   * inclui este recurso" a quem só precisa regularizar a assinatura.
   */
  readonly accessGranted: boolean;
  /** `Plan.key`. Serve para log e leitura — nenhuma regra decide por ele. */
  readonly planCode: string;
  readonly label: string;
  readonly capabilities: ReadonlySet<PlanCapability>;
  readonly allocation: Readonly<Record<AllocationResource, PlanLimit>>;
  readonly usage: Readonly<Record<UsageResource, PlanLimit>>;
}

/** Direitos de um plano do catálogo congelado. */
export function fromCatalog(plan: PlanDefinition): EffectiveEntitlements {
  return {
    source: 'CATALOG',
    accessGranted: true,
    planCode: plan.code,
    label: plan.label,
    capabilities: new Set(plan.capabilities),
    allocation: plan.allocation,
    usage: plan.usage,
  };
}

/**
 * Direitos de um plano anterior ao catálogo.
 *
 * Tudo liberado e sem teto — exatamente o que estes inquilinos têm hoje, já
 * que `plans.limits` está vazio e o produto nunca consultou capacidade
 * comercial. As permissões de `plans.capabilities` continuam valendo pelo
 * `CapabilityGuard`; esta camada não as substitui nem as afrouxa.
 */
export function legacyUngoverned(
  planCode: string,
  label: string,
): EffectiveEntitlements {
  return {
    source: 'LEGACY_UNGOVERNED',
    accessGranted: true,
    planCode,
    label,
    capabilities: new Set(Object.values(PlanCapability)),
    allocation: todos(AllocationResource, UNLIMITED),
    usage: todos(UsageResource, UNLIMITED),
  };
}

/**
 * Direitos declarados na própria linha do plano.
 *
 * Formato aceito em `plans.limits`:
 *
 * ```json
 * {
 *   "entitlements": {
 *     "capabilities": ["CUSTOMERS", "OPERATIONS"],
 *     "allocation": { "PLATFORM_USERS": 2, "…": null },
 *     "usage": { "SERVICE_ORDERS_CREATED": 1, "…": null }
 *   }
 * }
 * ```
 *
 * `null` é ilimitado — e só aqui, onde a semântica está escrita e validada
 * (§39). Todo recurso precisa aparecer: ausência é erro, não ilimitado.
 */
export function customProfile(
  planCode: string,
  label: string,
  limits: unknown,
): EffectiveEntitlements | null {
  const declarado = objeto(limits)?.['entitlements'];
  if (declarado === undefined) return null;
  const perfil = objeto(declarado);
  if (!perfil) {
    throw new PlanConfigurationInvalidException(
      `${planCode}: entitlements is not an object`,
    );
  }
  return {
    source: 'CUSTOM',
    accessGranted: true,
    planCode,
    label,
    capabilities: capacidades(planCode, perfil['capabilities']),
    allocation: limites(
      planCode,
      'allocation',
      AllocationResource,
      perfil['allocation'],
    ),
    usage: limites(planCode, 'usage', UsageResource, perfil['usage']),
  };
}

/**
 * Os direitos retratados na assinatura.
 *
 * Passa pelo **mesmo** verificador do perfil declarado: retrato incompleto ou
 * inválido falha fechado, e não vira ilimitado. Um contrato que a aplicação
 * não consegue ler não pode virar acesso irrestrito.
 */
export function fromSubscription(
  planCode: string,
  label: string,
  snapshot: unknown,
  accessGranted: boolean,
): EffectiveEntitlements {
  const perfil = customProfile(planCode, label, { entitlements: snapshot });
  if (!perfil) {
    throw new PlanConfigurationInvalidException(
      `${planCode}: subscription snapshot is empty`,
    );
  }
  return { ...perfil, source: 'SUBSCRIPTION', accessGranted };
}

/**
 * O limite de um recurso, ou uma falha.
 *
 * Recurso desconhecido nunca vira ilimitado (§127): um erro de digitação no
 * nome de um recurso não pode abrir o portão.
 */
export function limitFor(
  entitlements: EffectiveEntitlements,
  resource: PlanResource,
): PlanLimit {
  const limite =
    (entitlements.allocation as Record<string, PlanLimit | undefined>)[
      resource
    ] ??
    (entitlements.usage as Record<string, PlanLimit | undefined>)[resource];
  if (!limite) {
    throw new PlanConfigurationInvalidException(
      `${entitlements.planCode}: no limit declared for ${resource}`,
    );
  }
  return limite;
}

export function isAllocationResource(
  resource: string,
): resource is AllocationResource {
  return resource in AllocationResource;
}

export function isUsageResource(resource: string): resource is UsageResource {
  return resource in UsageResource;
}

/* ------------------------------------------------------------------ */
/* Internos                                                            */
/* ------------------------------------------------------------------ */

function todos<T extends string>(
  recursos: Record<string, T>,
  limite: PlanLimit,
): Record<T, PlanLimit> {
  return Object.values(recursos).reduce(
    (mapa, recurso) => {
      mapa[recurso] = limite;
      return mapa;
    },
    {} as Record<T, PlanLimit>,
  );
}

function objeto(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function capacidades(
  planCode: string,
  value: unknown,
): ReadonlySet<PlanCapability> {
  if (!Array.isArray(value)) {
    throw new PlanConfigurationInvalidException(
      `${planCode}: capabilities must be a list`,
    );
  }
  const conhecidas = new Set<string>(Object.values(PlanCapability));
  const resultado = new Set<PlanCapability>();
  for (const item of value) {
    if (typeof item !== 'string' || !conhecidas.has(item)) {
      throw new PlanConfigurationInvalidException(
        `${planCode}: unknown capability ${String(item)}`,
      );
    }
    resultado.add(item);
  }
  return resultado;
}

function limites<T extends string>(
  planCode: string,
  secao: string,
  recursos: Record<string, T>,
  value: unknown,
): Record<T, PlanLimit> {
  const declarado = objeto(value);
  if (!declarado) {
    throw new PlanConfigurationInvalidException(
      `${planCode}: ${secao} must be an object`,
    );
  }
  return Object.values(recursos).reduce(
    (mapa, recurso) => {
      if (!(recurso in declarado)) {
        throw new PlanConfigurationInvalidException(
          `${planCode}: ${secao} is missing ${recurso}`,
        );
      }
      const bruto = declarado[recurso];
      if (bruto === null) {
        mapa[recurso] = UNLIMITED;
        return mapa;
      }
      if (typeof bruto !== 'number' || !Number.isInteger(bruto) || bruto < 0) {
        throw new PlanConfigurationInvalidException(
          `${planCode}: ${secao}.${recurso} is not a non-negative integer`,
        );
      }
      mapa[recurso] = limited(bruto);
      return mapa;
    },
    {} as Record<T, PlanLimit>,
  );
}
