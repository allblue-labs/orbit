# Categorias de e-mail e formulário público — 17/11/2026

Base ceb244a. Separação dos remetentes de conta/segurança, avisos e suporte por
envs, preservando fallback legado e a política de e-mails do owner inicial.
O suporte público é um fluxo distinto: somente a equipe recebe a mensagem;
nenhuma confirmação automática é disparada ao visitante.

A landing ganhou a seção de contato, responsiva e ligada ao rodapé, com nome,
e-mail, assunto e mensagem, validação pt-BR, loading e confirmação. To fixo em
contato@allblue-labs.com por env; From suporte-orbit; Reply-To visitante validado.
Logos inline do Orbit e Allblue são compartilhadas com os demais templates.

Fila cifrada com RLS, limite por origem/e-mail/dia, chave de idempotência,
lease entre réplicas, até seis tentativas, correlação SES e limpeza do payload.
Apenas a nova migration aditiva é necessária; credenciais e buckets permanecem.

O feedback SNS continua verificando conta, região, fonte e ARN exatos. O mapa
inclui os remetentes de categoria e o legado. Descoberta/preflight são somente
leitura; a checagem AWS no staging confirmou os quatro endereços verificados:
contato por identidade própria e os três aliases pela identidade do domínio.

Validação local:

- Backend: 276 suítes / 2.312 testes unitários aprovados.
- Frontend: 73 arquivos / 702 testes unitários aprovados.
- PostgreSQL real restrito: três suítes / 45 testes de contato, outbox de conta
  e SES/SNS aprovados, com duas réplicas.
- Navegador: 12 cenários de landing/contato aprovados, incluindo BFF/API reais,
  campos inválidos, reenvio com mesma chave, loading e largura de 375px.
- Next standalone de produção e TypeScript aprovados; schema Prisma válido.
- Nenhum e-mail real enviado pelos testes locais.

[Configuração e comportamento](../../backend/docs/email-categories-and-contact.md).
A aplicação no staging e as evidências finais serão registradas após a publicação.
Sem Git push.
