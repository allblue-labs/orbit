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
- SMTP, VAPID, DB e credenciais do admin: rotação padrão do secret manager, com
  smoke específico e revogação da versão anterior.

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

