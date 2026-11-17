# PR-14 — Menor privilégio no deploy

Implementação local em 17/11/2026, sobre `f8ea544`. Complementa o hardening de
staging de 12/11, preservando a topologia Nginx, os contratos web/mobile e os
providers já configurados. Não houve push, deploy ou rotação de segredos nesta PR.

## Resultado

- A API recebe somente `APP_DATABASE_URL`. Produção recusa `DATABASE_URL`,
  `POSTGRES_PASSWORD`, `PLATFORM_ADMIN_PASSWORD` e `OWNER_PASSWORD`, inclusive
  quando seriam variáveis sem uso. Conexão restrita explícita é obrigatória;
  mensagens de configuração não incluem valores.
- A verificação do papel do PostgreSQL é obrigatória em produção. Recusa
  SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE, REPLICATION, associação a papéis
  administrativos/permissivos e ownership do banco, schema público ou objetos
  da aplicação. Também identifica memberships com NOINHERIT, pois elas podem
  permitir assumir outro papel. Falha na consulta impede inicialização.
- Credencial administrativa permanece somente no migrator e bootstrap explícito.
  Migrate e bootstrap usam UID/GID 1000, filesystem somente leitura, cap_drop ALL,
  no-new-privileges, tmpfs limitado e limites de CPU/memória/processos. O boot
  normal não cria usuários; reconciliar catálogos continua idempotente.
- API/frontend usam UID/GID 1001. O código pertence a root; somente os tmpfs
  previstos são graváveis. As bases Node fixam 22.23.5 por digest verificado.
- A API escuta em 0.0.0.0:5001 dentro do container e publica 127.0.0.1:6001;
  frontend publica 127.0.0.1:7070 e PostgreSQL permanece na rede interna sem
  porta publicada. API_HOST de execução local não altera o bind no container.
- Preflight compartilhado pelo deploy e pelos testes recusa regressões de
  credenciais, privilégios, montagem do host/socket, root, portas, redes, limites,
  filesystem, builds no servidor e referências sem digest. O deploy verifica
  também o profile admin; o job offline de mídia continua separado.
- CI ganhou testes do contrato e um gate com imagens reais, banco vazio,
  migrations, bootstrap explícito, autenticação WEB/MOBILE, criação de
  cliente/equipamento, resolução de QR e login pelo BFF com cookies Secure.

## Evidências

[Registro estruturado](evidence/pr-14-least-privilege-deploy.json).

| Verificação | Resultado |
| --- | --- |
| Configuração de produção | 36 testes unitários aprovados |
| Papel de runtime e isolamento RLS, PostgreSQL real | 2 suítes / 28 testes aprovados |
| Compose canônico e mutações de configuração insegura | 3 testes / 18 mutações aprovados |
| Builds de produção API, migrator e Next standalone | Linux/amd64 aprovados; auditoria npm da API sem vulnerabilidades |
| TypeScript backend e lint dos arquivos TypeScript alterados | Aprovados |
| Endpoints/configuração/comunicação mobile | 66 testes aprovados |
| Nginx real isolado | Sintaxe, rotas, headers, spoofing e rate limiting aprovados |
| Upload na imagem Next de produção | 8 verificações aprovadas |
| Compose com imagens reais e credenciais fictícias | 8 grupos de verificações aprovados |

O ensaio com imagens aplicou as 126 migrations num PostgreSQL vazio e confirmou
152 tabelas com SELECT concedido ao runtime. Antes do bootstrap explícito, a
tabela de usuários estava vazia. A API funcional não tinha nenhuma das quatro
credenciais administrativas no ambiente; verificou-se também o filesystem
somente leitura e a impossibilidade de escrever no código como usuário runtime.
Os testes de privilégios alteram somente um papel descartável em outro banco
exclusivo e removem seus objetos ao terminar.

## Limites e próximo rollout

O Docker local ficou sem espaço para inicializar o volume descartável. O ensaio
final usou `--postgres-tmpfs`, com PostgreSQL real em memória; não foi uma falha
da API. O Compose de implantação continua usando volume persistente, e o gate
CI usa esse modo por padrão. Nenhum volume ou imagem de outro projeto foi
removido. Não há comprovação nova de restore/durabilidade nesta PR.

Ao atualizar staging, copie juntos `deploy.sh` e `deployment_preflight.py` para
o diretório de scripts e use novas imagens por digest. Instalações fora deste
Compose devem retirar as quatro variáveis administrativas de API/workers antes
da subida; não desative a verificação para contornar privilégios indevidos.
Rotação de banco e política de segredos estão no
[runbook](secrets-runbook.md); esta entrega não rotacionou credenciais reais.

A ativação externa de CDN/legado/backup da PR-13 continua pendente e a retenção
automática deve permanecer desativada no staging. A PR-19 continua sendo o gate
final de produção. O próximo item de implementação é PR-15.
