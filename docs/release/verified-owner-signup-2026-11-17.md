# Cadastro pendente até a confirmação do e-mail — 17/11/2026

Base 9d01053, após a qualificação real de SES/SNS. O envio já existia, mas a
política anterior permitia login sem confirmação. A nova exigência é aplicada
no backend e refletida no wizard, sem depender da interface para autorizar acesso.

## Mudanças

- Número e complemento opcionais no endereço da matriz, com limites 30/160,
  trim e persistência nos campos canônicos de BusinessUnit. Branco/omissão vira
  null. Consulta por CEP preserva os campos do usuário. Sem migration nova.
- POST register publica somente status EMAIL_VERIFICATION_REQUIRED e e-mail
  normalizado. Não chama AuthenticationService.login, não emite JWT/refresh,
  não cria sessão e não inicia checkout. A intenção de envio e o token de
  confirmação continuam transacionais e protegidos pela outbox SES existente.
- O BFF não grava cookies: remove cookies antigos e publica uma resposta anônima
  com campos explícitos. O browser limpa caches da sessão anterior e mostra a
  confirmação/reenvio no lugar do formulário concluído.
- O owner inicial é identificado pela procedência persistida em account_email_owners.
  Login só explica a confirmação depois de validar senha/MFA. Refresh e guard
  checam o estado atual do banco e revogam sessões pendentes, inclusive pares
  assinados antigos e respostas de rotação na janela de tolerância.
- EMAIL_VERIFICATION_REQUIRED é código público versionado, com texto pt-BR.
  A tela de login oferece a confirmação/reenvio; senha errada continua genérica.
  Confirmar o link não faz login automático: depois, usa-se a senha normalmente.
- A regra inclui owners originais antigos sem confirmação. Usuários internos e
  técnicos, inclusive com domínios virtuais, continuam seguindo sua autorização
  própria; uma chave de papel OWNER ou um sufixo de e-mail não decide essa política.
- Plano e periodicidade permanecem no provisionamento canônico. Login confirmado
  segue a navegação existente para teste elegível ou contratação pendente.
  Convites manuais não confirmam um owner já existente; recuperação de senha
  também não substitui a confirmação do endereço.

## Validação

A suíte de negócio foi adaptada para cumprir explicitamente a confirmação pela
API antes do login. O helper inspeciona token cifrado somente no PostgreSQL
descartável do runner e não instala bypass no código de produção. Os testes
específicos continuam exercitando cadastro cru, sem confirmação automática.

Cobertura nova: cadastro pendente sem sessão, números/complementos opcionais,
login WEB/MOBILE/API bloqueado, credencial incorreta genérica, JWT antigo recusado,
refresh comum e na janela de tolerância recusados, confirmação de uso único,
login/refresh após confirmação e técnico de domínio virtual não bloqueado.
Navegador cobre campos opcionais, espera pela confirmação sem checkout, resposta
real do BFF sem cookies e orientação no login do owner pendente.

Resultados: 275 suítes / 2.291 testes unitários do backend; 53 suítes / 677
integrados; 73 arquivos / 697 testes do frontend; 14 cenários de Chromium com
Next standalone de produção e PostgreSQL real. Tipos aprovados nas duas camadas,
ESLint nos arquivos alterados e git diff --check. A API também compilou na imagem
Linux/amd64 com Node 22. O reenvio ficou utilizável após o cooldown de um minuto,
com botão para voltar ao login quando o endereço já estiver confirmado.

A publicação no staging será registrada após aplicar as imagens imutáveis.
Nenhum e-mail real será disparado pelos testes automatizados; utilizam NODE_ENV=test
com PostgreSQL real isolado e orbit_app restrito. A checagem de confirmação no
backend continua ativa nesse ambiente. Sem Git push.
