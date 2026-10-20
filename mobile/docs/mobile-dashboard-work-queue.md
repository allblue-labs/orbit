# Meu dia, fila de trabalho e agenda

O que o profissional em campo precisa saber ao abrir o app, e de onde cada
resposta vem.

## Autoridade

```text
O Mobile não decide o que é prioritário, atrasado, executável ou permitido.
O backend entrega o item de trabalho já classificado, ordenado e autorizado.
```

Três endpoints do MB-01 sustentam tudo:

```text
GET /mobile/field/home             → o dia e superfícies recentes, consolidados
GET /mobile/field/work-queue       → a fila, ordenada e paginada por cursor
GET /mobile/field/work-items/:id   → o contexto de um item
```

## Meu dia

**Uma requisição** para toda a home. Antes desta PR a home fazia seis leituras
administrativas — `/analytics/dashboard`, `/operations` três vezes, a agenda e
as notificações — e ainda assim não respondia diretamente "o que faço agora".

O dashboard traz `next`, `counters`, `inProgress`, `overdue`, `today` e
`capabilities`. As listas são **prévias**; as contagens são o total. Numa
leitura real do tenant de teste, `counters.inProgress` era 10 enquanto a lista
trazia 5 — somar o que está em mãos daria outro número, e é por isso que o app
nunca conta.

O próximo atendimento é escolha do servidor (`next`), não do app. Ele só é
exibido quando ainda não apareceu em "Em andamento": repeti-lo seria gastar a
tela com o mesmo cartão.

A Home é canônica para todos os perfis móveis autorizados. Owner, Técnico em
Campo e Responsável Técnico veem a mesma árvore de componentes e a mesma
identidade visual; o backend limita a projeção e `allowedActions` conforme o
escopo real de cada ator.

## Ordenação

O backend ordena por faixa e, dentro dela, por horário e id:

```text
em andamento → atrasado → hoje → próximos → sem data
```

O app **preserva**. Não reordena, não reagrupa de forma que altere a
prioridade, e não compara datas para descobrir o que atrasou — `dueState` chega
pronto, decidido no fuso da unidade. Os títulos de seção na fila aparecem
apenas onde a ordem recebida já mudou de faixa: são legenda, não agrupamento.

Há teste de unidade que embaralha uma lista de propósito e prova que a ordem
sai como entrou, e smoke contra a API real que confere a monotonicidade das
faixas na resposta de verdade.

## Identidade do item

O ID é composto pelo servidor e **opaco** para o app:

```text
SERVICE_OPERATION:<operationId>
PMOC:<cycleId>:<equipmentId>
RVT:<occurrenceId>
```

O app nunca o decompõe. Para saber o tipo existe `kind`; para navegar existe
`navigationContext` (`sourceId`, `executionId`, `occurrenceId`, `cycleId`,
`equipmentId`). Na rota, o ID vai codificado — `:` é separador de caminho.

## Paginação

Cursor do servidor, teto de 50 por página (padrão 20). A junção é por ID
canônico, nunca por nome de cliente ou equipamento: o mesmo cliente tem vários
atendimentos no mesmo dia, e deduplicar por nome apagaria trabalho real.

O controlador ignora pedidos enquanto uma página está no ar — rolar rápido não
pede a mesma página duas vezes. E como o cursor é estável, repetir uma página
é operação sem efeito em vez de duplicata. Ambos com teste; o segundo também
contra a API real.

Falha ao carregar uma página **não** descarta o que já está na tela: a fila
continua utilizável e o erro aparece no rodapé, com "tentar novamente".

## Tipos

`Atendimento`, `Manutenção preventiva` e `Visita técnica`. Numa leitura real do
tenant: 10 + 10 + 5 numa única página, cada um com o próprio `primaryAction`
(`RESUME`, `EXECUTE_PMOC`, …).

Item de tipo que esta versão não conhece é **descartado**, não renderizado com
código cru. Descartar é mais honesto que adivinhar: um item sem classificação
apareceria fora de ordem, e um sem contexto não levaria a lugar nenhum.

## Ações

`allowedActions` decide o que aparece; `primaryAction` decide o que é destaque.
Nada é habilitado por status. Ação publicada que o app não conhece some da
lista — botão sem nome claro convida ao toque sem dizer o que faz.

Execução de campo — iniciar, concluir, evidência, assinatura — é da FL-03.
Enquanto não existe, essas ações aparecem **descritas e desabilitadas**,
dizendo onde acontecem. Assim a lista continua sendo a do servidor, sem
prometer o que a tela não cumpre.

## Equipe

Técnico em Campo, `auxiliares técnico` e a função de quem está lendo aparecem
com os termos do domínio. Nada de "Equipe" genérico: os papéis são distintos, e
a mesma pessoa pode ocupar dois.

Estar escalado **não** concede permissão. A função explica o que a pessoa faz
ali; o que ela pode fazer continua vindo de `allowedActions`.

## Datas

Instante e data civil não se confundem (ver `field-foundation.md`). Horário de
item é instante, exibido no relógio de quem lê. "Hoje", "atrasado" e "próximo"
são classificação do servidor, no fuso da unidade — o app não os calcula.

Item sem data programada mostra "Sem data". Não se inventa uma.

## Agenda

A agenda continua consumindo `/scheduling/agenda`, que resolve o dia civil no
fuso da unidade. Tocar um compromisso abre o **item de trabalho** quando ele
existe: a correspondência é publicada pelos dois lados — o item carrega
`schedulingId`, o evento carrega `eventId`. O app apenas casa os dois; não
remonta identidade.

Nem todo evento vira item: bloqueios de agenda e trabalho de outra pessoa
existem legitimamente no calendário. Nesses casos o cartão fica sem toque, em
vez de levar a lugar nenhum.

O item de trabalho é o ponto de entrada operacional — a agenda é a projeção
temporal dele, não uma segunda tela de detalhe.

## Escopo do cache

A chave carrega usuário, organização e unidade. Sem isso, trocar de contexto
serviria o trabalho de outra unidade a partir do cache — o vazamento mais fácil
de cometer e o mais difícil de perceber.

Quando a rede falha e há cache válido, o dashboard aparece com o aviso de dado
desatualizado. Nunca se finge atualização recente.

## Lacunas conhecidas

- **`MobileAgendaReadModel` existe no backend e nenhum endpoint o expõe.** A
  agenda mobile continua sendo a de scheduling. Quando o endpoint existir, a
  ponte evento → item deixa de precisar do índice montado aqui.
- **O índice agenda → item custa uma requisição** à fila (teto de 50). É o
  preço de casar `eventId` com `schedulingId` sem um endpoint de busca por
  agendamento.
- **Ações de execução ficam desabilitadas** até a FL-03.
- **`location` é JSON livre**: a tela lê as chaves que reconhece (`label`,
  `address`, `street`, `city`, `name`) e cai no setor do equipamento.
