# Orbit V2 — Frontend Core (PR-01)

> Autenticação, sessão, guards e escopo multi-tenant construídos sobre esta
> camada estão em [`authentication.md`](./authentication.md).

Infraestrutura de comunicação entre o frontend (Next.js 16 / App Router / React 19)
e o backend (NestJS). **Esta PR não cria telas nem dados fictícios**: entrega a
camada que todos os próximos módulos (Dashboard, Agenda, Operações, Clientes…)
vão consumir.

O Design System existente não foi alterado: nenhum componente, token, tema ou
layout de `src/components/**` foi tocado.

---

## 1. Arquitetura

```
Browser (Client Components)
   │  fetch relativo → /api/orbit/**   (sem tokens, sem CORS)
   ▼
Next.js Route Handlers — BFF
   │  Authorization: Bearer <access token do cookie HttpOnly>
   │  x-request-id · accept-language · x-timezone · x-organization-id · x-business-unit-id
   ▼
NestJS  (ORBIT_API_URL — rede interna, nunca exposta ao browser)
```

Server Components e Server Actions **não** passam pelo proxy: já têm acesso aos
cookies e falam direto com o NestJS por `serverApi`.

```
Server Component ──► serverApi ──► backendJson ──► NestJS
```

### Por que BFF

| Motivo | Efeito |
| --- | --- |
| Tokens em cookies `HttpOnly` | Access/refresh nunca ficam acessíveis ao JavaScript da página |
| Origem única | Sem CORS, sem preflight, sem URL de backend no bundle |
| Renovação centralizada | 401 → refresh → repete a requisição, transparente para a tela |
| Contexto automático | `requestId`, locale, timezone e escopo em toda chamada |
| Superfície controlada | Só as rotas registradas na allowlist são encaminhadas |

---

## 2. Estrutura

```
frontend/
  app/
    api/auth/{login,logout,register,refresh,session}/route.ts   # sessão (grava cookies)
    api/orbit/[...path]/route.ts                                # proxy genérico → NestJS
    providers.tsx                                               # DS + AppProviders
  proxy.ts                                                      # middleware de navegação
  scripts/sync-contracts.mjs                                    # contratos do backend → frontend
  src/
    api/           # cliente do browser  (http, client, transfer, query-keys, query-client)
    server/        # servidor            (backend-client, api, auth/*, bff/*)
    providers/     # Query · Session · RequestContext
    hooks/api/     # useApiQuery, useApiMutation, useUpload, useLogin…
    services/      # createResourceService, authService
    types/         # contracts/ (gerado) + api.ts + session.ts
    lib/           # env, api-error, retry, routes, context-headers
    utils/         # utilitários HTTP puros
```

Regra de importação:

| Contexto | Importe |
| --- | --- |
| Client Component | `@/api`, `@/hooks/api`, `@/providers` |
| Server Component / Server Action | `@/server/api` |
| Route Handler | `@/server/bff/*`, `@/server/auth/*` |
| Middleware | `@/server/auth/{jwt,refresh,cookies}` (sem `next/headers`) |

---

## 3. Tipagem — contrato único com o backend

`backend/src/contracts` é a fonte de verdade. O script copia esses arquivos
(TypeScript puro, sem runtime) para `src/types/contracts/`:

```bash
npm run contracts:sync
```

Import direto (`../backend/src/contracts`) não é possível porque o build de
produção do frontend roda em contexto Docker isolado (`context: ./frontend`).
Rode o sync sempre que os contratos do backend mudarem — o diretório gerado
não deve ser editado à mão.

`src/types/api.ts` e `src/types/session.ts` cobrem **apenas** transporte HTTP e
sessão. Nenhuma entidade de negócio é redeclarada no frontend.

### Envelope

Sucesso (`ResponseInterceptor`):

```jsonc
{ "success": true, "data": { }, "requestId": "…", "timestamp": "…" }
```

Erro (`FoundationExceptionFilter`):

```jsonc
{ "success": false, "error": { "code": "…", "message": "…", "details": … }, "requestId": "…", "timestamp": "…" }
```

O cliente desembrulha `data` automaticamente. Erros viram `ApiError` com
`status`, `code`, `requestId`, `details` e `validationMessages`.

---

## 4. Autenticação

| Rota | Efeito |
| --- | --- |
| `POST /api/auth/login` | Autentica e grava `orbit_access` + `orbit_refresh` (HttpOnly) |
| `POST /api/auth/register` | Cria organização + usuário e abre sessão |
| `POST /api/auth/logout` | Revoga no backend e apaga os cookies |
| `POST /api/auth/refresh` | Rotação explícita do par de tokens |
| `GET /api/auth/session` | Perfil, escopo, papéis e permissões — **sem tokens** |

Renovação acontece em três pontos, todos com deduplicação (`refresh.ts`), já que
o backend rotaciona o refresh token a cada uso:

1. **Middleware** (`proxy.ts`) — antes de renderizar rota protegida.
2. **Proxy do BFF** — 401 do backend → refresh → repete a requisição uma vez.
3. **Rota `/api/auth/refresh`** — quando o cliente quer forçar.

Server Components **não** renovam: não conseguem gravar cookies, e renovar sem
persistir o novo refresh token derrubaria a sessão. O middleware já garantiu um
access token válido antes deles.

O middleware avalia a expiração localmente (sem round-trip) e trata a decisão
como **portão de navegação**. A autoridade sobre autenticação e permissões
continua no NestJS: todo dado passa pelo BFF e é verificado lá.

### Rotas protegidas

`src/lib/routes.ts` concentra os prefixos. Ao criar uma área nova, registre-a lá
e espelhe no `matcher` de `proxy.ts` (o Next exige valor estático).

---

## 5. Contexto de requisição

Enviado automaticamente em toda chamada, do browser ao NestJS:

| Cabeçalho | Consumo no backend |
| --- | --- |
| `authorization` | `JwtAuthenticationGuard` — identidade, escopo, permissões |
| `x-request-id` | `RequestIdInterceptor` — correlação ponta a ponta |
| `accept-language` | `RequestContextInterceptor` → `RequestContext.locale` |
| `x-timezone` | propagado (observabilidade; ainda não lido) |
| `x-organization-id` | propagado (observabilidade; ainda não lido) |
| `x-business-unit-id` | propagado (observabilidade; ainda não lido) |

> **Importante:** o escopo multi-tenant efetivo e o RLS derivam das *claims do
> access token*, não desses cabeçalhos — eles não são um vetor de escalada de
> escopo. Estão prontos para o dia em que o backend passar a validá-los.
> Quando um endpoint aceita `businessUnitId` como filtro (ex.: `OperationQueryDto`),
> passe-o explicitamente na query.

No browser o contexto vive em `src/api/request-context.ts` e é mantido em dia
pelo `RequestContextProvider` (locale e timezone via `Intl`, escopo via sessão).

---

## 6. Como um novo módulo consome a API

**Nada de novo Route Handler, fetch ou tratamento de erro.** O fluxo é sempre:
serviço → hook → componente.

### 6.1 Serviço

```ts
// src/services/operations.service.ts
import { createResourceService } from "@/services/resource-service";
import type { Operation, OperationStatus } from "@/types";

export const operationsService = createResourceService<
  Operation,
  CreateOperationInput,
  UpdateOperationInput,
  { page?: number; limit?: number; status?: OperationStatus }
>("operations");
```

Ganha de graça: `list`, `listAll`, `get`, `create`, `update`, `remove`,
`child`, `action`, `uploadTo`, `downloadFrom` e as query keys (`keys.module()`,
`keys.list()`, `keys.detail(id)`).

### 6.2 Hooks

```ts
// src/hooks/operations/use-operations.ts
"use client";
import { useApiMutation, usePaginatedQuery } from "@/hooks/api";
import { operationsService as service } from "@/services/operations.service";

export function useOperations(query: OperationQuery) {
  return usePaginatedQuery<Operation>(
    service.keys.list(query),
    service.basePath,
    query,
  );
}

export function useCreateOperation() {
  return useApiMutation((input: CreateOperationInput) => service.create(input), {
    invalidate: [service.keys.module()],
  });
}
```

### 6.3 Componente

```tsx
const { data, isPending, error } = useOperations({ page, limit: 20 });
if (error) return <ErrorState message={error.message} />;
```

Componentes usam o Design System já existente — esta camada não fornece UI.

### 6.4 Server Component

```tsx
import { serverApi } from "@/server/api";

const page = await serverApi.get<PaginatedResult<Operation>>("/operations", {
  query: { page: 1, limit: 20 },
});
```

### 6.5 Upload e download

```ts
const { upload, progress, isUploading } = useUpload<Attachment>(
  `/operations/${id}/attachments`,
  { invalidate: [operationsService.keys.nested(id, "attachments")] },
);

const { download } = useDownload();
await download(`/reports/${reportId}/documents/${documentId}`, "laudo.pdf");
```

Uploads vão como `multipart/form-data` no campo `file` (contrato do
`FileInterceptor`), com limite de 20 MB validado antes do envio. Downloads
chegam como `Blob` com o nome extraído de `Content-Disposition`.

### 6.6 Módulo novo no backend

Registre a raiz do controller em `src/server/bff/allowlist.ts`. É o **único**
ponto do Frontend Core que muda ao adicionar um módulo.

---

## 7. Resiliência

| Recurso | Comportamento |
| --- | --- |
| Timeout | 30 s padrão, 120 s em upload — via `AbortSignal.timeout` |
| Cancelamento | `AbortSignal` do TanStack Query chega ao `fetch`; sair da tela aborta a chamada |
| Retry | Só métodos idempotentes (GET/HEAD/PUT/DELETE) e falhas transitórias (rede, timeout, 408, 425, 429, 5xx) |
| Backoff | Exponencial com jitter, respeitando `Retry-After` (teto de 8 s) |
| Mutações | Nunca reenviadas automaticamente |
| 401 | O proxy tenta renovar; falhando, limpa cookies e devolve `SESSION_EXPIRED` |

Cache (TanStack Query): `staleTime` 30 s, `gcTime` 5 min, sem refetch em foco,
refetch ao reconectar.

---

## 8. Segurança

- Tokens só em cookies `HttpOnly`, `SameSite=Lax`, `Secure` em produção.
- `ORBIT_API_URL` é lido apenas no servidor; `assertServer()` protege contra uso
  acidental no cliente.
- Todas as rotas do BFF exigem origem própria (`sec-fetch-site`).
- O proxy valida os segmentos do path (sem `..`, `/`, `\`) e aplica allowlist.
- `identity/{login,register,refresh,logout}` são **bloqueadas** no proxy
  genérico: emitem tokens e precisam do tratamento de cookies das rotas
  dedicadas.
- Resposta do backend é repassada com cabeçalhos filtrados (sem `set-cookie`,
  sem `content-length`/`content-encoding` inconsistentes).

---

## 9. Autoridade do servidor

A interface não decide elegibilidade nem transição de estado. O Read Model
publica `allowedActions` por registro e `transitions` no detalhe; a tela lê.

Ver **`docs/server-authority.md`** — é leitura obrigatória antes de adicionar
qualquer menu de ações ou seletor de status.

## 10. Qualidade

```bash
npm run contracts:sync   # sincroniza contratos com o backend
npm run typecheck        # tsc --noEmit (strict, sem any)
npm run lint             # eslint (flat config, next + prettier)
npm run test             # vitest — lógica pura: autoridade, erros, formatação
npm run format           # prettier
npm run build            # next build
```

`eslint.config.mjs` ignora `src/types/contracts/**` (gerado) e o Design System
já entregue (`src/components/ui/**`, `src/hooks/use-mobile.tsx`), preservado sem
alterações.
