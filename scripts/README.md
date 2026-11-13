# Verificação reproduzível

Requisitos: Node 22.23.5, npm, Docker ativo e dependências instaladas com
`npm ci` em `backend/` e `frontend/`. Mobile: Flutter 3.47.2 e
`flutter pub get --enforce-lockfile`. O lock do SDK usa `intl` 0.20.3.

A partir da raiz:

```sh
node --test scripts/audit-policy.test.mjs
node scripts/audit-policy.mjs backend
node scripts/audit-policy.mjs frontend
node scripts/verify-integrations.mjs backend
node scripts/verify-integrations.mjs browser
node scripts/verify-integrations.mjs mobile
```

Os projetos também expõem `npm run test:e2e`. Argumentos adicionais são
encaminhados a Jest/Playwright/Flutter. Para escolher outro executável Flutter,
defina `ORBIT_FLUTTER_BIN=/caminho/flutter`.

Cada execução cria seu próprio PostgreSQL, senha aleatória, banco e storage
LOCAL temporários. As 111 migrations, catálogos e papel restrito `orbit_app`
são aplicados antes dos testes. O runner não consome DATABASE_URL nem
credenciais de cloud do ambiente do desenvolvedor. As portas são aleatórias e
publicadas apenas em loopback. O cleanup exige a identidade do banco criado
pelo runner; não o execute contra um banco compartilhado.

Backend usa um build temporário por execução. Web também compila o Next em
produção, executa a saída standalone com seus assets, cria fixtures sintéticas pela API autenticada e executa separadamente
os testes com upstream sintético da PR-02. Não execute dois runners web no
mesmo checkout: eles compartilham `.next`. Mobile sobe API real, habilita o
worker de documentos e reprova se a API ou um dado obrigatório estiver ausente.
Não há dependência de staging, Stripe, SES, Firebase, R2 ou dados de clientes.

O `finally` encerra os serviços e remove somente o container e diretório
criados nesta execução, inclusive após falhas e SIGINT/SIGTERM. Um encerramento
forçado por SIGKILL ou queda de energia exige remover manualmente apenas os
recursos `orbit-e2e-<identificador>` / `orbit-integration-<identificador>` órfãos.

A pipeline `.github/workflows/ci.yml` usa Actions fixadas por SHA, acesso de
leitura, sem segredos de implantação. Executa lint sem mutação, tipagem,
auditoria, suites, migrations/RLS, builds web/backend e compilação Android de
desenvolvimento. A execução remota ocorre depois do push feito pelo owner.

## Exceções de auditoria

Produção exige zero advisories conhecidos. A política falha em indisponibilidade
do npm audit, alertas novos, high/critical, versões/caminhos não revisados ou
exceções vencidas. `audit-exceptions.json` permite temporariamente apenas
Glob/Minimatch/Deepmerge do tooling, até 26/11/2026. Não é uma supressão geral
de moderate. Os testes da política cobrem esses bloqueios.

As versões compatíveis atuais de Nest CLI/Jest/TypeScript ESLint ainda trazem
essas dependências. Glob corrigido requer 14.0.2 e Minimatch 11.0.1; Deepmerge
4.3.1 ainda não dispõe de correção publicada no advisory. Não forçamos majors
transitivas incompatíveis com os consumidores. O próximo responsável deve
reavaliar os upstreams antes do vencimento; o gate bloqueará depois disso.
Padrões/configurações usados pelo tooling são do repositório, e CI não recebe
credenciais de produção. A imagem de migrator inclui tooling: esta exceção não
significa que essas bibliotecas estejam ausentes de toda imagem operacional.

Fontes: [Glob](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4),
[Minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249),
[Deepmerge](https://github.com/advisories/GHSA-gcqx-w48m-w2h4).
