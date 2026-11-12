# PR-01 — Dependências do backend

Trata o achado F01 da [revisão de produção](production-review-2026-11-12.md).
As dependências de produção passaram de 15 pacotes sinalizados (4 high e
11 moderate) para **zero alertas** em `npm audit --omit=dev` nesta execução.
Isso não substitui a conclusão das demais PRs nem comprova ausência de outras
vulnerabilidades. O parecer geral da release continua não aprovado.

## Alterações

| Pacote | Anterior | Atual |
| --- | --- | --- |
| `@nestjs/platform-express` | 11.2.3 | 11.2.9 |
| `@nestjs/swagger` | 11.4.7 | 11.4.8 |
| `multer` | 2.3.0 | 2.5.0 |
| `sharp` | 0.35.4 | 0.35.5 |
| `socket.io` direto | 4.8.3 | 4.8.4 |
| `engine.io` em todos os caminhos instalados | 6.6.9 | 6.6.11 |
| `body-parser` | 2.3.0 | 2.4.0 |
| `firebase-admin` | 14.5.0 | 14.5.1 |
| `@google-cloud/firestore` opcional | 9.4.0 | 9.4.1 |
| `qs` | 6.16.0 | 6.17.1 |
| `fast-uri` | 3.1.7 | 3.1.9 |

O patch upstream do Firestore atualiza sua dependência `firestore-api` e elimina
a cadeia antiga Google GAX/Gaxios/Rimraf/Glob do grafo de produção. Swagger passa
a usar js-yaml 5.5.0. Os binários Sharp/libvips das plataformas suportadas foram
atualizados no lockfile. Não há migração principal do NestJS nem novo override;
o override existente `multer: "$multer"` continua unificando o interceptor e o
pacote direto na versão corrigida.

Também foram aplicados patches compatíveis de desenvolvimento: Handlebars
4.7.9 → 4.7.10 e brace-expansion das linhas 1/2/5 → 1.1.22/2.1.8/5.0.13.
Isso remove os alertas critical/high que continuavam na auditoria completa.
Não foi usado `audit fix --force`.

A configuração dos parsers foi extraída para `configureHttpParsers`, usada pelo
bootstrap e pelos testes. Preserva os limites de 1 MB, o formulário com `extended`
e os bytes originais de webhook. Não altera regras de negócio ou limites dos
uploads de operação/PMOC; a proteção de streaming/imutabilidade continua na PR-09.

Referências dos problemas corrigidos:
[body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828),
[Engine.IO](https://github.com/advisories/GHSA-2gc4-cqfq-p2gv),
[Multer](https://github.com/advisories/GHSA-q7qp-rjg7-q26m),
[uploads interrompidos](https://github.com/advisories/GHSA-3pph-fpjx-jg34) e
[Sharp](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).

## Validação

- Instalação limpa com `npm ci --no-audit`, seguida de `npx prisma generate`.
  A geração é necessária após remover `node_modules`, como já ocorre no Dockerfile.
- Build do backend e ESLint dos arquivos alterados passaram.
- Suíte completa: 247 suítes, 243 passaram e 4 falharam; 1.962 testes passaram e
  15 falharam. As quatro suítes e as 15 falhas são as mesmas da revisão inicial:
  relógio/fixtures de Stripe e mudança de plano, matcher de senha e providers
  ausentes no módulo de teste de roteamento. A PR-03 mantém esse trabalho.
- Sete regressões novas passaram dentro da suíte: JSON e gzip válido/raw body;
  gzip com lixo após o frame; JSON inválido e excesso de tamanho, comprimido ou
  não; formulário; upload válido/excesso/arquivos extras/multipart truncado;
  desconexão no upload; handshake e upgrade Engine.IO. O último verifica um `sid`
  v4 existente, recusa upgrade v3 ou sem `EIO` e aceita v4, em vez de testar
  somente o primeiro handshake. O limite multipart reduzido é próprio do fixture.
- A validação local usou Node 25.1.0/npm 11.18.0. A validação separada da imagem
  passou em Node 22.23.5/Linux x64, UID 1001. Build e prune de produção passaram,
  com zero alertas após o prune. O smoke sem rede externa confirmou imagem
  QR/SVG→PNG pelo Sharp, hash/verificação Argon2, carregamento Firebase/SES,
  raw body intacto e recusa de gzip inválido seguida de resposta saudável.
  Não é uma inicialização da API completa com banco nem teste de entrega cloud.

Resultados e checksum do lockfile estão na
[evidência estruturada](evidence/pr-01-backend-dependencies.json). As suítes E2E
com banco não foram repetidas nesta PR; seus resultados anteriores e a correção
da baseline permanecem na PR-03. Não houve envio SES, push, cobrança ou implantação.

## Alertas de desenvolvimento restantes

`npm audit` completo ainda aponta **19 pacotes de desenvolvimento: 17 moderate e
2 low; zero high/critical**. Não estão no grafo sinalizado por `--omit=dev`.
Os problemas raiz são Glob, Minimatch e Deepmerge; os demais avisos se propagam
para Jest, CLI, TypeScript ESLint e fork-ts-checker-webpack-plugin.

Glob/Minimatch envolvem custo de traversal/expansão de padrões; Deepmerge envolve
merge de objetos não confiáveis. Os caminhos identificados são ferramentas de
build, lint e teste com configuração do repositório, sem entrada de tenant nesses
usos. Isso reduz o alcance direto na API, sem tornar a cadeia de desenvolvimento
isenta de risco. A atualização coordenada dessas ferramentas e a política de
execução da CI pertencem à PR-03. Não se força uma versão principal transitiva
para simplesmente remover o alerta.

## Reproduzir

Na pasta `backend`:

```sh
npm ci
npx prisma generate
npm audit --omit=dev
npm run build
npx eslint src/main.ts src/configure-http-parsers.ts src/common/transport-dependencies.http.spec.ts
npm test -- --runInBand --watchman=false
```

O último comando ainda encerra com código 1 pelas 15 falhas preexistentes
explicitadas acima. Para executar somente as sete regressões desta PR:

```sh
npm test -- --runInBand --watchman=false src/common/transport-dependencies.http.spec.ts
```

O teste HTTP requer permissão para portas locais. O patch do Admin SDK nesta PR
não implementa nem qualifica o push real; esse aceite permanece na PR-06.

Na raiz do repositório, para repetir a imagem e o smoke Node 22/Linux:

```sh
docker build --target runner --tag orbit-pr01-api:review --file backend/Dockerfile backend
docker run --rm --interactive --network none orbit-pr01-api:review node < backend/test/support/production-dependencies-smoke.cjs
```
