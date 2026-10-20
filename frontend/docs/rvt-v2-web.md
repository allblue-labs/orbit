# RVT V2 — Web

O que a tela precisa ensinar antes de qualquer outra coisa:

```text
Configuração → a regra da visita: cliente, local, periodicidade, procedimento
Ocorrência   → uma visita prevista, numerada 001..N pelo servidor
Execução     → a visita física, com N equipamentos atendidos
Documento    → o RVT emitido a partir da execução
```

São quatro coisas. Configuração não se visita — ocorrência se visita.
Ocorrência não produz documento — execução produz.

## RVT não é uma Operation com outro tipo

Durante a execução existe uma Operation espelhada, e a tela mostra o código
dela como atalho. Isso é **projeção operacional**: serve para o atendimento
aparecer nos fluxos de OS. A entidade do domínio é o RVT, e é por ela que a
navegação passa.

## Rotas

```text
/rvt                          configurações + visitas da operação
/rvt/[configurationId]        a regra, as visitas previstas e o histórico
/rvt/execucoes/[executionId]  a visita física
```

Não há rota de ocorrência. Não é omissão: o backend **não publica leitura de
ocorrência isolada** — só `GET /rvt/occurrences` (lista) e
`/occurrences/:id/preparation`, que exige `rvt.execute` e existe para o
aplicativo de campo. A ocorrência vive dentro da configuração, que é onde o
servidor a devolve.

## Periodicidade

Duas colunas, não uma:

| campo          | valores                  | rótulo                     |
| -------------- | ------------------------ | -------------------------- |
| `scheduleMode` | `RECURRING` / `ONE_TIME` | Recorrente / Uma única vez |
| `visitType`    | `WEEKLY` / `SEMIANNUAL`  | Semanal / Semestral        |

São ortogonais — uma visita avulsa também tem tipo, e o DTO de criação exige os
dois. Achatá-los num enum só de produto criaria vocabulário que o servidor não
tem, e a primeira tela que precisasse dos dois ficaria sem resposta.

Quando não há repetição, a periodicidade exibida é "Uma única vez": anunciar
"Semestral" para algo que acontece uma vez seria falso.

**Semestral nunca vira "180 dias".** Seis meses civis vão de 181 a 184 dias
conforme a data de partida; traduzir a recorrência em dias reconstruiria no
navegador a regra de calendário que vive no backend — e erraria. Há teste de
unidade e de navegador que reprovam qualquer contagem de dias nesta tela.

## Autoridade da agenda

Nenhuma data é calculada aqui. O servidor gera as ocorrências a partir da
periodicidade e da vigência, projeta cada uma na Agenda e devolve
`sequence` (`001`) e `sequenceNumber` prontos. A numeração exibida é a dele —
usar a posição na lista faria a segunda linha dizer "002" quando uma visita
cancelada já ocupou aquele número.

`dueState` (`UPCOMING` / `DUE_TODAY` / `OVERDUE`) também vem pronto, decidido
no fuso da configuração. Comparar datas no navegador daria respostas diferentes
para duas pessoas em fusos diferentes olhando a mesma visita.

### Editar reconcilia a agenda futura

`PATCH /rvt/configurations/:id` devolve `{ configuration, reconciliation }`. O
segundo campo é o que o servidor fez: quantas visitas criou, remarcou e
cancelou — apenas as **futuras e intocadas**. As já realizadas permanecem.

A tela mostra esses três números e não apaga, não recria e não recalcula
ocorrência nenhuma. Deduzir o mesmo comparando listas erraria justamente quando
a comparação empatasse.

Unidade, cliente, código e modo de agenda não são editáveis: o
`UpdateRvtConfigurationDto` os marca como `never`. Trocá-los transformaria a
configuração em outra, com as visitas da anterior penduradas nela.

## Execução

`GET /rvt/executions/:id` devolve equipamentos, equipe, evidências, aceite e
documento em **uma** consulta. Uma visita com vinte máquinas custa uma
requisição, não vinte e uma — há teste de navegador que reprova se aparecer
consulta por equipamento.

Equipamento cadastrado em campo é marcado como tal: explica por que ele não
estava na configuração.

### Papéis

Técnico em Campo, auxiliares técnico e Responsável Técnico aparecem separados,
com os termos da PR-FE-02. "Equipe técnica" como rótulo único apagaria a
distinção que o domínio mantém — e a mesma pessoa pode ocupar dois papéis na
mesma visita, o que só se enxerga se os dois estiverem escritos.

### RT condicional

`requiresTechnicalResponsible` é a política publicada pela configuração. Quando
o RT não é exigido, a ausência **não é falha** e não vira alerta; o texto é
neutro. Quando é exigido e não há RT definido, a tela avisa — mas quem decide
continua sendo o servidor.

### Aceite do cliente

Opcional por política (`customerSignatureRequired: false`). Presente, mostra o
instantâneo: quem assinou e quando. Ausente, é estado válido, não erro.

Não é alteração cadastral do cliente — é o registro de que alguém, presente na
visita, deu ciência. A tela diz isso.

## O Web não executa visita

Não há "Iniciar visita", "Concluir" nem "Gerar documento". `start`, `complete`,
`evidence`, `acknowledgement` e `artifact` exigem `rvt.execute` e existem para
o técnico diante do equipamento. Um botão no navegador criaria visita que
ninguém fez. É a mesma regra do PMOC.

O documento é lido pelo visualizador canônico de artefatos — preview e download
por URL assinada pedida ao backend. Esta tela não renderiza PDF.

## RVT avulso

O aplicativo de campo cria visitas fora de qualquer contrato. O backend
canonicaliza:

```text
configuração ONE_TIME → ocorrência 001 → execução
```

O Web mostra exatamente isso. Não existe `RvtAdHoc` como entidade de frontend:
"Visita avulsa" é um rótulo derivado de `scheduleMode === "ONE_TIME"`.

O cadastro contextual de cliente e equipamento pertence ao fluxo móvel. O Web
consome o resultado; não reimplementa aquele onboarding.

## Lacunas conhecidas do contrato

- **JSON livre sem forma publicada.** `recurrence`, `procedure`,
  `serviceLocation`, `observations`, `recommendations` e
  `customerAcknowledgement` chegam como `unknown`. Não são convertidos com
  `as`: o aceite passa por uma checagem em tempo de execução e volta `null`
  quando não bate; observações e recomendações são exibidas como os pares de
  texto que existirem, sem inventar esquema. `freeTextRecommendation` é o único
  campo tipado desse conjunto.
- **Paginação declarada, não implementada.** `GET /rvt/configurations` e
  `GET /rvt/occurrences` respondem sempre `nextCursor: null` e
  `hasNextPage: false`, limitando em 50 registros no servidor. A tela não
  oferece navegação de página porque não haveria para onde ir. A linha do tempo
  (`/timeline`), essa sim, tem cursor real.
- **Sem busca por texto.** `RvtConfigurationQueryDto` aceita unidade, cliente e
  situação. Não há campo de busca na lista: uma caixa que o servidor ignora
  promete um recurso e devolve a lista inteira.
- **Editar não publica elegibilidade.** Como no PMOC, o backend recusa certas
  edições sem anunciar a regra em campo nenhum. A ação segue pela permissão e a
  recusa é exibida como veio.
