# Catálogo comercial

A tabela `plans` guarda as ofertas do Orbit. O catálogo público é lido por
`GET /api/v1/plans/catalog`. A visão de cobrança da organização também inclui
as ofertas privadas vinculadas a ela. Planos desativados continuam visíveis
no catálogo correspondente como indisponíveis.

## Administração da plataforma

As operações abaixo exigem uma sessão com autoridade global
`PLATFORM_ADMIN` e permissão `platform.admin`. A interface da organização
somente consulta e seleciona ofertas.

- `GET /api/v1/platform-admin/plans` lista as ofertas e versões, inclusive as privadas.
- `PUT /api/v1/platform-admin/plans/{code}` publica uma oferta completa e registra quem fez a alteração.
- Envie `expectedVersion: 0` para publicar um código novo. Em edições, envie a versão devolvida pela leitura. Um conflito exige recarregar a oferta.
- Omitir `tenantId` publica a oferta para o público. Informar o UUID de uma organização faz a oferta aparecer somente em **Configurações → Plano e assinatura** daquela organização. O vínculo permanece fixo depois da publicação.
- Envie `isActive: false` para suspender novas contratações. Assinaturas em andamento mantêm seus termos.

Campos da publicação

| Campo | Conteúdo |
| --- | --- |
| `name`, `description` | Nome comercial e descrição apresentados aos clientes |
| `permissions` | Capacidades de acesso às rotas do produto, em chaves como `operations.read` |
| `offer.trialDays` | Quantidade de dias de avaliação, de 0 a 730. Zero desativa a oferta de avaliação |
| `offer.promotion` | Texto promocional opcional |
| `offer.prices` | Objeto com `MONTHLY`, `SEMIANNUAL` e `ANNUAL`. Cada entrada contém `amountMinor` em centavos de real e o `stripePriceId` correspondente. `listAmountMinor` opcional apresenta o preço de referência |
| `offer.entitlements` | Capacidades do produto e mapas completos `allocation` e `usage`. Use `null` para ilimitado e zero quando o recurso não tiver cota |

Use `GET` administrativo para copiar a estrutura de uma oferta e preencher
os novos valores. Um desconto é cobrado pelo valor em `amountMinor` que
corresponde ao preço vinculado no Stripe. Os termos publicados se aplicam a
novas contratações e trocas confirmadas. Para cada checkout, o Orbit guarda
o preço e a versão ofertados antes de abrir a sessão de pagamento.

## Migração e Stripe

O migrador inicializa as quatro ofertas existentes uma vez, com as condições
anteriores. Nessa inicialização, importa os identificadores legados
`STRIPE_PRICE_*` se estiverem presentes. Mudanças comerciais posteriores
são feitas na API administrativa e ficam no banco, inclusive ao reiniciar
ou atualizar o Compose.

Quando a cobrança está habilitada, ativar uma oferta exige preços ativos no
Stripe, com a moeda, a periodicidade, o valor e o ambiente correspondentes.
Crie um novo Stripe Price ao mudar o valor. A referência anterior continua
registrada para conciliar pagamentos e assinaturas existentes.

Rode `npm run billing:check -- --remote` no ambiente correspondente para
conferir os preços publicados. Para trocas confirmadas no portal hospedado
do Stripe, disponibilize os preços de destino na configuração do portal.
