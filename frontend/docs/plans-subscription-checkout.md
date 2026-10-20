# Plano, assinatura e contratação — a superfície Web

## Onde mora

```text
/configuracoes?secao=assinatura
```

Rótulo: **Plano e assinatura**.

Não é página nova. A arquitetura de Configurações fechada na PR-FE-H05 já
suporta seções por `?secao=`, e assinatura é governança da organização — não do
usuário, que é o domínio de `/perfil`. Criar `/assinatura` teria duplicado uma
navegação que já funciona, com um deep link a menos.

## O princípio

O navegador **não decide nada** aqui:

| Decisão | Quem decide |
|---|---|
| quanto custa | catálogo do servidor |
| qual periodicidade existe | catálogo do servidor |
| se há avaliação disponível | `subscription.trial.eligible` |
| se pode contratar, trocar, cancelar | `allowedActions` |
| se pode abrir a cobrança | `billing.allowedActions` |
| qual é o limite e o uso | leitura de direitos |
| quando o período vira | `usagePeriod` / `billingPeriod` |
| se a assinatura está ativa | o provedor, por evento assinado |

Toda a lógica de decisão que resta no cliente cabe num arquivo,
`billing-actions.ts`, e existe para poder ser provada: nenhuma ação nasce de
código de plano, de preço ou de status.

## Uma leitura, três blocos

`GET /billing/overview` traz catálogo, assinatura, uso e prontidão juntos.
Quatro leituras separadas abririam a página com quatro carregamentos e quatro
chances de mostrar um pedaço inconsistente do outro.

```text
Plano atual   → plano, valor, estado, próxima renovação, avisos, ações
Uso do plano  → em uso agora | consumido no período
Planos        → seletor de periodicidade + quatro cartões
```

A ordem é a da pergunta que traz a pessoa aqui: *qual plano eu tenho, quanto
estou usando, o que existe além disso.* Não é uma página de vendas — é uma tela
operacional autenticada.

## Estados da assinatura

| Estado | Rótulo | Selo | Aviso no topo | Ações |
|---|---|---|---|---|
| `TRIALING` | Período de teste | secundário | — | do servidor |
| `ACTIVE` | Ativa | padrão | — | do servidor |
| `PAST_DUE` | Pagamento pendente | contorno | — | do servidor |
| `GRACE_PERIOD` | Período de regularização | contorno | "identificamos um problema com a cobrança" | do servidor |
| `SUSPENDED` | Suspensa | destrutivo | "regularize para restaurar o acesso" | do servidor |
| `CANCELED` | Cancelada | destrutivo | — | do servidor |
| `EXPIRED` | Expirada | destrutivo | — | do servidor |

Estado que a tabela não conhece vira o texto neutro "Assinatura". Mostrar
`GRACE_PERIOD` para quem está tentando entender a própria conta não ajuda.

**Cancelamento agendado não é cancelamento.** Enquanto o período corre, o selo
continua "Ativa" e o texto diz até quando o acesso vale. Dizer "cancelada"
agora seria mentir sobre o acesso que a empresa ainda tem.

## Uso

| Bloco | Recursos |
|---|---|
| Em uso agora | Unidades · Usuários · Técnicos operadores · auxiliares técnico · Clientes · Equipamentos |
| No período | Ordens de serviço · PMOC · RVT · Outros documentos · Automações |

- **Ilimitado** é a palavra, nunca `null`, `-1` ou número mágico. E não recebe
  barra: proporção sobre um teto que não existe não significaria nada.
- **A barra não transborda.** Passar do teto é decisão do servidor; a barra
  para em 100%.
- **As faixas de cor** (70% atenção, 90% alto) são apresentação. Nenhuma
  decisão de cobrança ou de bloqueio sai delas.
- **Consumo zero** aparece como zero.
- `AI_COMPUTE` não aparece: a unidade comercial de IA não foi congelada, e
  publicar um número prometeria uma cota que não existe.
- **Nenhum limite de armazenamento**, em nenhuma forma.

`técnicos operadores` e `auxiliares técnico` mostram os mesmos números porque
compartilham a mesma base canônica de pessoas habilitadas (PR-PL-01.1). A tela
apresenta o que o servidor devolve e não recalcula nada.

## Preços

Vêm de `catalog.plans[].prices[intervalo].amountMinor`, em centavos. O cliente
não multiplica, não aplica desconto e não conhece identificador de preço de
provedor.

O **equivalente mensal** de semestral e anual é derivação de apresentação sobre
o valor publicado, mostrada ao lado do total cobrado — o que a empresa paga
continua sendo o total. Não aparece "6x de" nem "12x de": parcelamento não está
configurado, e prometê-lo seria falso.

A periodicidade abre na que a empresa já contratou. Quem assina anual vê o
próprio preço primeiro.

## Contratação

```text
botão → hook → BFF → backend → sessão do provedor → redirecionamento
```

O corpo leva **plano e periodicidade**. Valor, moeda, identificador de preço,
dias de avaliação e organização não são enviados — e se fossem, o servidor
recusaria a requisição inteira. A URL do redirecionamento é a que o servidor
devolveu; o cliente não monta endereço.

**Duplo envio** é bloqueado por uma trava de mesmo tique (`useRef`), não só por
`disabled`: `disabled` só vale no próximo render, e dois cliques no mesmo tique
passam pelos dois. É a lição da PR-FE-H03.

### Voltar não ativa nada

`?assinatura=sucesso` diz apenas que o navegador voltou. Quem confirma o
pagamento é o provedor, por evento assinado. Enquanto a leitura não confirma, a
tela mostra *"estamos confirmando sua assinatura"* — nunca *"assinatura
ativa"*.

A página reconsulta até seis vezes, de quatro em quatro segundos, e para.
Consultar para sempre gastaria a bateria de quem deixou a aba aberta.

## Mudança de plano

**Subir** vale imediatamente; o diálogo diz que a diferença é calculada pelo
provedor de pagamento. A tela não calcula proporcional — proporcional tem
arredondamento, imposto e histórico, e a fatura do provedor é a autoridade
disso.

**Descer** entra na fila do próximo período, e o diálogo diz a data. Nenhum
recurso é removido da tela: rebaixar não desliga ninguém, e o que fica
bloqueado — criar mais — é decisão do servidor no momento da escrita.

Subir ou descer é decidido pelo preço de tabela publicado, e **só para escolher
a explicação**: quem decide se a mudança é imediata ou programada é o servidor.

## Cancelamento

O botão diz **"Cancelar renovação"**, porque é o que acontece. O diálogo mostra
a consequência real — até quando o acesso vale e que não haverá renovação — e
diz que dá para voltar atrás enquanto o período corre. Uma tela, sem retenção
artificial, sem esconder o botão.

Quando há cancelamento agendado, o botão vira **"Manter assinatura"**.

## Controle de versão

Todo comando envia `expectedVersion`, que veio da leitura. Se outra pessoa (ou
o reconciliador) escreveu antes, o servidor recusa com `STALE_VERSION` e a tela
relê em vez de repetir cegamente.

## Erros

Tratados pelo `error.code` da PR-35 — nunca por texto da mensagem. Nada foi
acrescentado a `error-copy.ts`.

| Situação | O que a pessoa vê |
|---|---|
| cobrança desligada | "A contratação online ainda não está disponível." |
| provedor fora do ar | a copy pública do código, sem detalhe técnico |
| configuração inválida | mensagem genérica; nenhum identificador nosso |

Com a cobrança desligada, a página **continua inteira**: plano atual, uso e
comparação de planos seguem funcionando. Só os botões de contratação e de
cobrança somem.

## Organização sem assinatura

Inquilinos anteriores à PR-PL-02 não têm assinatura registrada. A tela não diz
"sem plano" — isso afirmaria uma restrição que não existe. Diz que ainda não há
assinatura registrada, que o acesso atual continua valendo, e mostra o catálogo.

## Planos internos

Não aparecem. O catálogo publicado pelo servidor traz apenas os quatro planos
comerciais; o frontend não mantém lista de exclusão. Código interno de plano
nunca chega à tela — só o rótulo público.

## Responsividade

| Largura | Cartões |
|---|---|
| 1440 | 4 colunas |
| 1024 | 2 × 2 |
| 768 | 2 colunas |
| 375 | 1 coluna |

Sem rolagem lateral em nenhuma delas, verificado no navegador.

## Acessibilidade

- o seletor de periodicidade é um `Tabs` com rótulo, navegável por setas;
- cada cartão é um `article` com nome acessível;
- as barras de consumo têm rótulo com o número que representam;
- os diálogos reutilizam o `AlertDialog` do sistema — foco preso, `Escape`
  fecha, foco devolvido;
- um `h1` da página e `h2` por bloco, sem `div` fingindo cabeçalho.

## O que esta PR não fez

Nenhuma UI no Flutter. Nenhum formulário de cartão — a captura é do provedor,
na tela dele. Nenhum outro módulo redesenhado.
