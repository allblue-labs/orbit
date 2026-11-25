# Hotpath do Orbit

## Ativação no staging

Gere uma senha exclusiva com `openssl rand -hex 32` e configure `REDIS_HOTPATH_PASSWORD`, `REDIS_HOTPATH_ENABLED=true` e `COMPOSE_PROFILES=hotpath` no `.env` da stack. Preserve outros perfis já habilitados, se houver. Use o migrador da mesma versão da API e atualize também `deploy.sh` e `deployment_preflight.py`. Valide os arquivos Nginx com `nginx -t` antes de recarregar. Confirme que `redis-hotpath` está saudável e sem portas publicadas no host.

O Redis usa uma rede Docker interna compartilhada com a API, 128 MiB de memória para chaves, `allkeys-lru` e armazenamento temporário. A API reserva até 150 ms de espera por requisição para comandos Redis. Ao falhar ou esgotar o prazo, o circuito abre por cinco segundos. As rotas sensíveis voltam aos contadores do PostgreSQL. As rotas autenticadas usam contadores locais limitados enquanto o circuito estiver aberto. Durante a degradação, cada réplica aplica seu próprio limite autenticado. Os limites padrão por minuto são 240 por usuário e 1.800 por organização.

Antes de reutilizar um snapshot, a API consulta a sessão e os registros pertinentes sob RLS com a função `app_hotpath_access`, executada com os privilégios do chamador. Alterações no papel, associação, unidades, titularidade e cobrança mudam a versão consultada ou invalidam a própria sessão no commit. As chaves anteriores expiram em até 120 segundos. O estado operacional vem na mesma consulta e permissões globais continuam sendo reconstruídas no PostgreSQL. Cotas de escrita são decididas pelo fluxo transacional. Os snapshots Redis devem ser descartados se um banco for restaurado de um backup.

As rotas anotadas com `Idempotent` aceitam chaves de 8 a 160 caracteres. O resultado fica cifrado por até 24 horas e gravado junto com a mutação em uma tabela com RLS. Repetições precisam passar pelas permissões atuais e pelo acesso ao registro. A API responde com 409 para chave usada com outro conteúdo ou execução concorrente ainda em andamento. As filas de trabalho continuam no PostgreSQL.

## Cloudflare

Configure as regras em cada zona. Staging usa a zona `allblue-labs.com` e
o host `orbit.allblue-labs.com`. Produção usa a nova zona `portal-orbit.com.br`
e o host `portal-orbit.com.br`. Nas expressões abaixo, troque somente o valor
de `http.host` ao publicar na zona de produção. Os caminhos e os limites na
origem são os mesmos. As evidências ao final desta página são de staging.

### Cache de tráfego dinâmico

Em **Caching → Cache Rules**, publique `Orbit — bypass dinâmico` com **Bypass cache**. Posicione após regras mais amplas que também correspondam ao Orbit.

```text
(http.host eq "orbit.allblue-labs.com"
 and not starts_with(http.request.uri.path, "/_next/static/"))
```

Após aplicar, confira `CF-Cache-Status: DYNAMIC` ou `BYPASS` e ausência de `Age` em `/login`, nas rotas da API e nas páginas com token. Um arquivo CSS ou JS existente em `/_next/static/` deve continuar retornando `HIT` depois de aquecido. O CDN público `cdn-orbit.allblue-labs.com` tem configuração própria.

Em produção, com o Worker ativo, confirme o estático por `X-Orbit-Static-Source`
conforme o [teste do CDN](edge-storage-sentry.md#estáticos-do-build-e-buckets-existentes).

### Limite de taxa no WAF

Em **Security → Security rules → Create rule → Rate limiting rules**, crie `Orbit — autenticação e propostas`. Quando o plano aceitar filtro de host, use a expressão completa abaixo. No Free, cole somente a expressão interna entre parênteses e confirme que os caminhos listados são exclusivos do Orbit na zona. Com suporte a método, acrescente `and http.request.method eq "POST"`. Assim, a regra não conta preflights.

```text
http.host eq "orbit.allblue-labs.com" and (
  http.request.uri.path in {
    "/api/v1/identity/login" "/api/v1/identity/register" "/api/v1/identity/refresh"
    "/api/v1/identity/password/forgot" "/api/v1/identity/password/reset"
    "/api/v1/identity/password/reset/validate"
    "/api/orbit/identity/login" "/api/orbit/identity/register" "/api/orbit/identity/refresh"
    "/api/orbit/identity/password/forgot" "/api/orbit/identity/password/reset"
    "/api/orbit/identity/password/reset/validate"
    "/api/v1/portal/auth/login" "/api/v1/portal/auth/password/reset-request"
  }
  or http.request.uri.path wildcard "/api/v1/public/quotes/proposals/*/response"
  or http.request.uri.path wildcard "/api/orbit/public/quotes/proposals/*/response"
)
```

Com filtro de host disponível, inclua `/api/auth/login`, `/api/auth/register` e `/api/portal/auth/login` no conjunto para proteger também os aliases Web. Para começar, use **IP**, **18 requisições em 10 segundos**, ação **Block** e duração de **10 segundos**. Os controles por conta, rota e token seguem ativos na origem. Quando o painel oferecer resposta personalizada, use status 429 e corpo JSON. Mantenha a resposta padrão do limite nos planos sem essa opção. Valide a regra em **Security Events** pelo nome e pelo Ray ID de uma requisição de teste. O status 429, por si só, também pode vir do Nginx ou do NestJS.

### TLS e origens

Mantenha **SSL/TLS → Overview → Full (strict)** e o DNS do Orbit com proxy ativo. O firewall da origem deve aceitar tráfego HTTPS da Cloudflare pelas faixas oficiais. O Nginx usa essas faixas para autenticar `CF-Connecting-IP`, remove o cabeçalho recebido antes de repassar a requisição e envia a identidade da rede no par interno autenticado. Mantenha Pseudo IPv4 em **Off** ou **Add Header** para preservar os endereços IPv6.

Os relatórios podem usar a exportação assíncrona (202, consulta de status e
download assinado). Produção usa R2 e staging usa o gateway local. Preserve os
timeouts da origem e o TTL de 300 segundos das URLs assinadas.

### Verificação de 24/11/2026

O domínio público retornou `DYNAMIC` sem `Age` em login, API e proxy Web. O CSS versionado de login retornou `HIT` e `Cache-Control: public, max-age=31536000, immutable`. Na validação de senha com payload vazio, 18 chamadas chegaram à API (400) e as seis seguintes receberam 429 da borda com `Retry-After`. Uma nova chamada após o bloqueio voltou a receber 400 da API. Ray ID da primeira recusa `a5faa201eaa56d5e-GIG`.

[Cache Rules](https://developers.cloudflare.com/cache/how-to/cache-rules/settings/) · [Limite de taxa e campos por plano](https://developers.cloudflare.com/waf/rate-limiting-rules/) · [Cabeçalhos da Cloudflare](https://developers.cloudflare.com/fundamentals/reference/http-headers/) · [Proteção da origem](https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/)
