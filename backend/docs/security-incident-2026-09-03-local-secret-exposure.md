# Incidente local de exposição de configuração — 2026-09-03

## Contexto

Durante o closure gate do PR-MB-07, uma inspeção local do Docker Compose
materializou valores de configuração no transcript da sessão. O transcript não
é um arquivo do repositório, mas os valores foram tratados como expostos.

Categorias afetadas:

- credenciais administrativa e de runtime do PostgreSQL;
- senha do administrador da plataforma;
- segredo de assinatura JWT;
- chave de criptografia da aplicação.

## Contenção e rotação

- as duas credenciais PostgreSQL foram rotacionadas e as anteriores deixaram de
  autenticar;
- a senha administrativa foi atualizada pelo seed oficial, com revogação das
  sessões existentes;
- o segredo JWT foi substituído sem grace period, invalidando tokens antigos;
- os fatores MFA existentes foram recriptografados atomicamente de AES-256-GCM
  para uma nova chave e validados antes da retirada da chave anterior;
- materiais temporários e o backup cifrado da transição foram removidos depois
  das provas.

## Validação

- credenciais e JWT anteriores recusados;
- login, access token e refresh novos aceitos;
- dados MFA existentes legíveis somente com a chave nova;
- API saudável, migrations atualizadas e runtime role restrita;
- E2E dedicado MB-07 e smoke FL-04 aprovados;
- RLS/FORCE RLS e contadores de integridade MB-07 validados;
- nenhum valor antigo ou novo encontrado nos arquivos rastreados ou logs
  recentes.

## Prevenção

Não usar saída integral de `docker compose config` em diagnósticos. Validar
estrutura, presença de variáveis e estado dos serviços por consultas direcionadas
que retornem somente nomes, flags ou contagens, nunca valores resolvidos.
