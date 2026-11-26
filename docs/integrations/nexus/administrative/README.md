# API administrativa corporativa do Orbit

O namespace `/api/v1/corporate-admin` autentica um principal técnico dedicado. A descoberta da conexão mantém o contrato `1.0.0` consumido pelo Nexus.

| Método | Rota | Dados |
| --- | --- | --- |
| GET | `/api/v1/corporate-admin/connection` | `{ "status": "ok" }` |
| GET | `/api/v1/corporate-admin/version` | `{ "service": "orbit-corporate-admin", "version": "1.0.0" }` |
| GET | `/api/v1/corporate-admin/capabilities` | `{ "capabilities": ["connection:read"] }` |

Os três handlers exigem autenticação e a capability antes de responder. A resposta usa o envelope HTTP do Orbit e `Cache-Control: private, no-store`. A versão identifica apenas o contrato corporativo. [OpenAPI 3.1](openapi.json)

## Fronteiras do código

- `CorporateAdministrationModule` registra a descoberta, o diretório de organizações e os guards de autenticação e capability. A autenticação técnica permanece local ao request corporativo. Claims, cookies, tokens de usuário e cabeçalhos que declarem um operador ou cargo não viram autoridade.
- `PlatformAdministrationService` orquestra consultas e comandos locais com autoridade humana verificada. `VerifiedPlatformAuthority`, as regras de tenant e os repositórios de plataforma continuam aplicáveis à superfície atual. O diretório reutiliza o repositório, o seletor e a projeção da assinatura canônica, a validação dos campos cadastrais e a regra de disponibilidade operacional. A autoridade humana da administração local segue o próprio fluxo de verificação.
- A auditoria da plataforma registra atores humanos, efeitos e metadados de domínio. As decisões desta fronteira usam o logger estruturado com `event=corporate_admin_access`, `role=TECHNICAL`, operação, resultado, correlação e `technicalPrincipalId` quando autenticado. A identidade técnica permanece separada de `userId`. Tokens, verificadores e cabeçalhos não entram no registro. O log HTTP existente cobre respostas 429. Em caso de configuração inválida, o log recebe apenas um código genérico.
- O limite por origem reutiliza `AuthRateLimitService` e tem uma chave de ação única para as rotas corporativas. Os parâmetros existentes configuram a janela e o máximo (padrões de 120 tentativas por origem em 60 segundos). Redis, quando habilitado, e fallback PostgreSQL mantêm a contagem entre réplicas. A origem vem do socket ou do cabeçalho atestado pelo proxy já configurado. O orçamento das rotas de login permanece separado.

## Configuração e ciclo da credencial

No processo **API**:

| Variável | Uso |
| --- | --- |
| `ORBIT_CORPORATE_ADMIN_ENABLED` | `false` por padrão. Somente `true` habilita com configuração válida. |
| `ORBIT_CORPORATE_ADMIN_CREDENTIALS` | Array JSON de registros de verificador, com até 16 entradas. Injete pelo cofre/gerenciador de segredos do processo API. |
| `ORBIT_DEPLOYMENT` | `staging` ou `production` identifica explicitamente o ambiente implantado. Deixe a variável ausente na execução local fora de `NODE_ENV=production` e use `local` nos registros da credencial. |
| `AUTH_RATE_LIMIT_SECRET`, `AUTH_RATE_LIMIT_ORIGIN_MAX`, `AUTH_RATE_LIMIT_WINDOW_MS` | Reutilizam os valores do limite do Orbit. |
| `TRUSTED_PROXY_SECRET` | Valor existente do proxy privado. Em implantação atrás de proxy, o salto deve atestar `X-Forwarded-Proto: https` com esse segredo. Use TLS direto ou esse ingresso controlado, com a porta da API privada e sobrescrita dos cabeçalhos de ingress. |

O registro contém `keyId` (slug de até 32 caracteres), `principalId` (UUID v4 ou v7, estável por conector), `environment` (o mesmo ambiente da API), `secretSha256` (64 caracteres hexadecimais minúsculos), `expiresAt` (UTC em ISO 8601), `revoked` (booleano) e `capabilities` (lista explícita com zero ou mais valores entre `connection:read`, `organizations:read` e `organizations:write`, sem repetições). IDs de chave duplicados e configuração inválida desabilitam somente a fronteira. Configuração e alterações de chaves são carregadas na inicialização.

A credencial enviada pelo Nexus no cabeçalho `Authorization: Bearer …` tem formato `orbit-ca1.<ambiente>.<keyId>.<segredo>`. O segredo tem 32 bytes aleatórios codificados em Base64URL, gerados de forma independente por chave e ambiente. O servidor guarda apenas SHA-256 de `orbit-corporate-admin.v1\0<ambiente>\0<keyId>\0<segredo>` e faz comparação em tempo constante do digest de 32 bytes. Vencimento e revogação são verificados a cada autenticação. O bearer deve ficar no cofre do cliente técnico.

Exemplo local para gerar dois arquivos privados em uma pasta protegida vazia. O comando não imprime o bearer e recusa sobrescrever os arquivos.

```bash
node --input-type=module - <<'JS'
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const keyId = 'nexus-local-01';
const environment = 'local';
const secret = randomBytes(32).toString('base64url');
const digestInput = ['orbit-corporate-admin.v1', environment, keyId, secret].join('\0');
const verifier = {
  keyId,
  principalId: randomUUID(),
  environment,
  secretSha256: createHash('sha256').update(digestInput).digest('hex'),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  revoked: false,
  capabilities: ['connection:read'],
};
writeFileSync('orbit-verifier.json', JSON.stringify([verifier]), { flag: 'wx', mode: 0o600 });
writeFileSync('nexus-token.txt', ['orbit-ca1', environment, keyId, secret].join('.'), { flag: 'wx', mode: 0o600 });
JS
```

Injete o conteúdo de `orbit-verifier.json` na variável de credenciais da API local e o de `nexus-token.txt` no cliente técnico. A exceção de HTTP vale apenas em ambiente local, com socket loopback. Ambientes implantados exigem HTTPS atestado; `X-Forwarded-Proto` isolado não satisfaz o guard. As variáveis de habilitação e verificador precisam ser passadas explicitamente ao container de API quando essa fronteira for autorizada. O Compose do produto não o faz por padrão.

**Rotação.** Provisionar novo segredo com outro `keyId` e o mesmo `principalId`. Carregar os dois verificadores em todas as instâncias, atualizar o cliente e verificar a conexão. Então revogar ou remover o antigo e recarregar todas as instâncias. A revogação de uma credencial vazada exige essa atualização imediata ou a desabilitação da fronteira. A expiração independe de reload. Sem sessão ou token renovável emitido pelo Orbit.

## Gestão cadastral · ADM-02.A

| Método | Rota | Capability | Resultado |
| --- | --- | --- | --- |
| GET | `/api/v1/corporate-admin/organizations` | `organizations:read` | `items`, `total`, `page`, `pageSize` |
| GET | `/api/v1/corporate-admin/organizations/{id}` | `organizations:read` | Dados cadastrais e resumo administrativo da organização |
| PATCH | `/api/v1/corporate-admin/organizations/{id}` | `organizations:write` | `id`, `updatedAt` e `changedFields` |

Os dois grants são independentes e precisam ser atribuídos explicitamente. O endpoint `/capabilities` permanece a descoberta legada de conexão e continua respondendo `["connection:read"]` quando autorizado. Consulte os grants exigidos por operação no campo `x-required-capability` do OpenAPI. A fronteira continua desabilitada por padrão e fora do BFF Web.

- A listagem retorna nome de exibição, razão social e nome comercial da unidade principal, documento cadastral, segmento, datas de cadastro e atualização, status e disponibilidade operacional, assinatura e contagens de unidades e vínculos de usuário. O documento vem da unidade principal, com fallback para o registro da conta quando ela estiver ausente. Dados indisponíveis retornam `null`.
- A busca por nome é parcial e ignora caixa. UUID e CPF/CNPJ usam correspondência exata. O CPF/CNPJ aceita máscara e também é consultado no registro de documentos da conta. Os filtros combinam estado operacional, plano, assinatura persistida e intervalo de cadastro em UTC. `registeredFrom` é inclusivo e `registeredBefore` é exclusivo.
- A paginação inicia em 1 com 25 registros e aceita até 100 por página, até a página 10.000. O total é calculado antes da paginação. É possível ordenar por `registeredAt` ou `displayName`, em ambas as direções, com desempate pelo ID. O padrão é cadastro mais recente primeiro.
- O detalhe acrescenta o contato da unidade principal, a identificação e o nome de exibição do responsável, o número de vínculos ativos e até 100 unidades com identificação, nomes, status, cidade e UF. `unitCount` indica o total de unidades sem exclusão lógica.
- A seleção da assinatura prioriza a linha corrente e, na ausência dela, a mais recente. `status` e `planCode` representam a linha persistida e são os valores usados pelos filtros. `effectiveStatus` e `effectivePlanCode` representam a projeção no instante da consulta. `UNKNOWN` filtra registros sem linha canônica.
- O PATCH aceita `displayName` e `primarySegment`, com pelo menos um deles, e exige `expectedUpdatedAt` igual à versão recebida anteriormente. Alterações concorrentes retornam 409. Uma solicitação sem diferença de valor retorna a mesma versão e `changedFields: []`. A escrita exige `X-Nexus-Administrator-Id` como UUID. Nas leituras, o cabeçalho é opcional.
- As consultas bem-sucedidas ou sem resultado no detalhe e as tentativas válidas de escrita registram ação, resultado, correlação e alvo, quando aplicável. O PATCH registra os nomes dos campos alterados. `technicalPrincipalId` é autenticado pelo Orbit e `declaredNexusAdministratorId` é uma referência declarada, sem efeito sobre permissões. O papel SQL dedicado tem grants por coluna, políticas RLS próprias e é inacessível como papel do runtime. A alteração e a auditoria são atômicas. Os guards preservam o log estruturado de falhas de acesso.

O contrato federado TENANT/ACK segue o próprio ciclo de ratificação. O diretório cobre dados cadastrais e usa o Orbit como fonte canônica. A validação foi feita com credenciais sintéticas e PostgreSQL descartável.
