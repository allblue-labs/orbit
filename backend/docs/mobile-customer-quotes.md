# Clientes e orçamentos no aplicativo

O cadastro de cliente permite incluir o endereço opcionalmente. O aplicativo
consulta `/lookups/postal-code/:cep` quando os oito dígitos são preenchidos e
permite digitação manual quando o provedor está indisponível. Ao desmarcar a
opção, o endereço não é enviado. O cadastro existente preserva o endereço fiscal
e cria o endereço de atendimento quando há logradouro e cidade.

O orçamento aberto pela ficha de cliente usa etapas equivalentes às da web:
dados gerais e equipamentos, serviços e materiais, valores, responsável técnico
e revisão. O cliente permanece selecionado durante todo o fluxo.

## API e autorização

- `GET /mobile/field/quotes/customers/:customerId/options`: endereços, equipamentos
  da unidade selecionada e responsáveis disponíveis.
- `GET /mobile/field/quotes/catalog?search=...&businessUnitId=...`: catálogo ativo,
  incluindo itens globais e da unidade selecionada. Retorna até 50 resultados por
  pesquisa; permite também cadastrar itens manuais na proposta.
- `POST /mobile/field/quotes`: cria, adiciona itens, aplica desconto e envia a
  proposta em uma transação do mecanismo comercial existente. `requestId` deve
  permanecer igual nas tentativas do mesmo envio. A chave é delimitada por
  organização e autor; reutilizá-la com conteúdo diferente resulta em conflito.
- `POST /mobile/field/quotes/:id/acceptance-link`: gera o token do aceite existente.
- `GET /mobile/field/quotes/:id/document`: baixa a proposta, com a assinatura do
  cliente após o aceite, quando aplicável.

A superfície exige acesso mobile, assinatura ativa e a capability
`quotes.manage`. O serviço autoriza owners, usuários com `quotes.manage` ou com
permissão de criar atendimentos (`operations.walk_in.create` ou
`operations.create`). Não concede permissão de gerir todo o financeiro ao
operador: links de aceite exigem autoria e origem mobile. A leitura do PDF usa
`quotes.read` e a autorização por orçamento descrita abaixo, além de organização
e unidades acessíveis. As consultas e transações continuam
sujeitas às políticas RLS do PostgreSQL.

## Aceite e acompanhamento

Após gerar a proposta, o operador pode compartilhar seu PDF quando liberado pelo
owner, ou coletar a assinatura e a autorização expressa do cliente. A confirmação usa
`POST /public/quotes/proposals/:token/response`, com decisão `APPROVE`, nome,
assinatura PNG e consentimento. Esse serviço já conserva a prova, aprova o
orçamento, gera o PDF assinado e registra a notificação ao owner.

O orçamento fica imediatamente disponível na web, em Financeiro → Orçamentos,
usando as mesmas tabelas, estados, auditoria e eventos do fluxo comercial.

## Orçamentos em Documentos (Docs)

O owner vê todos os orçamentos da organização/unidades acessíveis, em qualquer
status, inclusive rascunhos e propostas sem emissão oficial. A aprovação do cliente
não é requisito para baixar ou compartilhar o PDF.

Para outros usuários, a liberação pertence ao **orçamento**, não ao cadastro do
operador. Em Financeiro → Orçamentos → abrir a proposta, o owner encontra o painel
**Acesso no aplicativo** e o controle **Liberar para outros usuários no app**.
Ele pode liberar/revogar em qualquer status. A API `PATCH /quotes/:id/mobile-access`
aceita `{ "mobileVisible": true|false }` somente do proprietário e registra auditoria.
Não altera o conteúdo, o status, o `updatedAt` comercial ou os links de assinatura.

A opção começa desligada, inclusive nos registros existentes. A antiga permissão
`mobile.quotes.documents.read` não libera mais a biblioteca nem contorna o bloqueio
do PDF. Também não há exceção de download autenticado por ser o criador da proposta.
A autorização de envio/aceite público continua sendo um fluxo separado.

A lista e o endpoint de PDF aplicam a mesma regra e preservam RLS/escopo de unidade.
Revogar bloqueia imediatamente as novas consultas e downloads, sem novo login.
Em Docs, o status comercial aparece em português e o PDF continua disponível para
as ações de baixar/compartilhar. A lista é recarregada ao retornar à página ou
retomar o app, mantendo os filtros da consulta.

Antes de publicar a API, aplicar a migration
`20261114150000_quote_mobile_visibility`. Publicar API, frontend web e app mobile
atualizados. Não existem novas variáveis de ambiente. Este ajuste não executa deploy.

Validação: testes de API com PostgreSQL/RLS para todos os seis estados, controle
exclusivo pelo owner, valor booleano estrito, revogação, isolamento entre tenants,
preservação da versão e não utilização da permissão geral antiga. Testes mobile
cobrem o selo de status, as ações do PDF e atualização após retomada. O cenário de
navegador verifica liberação/revogação e persistência após recarregar a proposta.
