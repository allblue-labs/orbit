# Marca nos e-mails e recuperação de senha — 17/11/2026

Base: 954b15f. Escopo: todos os templates transacionais existentes, validade e
consumo de links de redefinição de senha, experiência de recuperação e staging.

## Diagnóstico

Antes das mudanças, uma reprodução HTTP com PostgreSQL real e papel orbit_app
restrito confirmou 204 no primeiro uso e 400 em três reusos, sem nova alteração
da credencial. Não foi reproduzida uma segunda troca efetiva com o mesmo token
nesse checkout. A página podia, entretanto, abrir novamente o formulário sem
consultar o estado do token, e erros do reset usavam o código genérico de validação.
A validade da recuperação por e-mail era 30 minutos; a de links manuais, 24 horas.

## Implementação

- Os seis templates (boas-vindas, confirmação, recuperação, senha alterada,
  plano expirado e limites) usam ambas as logos fornecidas no repositório. PNGs
  derivados e otimizados são empacotados em assets/email, com script reproduzível.
  Imagens inline CID são anexadas pelo SDK SESv2, com ContentType image/png,
  ContentDisposition INLINE e ContentTransferEncoding BASE64. Não dependem de
  CDN, recursos de terceiros ou URLs de rastreamento. Texto alternativo e versão
  em texto simples permanecem disponíveis.
- A política canônica dos links de senha passa a ser três horas. Recuperação,
  configuração inicial por provisionamento e links manuais da equipe usam o
  mesmo prazo. Verificação de e-mail continua com 24 horas. Links anteriores não
  recebem extensão: valem até o menor entre expires_at e três horas de created_at.
- A consulta do token exige usuário ativo, não excluído e com credencial. O
  consumo compara id, usuário, used_at, expires_at e idade com o relógio do
  PostgreSQL, em uma única atualização condicional. Senha, consumo, revogação de
  sessões e intenção do aviso de segurança são confirmados na mesma transação.
  Apenas uma réplica vence quando chegam duas solicitações simultâneas.
- Novo POST /identity/password/reset/validate verifica sem consumir o link.
  O token vai somente no corpo, nunca em query nova. Responde 204/no-store ou
  400/PASSWORD_RESET_INVALID com mensagem pública pt-BR. Recebe os limites
  compartilhados de autenticação; o BFF libera somente esse método/caminho.
- A tela verifica antes de mostrar o formulário, remove o segredo da URL,
  apresenta link inválido/expirado/usado e oferece novo envio. Falhas transitórias
  permitem tentar novamente. Após sucesso, remove os campos e mostra confirmação
  definitiva com botão de login. Um consumo em outra aba também é recusado ao salvar.
- Cooldown, deduplicação, limites de envio, outbox e supressão permanecem ativos.
  Usuários internos não ganham envios transacionais por essa alteração. Não há
  novas envs, permissões AWS, buckets ou migrations.

## Qualificação

- Backend: 275 suítes, 2.301 testes unitários aprovados.
- Frontend: 73 arquivos, 699 testes unitários aprovados.
- Integração: quatro suítes, 55 testes aprovados, PostgreSQL real descartável,
  orbit_app sem SUPERUSER/BYPASSRLS e duas réplicas da API.
- Navegador: cenários de fragmento/query legado, conclusão definitiva, reabertura
  do link, recusa de token inexistente pelo BFF real, disputa entre abas e falha
  transitória. Oito cenários aprovados.
- TypeScript nas duas camadas, ESLint dos arquivos alterados e build Next
  standalone de produção aprovados. Arquivos PNG/CID conferidos em todos os
  templates e no comando SES produzido pelo sender.

A publicação e as verificações de runtime do staging serão registradas após
aplicar as imagens imutáveis. Os testes não enviam e-mails reais nem alteram
contas do servidor. Sem Git push.

Referências: [SES inline attachments](https://docs.aws.amazon.com/ses/latest/dg/attachments.html),
[OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
