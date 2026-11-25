# Secrets runbook

## Nunca imprimir

Não use `docker compose config`, `set -x`, dump de environment, stack trace com
DSN ou comandos que ecoem valores. Gates devem registrar somente nome da chave,
presença, versão e resultado. `.env` real, tokens, OTPs, URLs assinadas e
artefatos de cliente nunca são versionados.

## Rotacionáveis

- `JWT_ACCESS_SECRET`: rotacione com janela planejada; sessões existentes podem
  ser invalidadas. Em incidente, force logout e audite refresh tokens.
- `ENCRYPTION_KEY`: exige versão e re-encriptação controlada antes de retirar a
  chave anterior. Nunca troque a chave sem inventário dos ciphertexts.
- `STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET`: rotacione no provider, use
  sobreposição curta e valide assinatura/dedupe antes de revogar a anterior.
- AWS SES (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` e, para credenciais
  temporárias, `AWS_SESSION_TOKEN`), VAPID, DB e credenciais do admin: rotação
  padrão do secret manager, com smoke específico e revogação da versão anterior.

## Segredo de domínio long-lived

`TRIAL_FINGERPRINT_SECRET` não é um segredo operacional comum. Ele produz
fingerprints estáveis usados para impedir repetição de trial. Troca direta muda
a identidade derivada e pode reabrir elegibilidade indevidamente.

Regras:

1. gere ao menos 32 caracteres aleatórios fora do repositório;
2. preserve em secret manager versionado e com backup restrito;
3. não compartilhe com JWT/AES;
4. não use default ou placeholder;
5. para rotação futura, introduza `fingerprint_key_version`, dual-read e
   migração controlada antes de remover a versão anterior.

## Incidente de exposição

1. preserve evidência e identifique escopo/horário sem copiar o valor;
2. revogue ou isole a credencial;
3. rotacione conforme a classe acima;
4. procure uso indevido em audit/logs redigidos;
5. invalide sessões ou reprocessamentos quando aplicável;
6. registre owner, prazo e conclusão.

O bootstrap de produção valida JWT, AES, trial secret e origem. Mensagens de
falha citam somente a chave, nunca o conteúdo.


## Separação de credenciais de banco

- A API e os workers recebem somente `APP_DATABASE_URL`. Produção recusa URL
  administrativa e senhas de bootstrap no ambiente do processo.
- `DATABASE_URL` administrativa é injetada somente no job efêmero de migrations
  ou no bootstrap explícito. O frontend não recebe nenhuma credencial do banco.
- Para rotacionar a senha restrita, mantenha o acesso administrativo no cofre,
  pause writers e injete a nova `APP_DATABASE_PASSWORD` no migrator e na release.
  Execute o migrator para reconciliar o papel, recrie API/workers e valide
  readiness, login web/mobile e isolamento antes de reabrir writers. Essa troca
  pode interromper conexões antigas: exige janela operacional, não edição pelo
  painel HTTP. Para evitar janela futura, planeje dois papéis e grants equivalentes.
- Uma rotação do administrador não exige trocar a URL do runtime. Atualize o
  cofre e o ambiente do PostgreSQL/jobs conforme o procedimento do banco;
  alterar apenas `POSTGRES_PASSWORD` no Compose não muda a senha de um volume
  PostgreSQL já inicializado.
- `PLATFORM_ADMIN_PASSWORD` é removida do arquivo operacional após bootstrap.
  Não compartilhe a senha com API/worker para executar manutenção.

Nenhum segredo foi rotacionado automaticamente pelo PR-14. As credenciais R2,
SES, SNS, Stripe e Firebase continuam limitadas aos processos que as utilizam.
