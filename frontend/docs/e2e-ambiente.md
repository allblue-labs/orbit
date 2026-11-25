# Ambiente dos testes de navegador

Execute `npm ci` no backend e frontend e mantenha o Docker ativo. Então, de
`frontend/`, rode `npm run test:e2e`. O comando da raiz equivalente é
`node scripts/verify-integrations.mjs browser`.

O runner cria PostgreSQL vazio, aplica migrations, provisiona `orbit_app` sem
BYPASSRLS e sobe NestJS e Next em modo de produção, com portas aleatórias em
127.0.0.1. Storage LOCAL existe somente no diretório temporário da execução.
URLs assinadas usam a mesma porta da API. Não são usados dados ou credenciais
de uma instalação existente. Não execute dois runners web no mesmo checkout.

Os cenários históricos ainda usam nomes como `PMOC-2026-001`, `Split Cassete`,
Ana/Bruno/Carla/Diego/Elena e o checklist de manutenção preventiva. O runner
agora os cria por endpoints autenticados em `scripts/lib/browser-fixtures.mjs`.
Os demais cenários criam seus próprios recursos em `e2e/provision.ts`.
Nenhum seed de demonstração foi adicionado à aplicação em produção.

As credenciais de owner são exclusivamente sintéticas e confinadas ao banco
descartável. Os testes não desabilitam autorização, cobrança nem integridade;
fixtures pagas precisam ter pagamento confirmado e fixtures restritas precisam
ser membros reais, em vez de tentar limitar o proprietário com claims falsas.

O Playwright mantém o servidor externo à sua configuração, mas o comando padrão
agora prepara e encerra toda a pilha. `npm run test:browser` continua disponível
para diagnóstico de uma pilha de testes já preparada. O runner padrão executa
também os cinco testes de dependências da PR-02 em uma instância Next separada
com upstream sintético, evitando misturar esses mocks aos cenários de API real.

Os dados do banco descartável são removidos ao encerrar o container da execução.
Um erro de teste ou interrupção normal também aciona esse cleanup. O runner não
apaga volumes, bancos ou serviços existentes. Veja [instruções completas](../../scripts/README.md).
