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
operador: links e PDFs por essa superfície exigem autoria do orçamento, origem
mobile, organização e unidade acessíveis. As consultas e transações continuam
sujeitas às políticas RLS do PostgreSQL.

## Aceite e acompanhamento

Após gerar a proposta, o operador pode compartilhar seu PDF ou coletar a
assinatura e a autorização expressa do cliente. A confirmação usa
`POST /public/quotes/proposals/:token/response`, com decisão `APPROVE`, nome,
assinatura PNG e consentimento. Esse serviço já conserva a prova, aprova o
orçamento, gera o PDF assinado e registra a notificação ao owner.

O orçamento fica imediatamente disponível na web, em Financeiro → Orçamentos,
usando as mesmas tabelas, estados, auditoria e eventos do fluxo comercial.

Publicar a API e o aplicativo atualizados. Não há novas variáveis de ambiente
nem migration específica para este ajuste.
