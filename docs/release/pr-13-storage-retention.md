# PR-13 — Retenção operacional e exclusão física de mídia

Achado **F13**, base limpa `f7bdc7d`, implementação local em 17/11/2026.
Sem push, merge, deploy, purge real ou acesso a banco/bucket de cliente.

## O que foi corrigido

O adapter S3/R2 já tinha `DeleteObjectCommand`; a lacuna não era um método
inexistente. Havia dois consumidores sem claim compartilhado, remoção do job no
sucesso (sem prova persistente), dependência do contexto de requisição no worker,
locais legados inferidos do provider atual e inventário incompleto. O primeiro
ensaio real também reproduziu uma divergência entre a allowlist SQL e a política
operacional, que impedia o purge inteiro.

- Consumidor único com claim PostgreSQL, lease, ACK/retry com token, backoff,
  respeito ao flag de workers e shutdown que aguarda trabalho ativo. I/O de
  storage fica fora da transação. Provider divergente, ownership conflitante e
  exclusão sem purge confirmado ficam bloqueados, com motivo explícito.
- `tenant_data_purges` separa banco excluído de arquivos pendentes/concluídos.
  Jobs concluídos permanecem auditáveis; DELETE seguido de HEAD confirma ausência.
  Crash após DELETE e perda de ACK não perdem a referência nem exigem recriar dados.
- Claim/commit revalidam acesso pago, prazo, reativação, checkout e observações
  financeiras pendentes/dead-letter. Mutações canônicas de cobrança/assinatura
  compartilham o fence por organização. Uploads/renderizações em execução
  impedem o purge, e nova admissão de upload é recusada após o claim.
  Adiamento/reativação abortam o claim.
- Inventário inclui arquivos canônicos, fontes originais, anexos de operações,
  documentos gerados, snapshots de contrato PMOC e anexos antigos de execução.
  UUID de `file_id` não vira chave física. Localização desconhecida bloqueia antes
  de apagar registros; os novos writers persistem a proveniência de storage.
- Migration aditiva atualiza a allowlist de purge, incluindo admissões de upload,
  links de orçamento e agendas de equipamento PMOC. Prazo, claim e pagamento
  continuam protegidos na rotina SQL; conta/legal/financeiro ficam fora dela.
- DELETE/HEAD/GET do adapter S3 têm deadline total; LOCAL deixa de interpretar
  qualquer erro de inspeção como arquivo ausente e restringe bucket/chave à raiz.
- Mídia pública R2 só conclui após aceite do purge direcionado na Cloudflare.
  Sem configuração, registra `CACHE_PURGE_NOT_CONFIGURED`; falhas transitórias
  mantêm retry. Usa o transporte protegido da PR-11 e origem fixa da API.
- Preflight padrão READ ONLY, verificação de HEAD antes/depois pela outbox e scan
  limitado de candidatos a órfãos. Opção explícita só atesta localização legada
  após comparação de bytes/SHA-256; não apaga órfãos. Migração R2 existente passa
  a registrar provider/bucket dos formatos legados após verificar a cópia.
- Backup passa a exportar ledger mínimo, com locators protegidos e publicação
  atômica da cópia mais recente. Política de 14 dias de snapshots, cópia externa,
  versionamento S3 e restore em quarentena estão documentados.

Sem dependências novas ou mudança de telas web/mobile. Os dados adicionais de
proveniência permanecem internos aos fluxos de leitura já existentes.

## Evidência e aceite

- **273 suítes / 2.278 testes unitários aprovados**.
- **52 suítes / 670 testes E2E aprovados** na repetição integral final.
- **3 suítes / 77 testes** no runner de storage LOCAL/MinIO/S3/R2, incluindo
  alias de bucket, uploads em andamento e regressões de upload/evidência.
- **2 suítes / 15 testes** na repetição isolada de retenção e atribuição de
  técnicos, com segundo tenant próprio e todas as asserções mantidas.
- Nest build, TypeScript completo, lint dos arquivos alterados, fronteiras de
  contratos e **75 códigos de erro públicos** aprovados; shell do backup e diff
  sem erros. Probe de schema validou três índices, RLS forçada do ledger e o SQL
  de exportação. Preflight relacional: **199 regras / zero conflitos**.
- Runtime local Node **25.1.0**. Nova imagem Node 22/Linux e gates consolidados
  do SHA final ficam na CI/PR-19. Não houve build web/mobile ou publicação nova.


Resultados consolidados estão em [evidência estruturada](evidence/pr-13-storage-retention.json).
O runner cria PostgreSQL 17.11 descartável, aplica as 124 migrations e provisiona
150 tabelas para `orbit_app` sem SUPERUSER/BYPASSRLS. O MinIO é um binário compilado
da versão oficial fixada `RELEASE.2025-10-15T17-29-55Z`; os perfis MINIO, S3 e R2
exercitam o adapter AWS real nesse endpoint local. Isso não é um teste de acesso
à conta Cloudflare ou de exclusão em buckets reais.

Cobertura nova: período pago/prazo de 30 dias, todos os formatos de mídia,
reativação e adiamento entre claim/commit, reconciliação financeira, falha e
provider divergente, corrida entre réplicas, ACK perdido/lease antiga, tenant
vizinho (incluindo alias R2), cache pendente e reconciliação/atestado de legado.
O scanner deixa o candidato a órfão intacto e hash divergente impede o atestado.

A primeira execução revelou fixture PMOC com unidade de frequência inválida;
foi corrigida para o contrato `MONTHS`. A seguinte expôs o erro real
`RETENTION_TABLE_NOT_ALLOWED`; a correção está na nova migration, sem reescrever
migrations aplicadas. A suíte completa também revelou uma fixture de atribuição
que escolhia qualquer papel e dependia de um usuário estrangeiro deixado por
outra suíte. Agora ela usa FIELD_TECHNICIAN explícito e cria seu próprio segundo
tenant com técnico habilitado. Guards, quotas, RLS e asserts de segurança foram
mantidos.

Guia de rollout, variáveis e operação: [retenção de storage](../../backend/docs/storage-retention.md).
Antes de habilitar no ambiente real, aplicar migration/provisionamento em janela
controlada, inspecionar/atestar locators legados e configurar token **Zone / Cache
Purge** restrito à zona do CDN. Não foram consultados nem alterados segredos reais.
O aceite externo de CDN/buckets, a política de cópia externa/versionamento e o
ensaio de restore continuam obrigatórios na PR-19. A aplicação inteira ainda
não está aprovada para produção somente por este PR.
