FROM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS dependencies

WORKDIR /app
ENV NODE_ENV=development

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
# A tipografia dos documentos. `registerFonts` a procura em
# `process.cwd()/assets/fonts`, e o `tsc` não copia arquivo que não é código.
COPY assets ./assets

RUN npx prisma generate
# Type checking the generated Prisma client needs more than Node's default heap in CI.
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build

FROM builder AS migrator

ARG ORBIT_COMMIT_SHA=unknown
ARG ORBIT_BUILD_TIME=unknown
LABEL org.opencontainers.image.revision=$ORBIT_COMMIT_SHA \
  org.opencontainers.image.created=$ORBIT_BUILD_TIME \
  org.opencontainers.image.source="https://github.com/allbluelabs/orbit"
ENV ORBIT_COMMIT_SHA=$ORBIT_COMMIT_SHA
ENV ORBIT_BUILD_TIME=$ORBIT_BUILD_TIME

# Migrar, provisionar e reconciliar os catálogos obrigatórios são o mesmo passo,
# nesta ordem.
#
# O provisionamento roda **depois** para que uma tabela criada pela migration
# recém-aplicada já receba os GRANTs do papel de runtime — sem passo manual
# depois do `docker compose up`. É idempotente: rodar de novo reconcilia.
#
# A migration popula o catálogo comercial. O script de planos só vincula os
# Price IDs do Stripe disponíveis na primeira inicialização.
#
# O catálogo oficial de artefatos entra pelo seed: os sete
# modelos do Orbit — Ordem de Serviço, PMOC, RVT, Laudo Técnico, Qualidade do
# Ar, Recibo e Orçamento — são o que a operação usa para emitir documento. Sem
# eles a tela de Modelos abre vazia numa instalação nova, e o passo que os
# criava era manual (`npm run seed:artifact-templates`), o que significa que em
# algum ambiente ele não foi dado.
#
# É aqui e não na subida da API por um motivo de segurança: escrever template
# global exige `app_is_platform_admin()` na política de RLS, e o runtime conecta
# com o papel restrito `orbit_app`, sem BYPASSRLS — por decisão da PR-26.6, que
# `DATABASE_ENFORCE_RESTRICTED_ROLE` transforma em erro de inicialização. A
# credencial administrativa existe neste passo, e só nele.
#
# Os papéis de sistema de cada organização são acompanhados ao catálogo pelo
# mesmo motivo: eles são copiados quando a organização nasce, e sem este passo
# uma permissão nova valia só para quem se cadastrasse depois. Foi o que deixou
# o técnico de campo das organizações antigas sem `pmoc.execute`. Só acrescenta.
USER node
CMD ["sh", "-c", "DATABASE_ROLE_BOOTSTRAP_ONLY=true node dist/src/scripts/provision-database-roles.js && ./node_modules/.bin/prisma migrate deploy && node dist/src/scripts/provision-database-roles.js && node dist/src/scripts/seed-plan-catalog.js && node dist/src/scripts/seed-artifact-templates.js && node dist/src/scripts/reconcile-team-roles.js"]

FROM builder AS production-dependencies

RUN npm prune --omit=dev

FROM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS runner

ARG ORBIT_COMMIT_SHA=unknown
ARG ORBIT_BUILD_TIME=unknown
LABEL org.opencontainers.image.revision=$ORBIT_COMMIT_SHA \
  org.opencontainers.image.created=$ORBIT_BUILD_TIME \
  org.opencontainers.image.source="https://github.com/allbluelabs/orbit"

ENV NODE_ENV=production
ENV PORT=5001
ENV ORBIT_COMMIT_SHA=$ORBIT_COMMIT_SHA
ENV ORBIT_BUILD_TIME=$ORBIT_BUILD_TIME
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 orbit \
  && useradd --system --uid 1001 --gid orbit orbit

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/dist ./dist
COPY --from=production-dependencies /app/package.json ./package.json
# Sem as fontes na imagem, `registerFonts` cai no apelido de Helvetica e **todo**
# documento premium sai com a tipografia errada — quando não estourava `ENOENT`,
# antes de o apelido existir. São ~430 KB de TTF, e o desenho depende deles.
COPY --from=production-dependencies /app/assets ./assets

USER orbit
EXPOSE 5001

CMD ["node", "dist/src/main.js"]

FROM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS backup-build
WORKDIR /app
COPY ops/backup-node/package*.json ./
RUN npm ci --ignore-scripts
COPY src/scripts/backup/orbit-backup.ts ./
RUN ./node_modules/.bin/tsc --target ES2022 --module commonjs --skipLibCheck --strict \
      --outDir /compiled orbit-backup.ts \
  && npm prune --omit=dev --ignore-scripts --offline

FROM golang:1.27.4-alpine AS backup-crypto
WORKDIR /src
COPY ops/backup-crypto/go.mod ops/backup-crypto/go.sum ./
RUN go mod download
COPY ops/backup-crypto/main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /orbit-backup-crypto .

FROM postgres:17.12-bookworm AS pg-tools

FROM pg-tools AS backup
ARG ORBIT_COMMIT_SHA=unknown
ARG ORBIT_BUILD_TIME=unknown
LABEL org.opencontainers.image.revision=$ORBIT_COMMIT_SHA \
      org.opencontainers.image.created=$ORBIT_BUILD_TIME
ENV NODE_ENV=production
ENV ORBIT_COMMIT_SHA=$ORBIT_COMMIT_SHA
WORKDIR /app
RUN mkdir -p /scratch && chown 1001:1001 /scratch
COPY --from=backup-build /usr/local/bin/node /usr/local/bin/
COPY --from=backup-build /app/node_modules ./node_modules
COPY --from=backup-build /compiled/orbit-backup.js ./orbit-backup.js
COPY --from=backup-crypto /orbit-backup-crypto /usr/local/bin/
RUN node --version && pg_dump --version && pg_restore --version && psql --version
USER 1001:1001
ENTRYPOINT ["node", "orbit-backup.js"]
CMD ["backup"]

FROM runner AS final
