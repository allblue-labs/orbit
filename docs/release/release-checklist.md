# Orbit V2 V1 release checklist

Marque somente com evidência da mesma árvore/SHA usada no build final.

## Source e build

- [ ] branch, HEAD e dirty tree registrados;
- [ ] `git diff --check` limpo;
- [ ] TypeScript/lint/build Prisma e Nest verdes;
- [ ] frontend typecheck/lint/test/build verdes;
- [ ] Flutter analyze/test e Android/iOS builds verdes;
- [ ] imagens reconstruídas com versão, SHA, timestamp e digest registrados;
- [ ] nenhum artefato usa `latest` implícito.

## Banco e isolamento

- [ ] backup pré-migration disponível;
- [ ] PMOC preflight igual a zero ou legado real explicitamente corrigido;
- [ ] fresh migration e upgrade migration verdes;
- [ ] `prisma migrate status` sem pending;
- [ ] migrator idempotente;
- [ ] catálogo comercial reconciliado pelo migrator em fresh e upgrade;
- [ ] `orbit_app` é `NOSUPERUSER/NOBYPASSRLS`;
- [ ] RLS + FORCE preservados em tabelas tenant-owned;
- [ ] SECURITY DEFINER sem PUBLIC EXECUTE e com search_path fixo;
- [ ] tenant isolation E2E verde.

## Segurança

- [ ] APP_GUARD centralizado na ordem authentication → RBAC → entitlement;
- [ ] 401/403, sessões, revogação e concorrência verdes;
- [ ] CORS exata, BFF same-origin e cookies seguros;
- [ ] rate limit em auth/billing sensível;
- [ ] logs não carregam query string, token, QR ou signed URL;
- [ ] produção sem OTP fixo, mock auth ou seed demo automático;
- [ ] audit de dependências sem high/critical alcançável;
- [ ] SBOM e inventário de licenças arquivados.

## Produto

- [ ] PMOC draft vazio compatível, ativação vazia negada e última coverage
  protegida na aplicação e banco;
- [ ] preview PMOC 100 × 12 dentro do budget;
- [ ] RVT/OS/inventory/automations/usage/artifacts verdes;
- [ ] signatures e customer acknowledgement preservam snapshot/histórico;
- [ ] mobile queue/detalhe não perdem item atrás de histórico antigo;
- [ ] pull offline inicial pagina além de 500 e replay é idempotente;
- [ ] QR rotate/revoke e evidence/storage bounds verdes;
- [ ] portal não aparece no catálogo nem no runtime de produção;
- [ ] Stripe disabled e, quando aplicável, enabled/test mode verdes.

## Operação

- [ ] liveness e readiness têm semânticas distintas;
- [ ] background jobs/webhooks possuem estado e retries observáveis;
- [ ] backup + restore exercitados;
- [ ] rollback walkthrough executado;
- [ ] clean environment smoke verde;
- [ ] E2E backend global passou três vezes consecutivas e serializadas;
- [ ] Web E2E completo verde;
- [ ] performance e query topology registradas;
- [ ] known debts classificadas sem blocker aberto.
