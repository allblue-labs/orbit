# PR-02 — Dependências do frontend e migração Zod 4

Trata F02 da [revisão de produção](production-review-2026-11-12.md). A auditoria
de produção passou de quatro pacotes sinalizados (um critical e três high) para
**zero alertas**. Cadastro, BFF, otimização de imagem e aceite público foram
exercitados na imagem standalone Node 22/Linux com o bundler padrão Turbopack.
O parecer geral da release continua condicionado às demais PRs e à qualificação
externa; nenhum ataque de produção foi demonstrado ou executado.

## Alterações

| Pacote instalado | Anterior | Atual |
| --- | --- | --- |
| Next.js e eslint-config-next | 16.3.4 | 16.4.6 |
| React e React DOM | 19.2.8 | 19.3.1 |
| Sharp | 0.35.4 | 0.35.5 |
| source-map-js transitivo | 1.2.1 | 1.2.2 |
| Zod | 3.25.76 | 4.6.7 |
| Vitest | 3.2.7 | 4.1.12 |
| Vite de desenvolvimento | 7.3.6 | 8.3.8 |

Next permanece na linha 16; React/React DOM e o preset ESLint foram alinhados.
O lockfile inclui os patches nativos de Sharp/libvips e os patches compatíveis
de brace-expansion. Não há novo override nem `audit fix --force`.

Zod tinha um único consumidor direto, no cadastro. Seu schema foi extraído para
`signup-schema.ts`, importado pelo formulário e pelos testes, mantendo regras de
senha, CPF/CNPJ, plano, periodicidade, confirmação e consentimento. A migração usa
`z.email` e a opção `error` do Zod 4, com mensagens de campos ausentes em pt-BR.
O teste chama também o `zodResolver` real, preservando React Hook Form 7 e seu
resolver compatível. A leitura sem uso de `termsAccepted` foi removida.

A auditoria completa também apontou falhas critical/high nas ferramentas de teste.
Vitest foi migrado para a linha corrigida 4, sem alterar os testes anteriores ou
relaxar expectativas. Seus 668 testes passaram após instalação limpa. A versão 5
não foi adotada; sua migração não é necessária para eliminar esses advisories.

O smoke usa configuração Playwright própria e API fictícia, sem trocar o setup
dos E2E com tenant real. A configuração só aceita destino em loopback. Propostas
usam tokens independentes por teste; contas e respostas são sintéticas. Relatórios
e traces do Playwright foram excluídos do contexto Docker.

Referências: [Next/image](https://github.com/advisories/GHSA-2464-fhr4-w9xw),
[source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q),
[Zod](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
[migração Zod 4](https://zod.dev/v4/changelog) e
[advisory Vitest](https://github.com/advisories/GHSA-82fw-gwwq-j7x9).

## Verificação

- `npm ci --no-audit` passou; o build Docker executou seu próprio `npm ci`.
- `npm audit --omit=dev`: zero alertas, tanto no ambiente local quanto com
  Node 22/npm 10 no Linux.
- Suíte completa: **67 arquivos e 668 testes passaram**, incluindo 12 novos casos
  do schema/resolver do cadastro. A base anterior tinha 656 testes.
- TypeScript e ESLint dos arquivos alterados passaram. O ESLint completo também
  passou; `npm run lint` continua com código 1 pelos mesmos oito textos técnicos
  do checker de linguagem, registrados para PR-03.
- Build Docker passou com `next build`/Turbopack, checagem de tipos e saída
  standalone. Runtime conferido: Node 22.23.5, Linux x64, UID 1001, Next 16.4.6,
  Sharp 0.35.5.
- **Cinco smokes Chromium passaram** contra essa imagem: renderização/navegação
  planos→cadastro e imagem otimizada; sessão/cookies/logout/origem; coleta de
  assinatura e atualização do aceite público; obrigatoriedade de termos por
  clique e por Enter, inclusive com navegador em inglês e viewport mobile.
- As páginas exercitadas não emitiram exceções JavaScript não tratadas. Os testes
  de consentimento interceptam o cadastro; nenhuma conta real foi criada.

A auditoria completa local conserva **sete moderate** na cadeia TypeScript
ESLint/Minimatch, sem high/critical. No npm 10/Linux são oito: o aviso adicional
é a propagação do mesmo problema para `eslint-config-next`, não outro advisory
raiz. Essa variante também precisa entrar no gate multiplataforma da PR-03.
O problema raiz conhecido exige atualizar a cadeia que usa Minimatch 10; não foi
forçada uma versão principal transitiva. Os usos identificados são ferramentas
de lint/build com padrões do repositório, sem dados de tenant nesses caminhos.

[Evidência estruturada e checksum do lockfile](evidence/pr-02-frontend-dependencies.json).
Não foram executados os E2E completos com banco real, testes de cobrança, entrega
cloud ou TLS de produção. O upstream fictício qualifica o frontend e seu transporte;
não comprova autorização do backend, validade jurídica ou emissão de PDF assinado.

## Reproduzir

Na pasta `frontend`:

```sh
npm ci
npm audit --omit=dev
npm test
npm run typecheck
npm run lint
```

O último comando ainda aponta os oito textos preexistentes. Instale Chromium com
`npx playwright install chromium`, se necessário. Na raiz do repositório, usando
nomes de containers livres para uma rodada isolada:

```sh
docker build --target runner --tag orbit-pr02-frontend:review --file frontend/Dockerfile frontend
docker network create orbit-pr02-review
docker run --detach --rm --name orbit-pr02-fixture --network orbit-pr02-review --read-only --user 1000:1000 --mount type=bind,source="$PWD/frontend/e2e/dependencies/upstream.mjs",target=/fixture.mjs,readonly node:22-bookworm-slim node /fixture.mjs
docker run --detach --rm --name orbit-pr02-web --network orbit-pr02-review --publish 127.0.0.1:17202:3000 --env ORBIT_API_URL=http://orbit-pr02-fixture:17203/api/v1 --env FRONTEND_ORIGIN=http://127.0.0.1:17202 --env ALLOW_INSECURE_LOCAL_COOKIES=true --env AUTH_COOKIE_SECURE=true orbit-pr02-frontend:review
curl --retry 6 --retry-all-errors --retry-delay 1 --max-time 5 --fail --silent -H 'Sec-Fetch-Site: same-origin' http://127.0.0.1:17202/api/auth/session
npm --prefix frontend run test:dependencies
docker stop orbit-pr02-web orbit-pr02-fixture
docker network rm orbit-pr02-review
```

A exceção de HTTP só existe nos parâmetros deste ambiente local, com cookies
`Secure` explicitamente preservados e conferidos. O cliente HTTP do smoke envia
os cabeçalhos exigidos pelo BFF; nenhum guard foi enfraquecido. Encaminhar cookies
manualmente no teste HTTP não qualifica persistência de cookies em HTTPS real.

Uma tentativa inicial usou uma rede Docker interna sem publicação efetiva da
porta; outra omitiu a configuração/cabeçalhos exigidos para HTTP local. Esses
problemas do harness foram corrigidos antes do resultado final de cinco sucessos.
Os containers e a rede de teste foram removidos; não houve push ou implantação.
