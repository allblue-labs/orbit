# Sincronização offline

Offline **não** é guardar requisições HTTP para reenviar depois. O que fica no
aparelho é a intenção:

```text
o que a pessoa quis fazer
+ sobre qual atendimento
+ com que versão diante dos olhos
+ em que momento
+ de qual aparelho
```

A diferença aparece no replay. Uma requisição serializada reexecuta o que o app
quis fazer. Uma intenção é **reapresentada** ao servidor, que a revalida contra
o estado, a autorização e a designação de agora — e pode recusar. Ficar sem rede
não concede direito adquirido.

## Cinco conceitos que não se fundem

```text
ESTADO DO SERVIDOR    o que a API responde agora
PACOTE DE CAMPO       o necessário para executar um item sem rede
COMANDOS PENDENTES    intenções ainda não confirmadas
RECIBOS               o desfecho de cada intenção, dito pelo servidor
SITUAÇÃO DA SYNC      o que a interface mostra sobre tudo isso
```

Fundir os dois primeiros faria o cache virar autoridade. Fundir comando e
recibo perderia a distinção entre "registrei" e "está feito" — que é a única
coisa que este documento existe para preservar.

## O envelope

Exatamente o `OfflineCommandEnvelopeDto`:

| campo | por quê |
|---|---|
| `commandId` | UUIDv7; identifica **esta** intenção |
| `idempotencyKey` | o mesmo valor; é o que torna o reenvio inofensivo |
| `commandType` | um dos seis abaixo |
| `aggregateType` | `OPERATION`, e nada além |
| `aggregateId` | o atendimento |
| `expectedVersion` | a versão que a pessoa viu ao decidir |
| `occurredAt` | o instante da ação no aparelho |
| `deviceInstanceId` | qual instalação |
| `payload` | os dados da ação |

Seis comandos, os que o backend aceita: `OPERATION_START`,
`OPERATION_CHECKLIST_UPDATE`, `OPERATION_ADD_NOTE`, `OPERATION_ADD_MATERIAL`,
`OPERATION_COMPLETE`, `CUSTOMER_ACKNOWLEDGEMENT`. Evidência é FL-06; documento é
FL-07; upload de assinatura depende de storage e rede, e não entra.

### Tudo congelado, nada regenerado

O servidor calcula um SHA-256 sobre tipo, agregado, versão, instante e payload,
e o compara com o hash guardado para aquela chave de idempotência. Refazer
**qualquer** campo no replay produz outro hash, e a resposta é
`IDEMPOTENCY_MISMATCH` — corretamente, porque mesma chave com outro conteúdo é
outra intenção usando a chave da primeira.

A FL-03 encontrou isso em runtime ao reconstruir o envelope com uma
`expectedVersion` nova na repetição. Por isso o envelope é gravado inteiro e
lido inteiro do disco.

## Journal e projeção: dois arquivos

```text
command_journal.json    intenções pendentes + recibos
sync_projection.json    cursor + última lista recebida do servidor
```

A separação é a garantia de que um full resync não destrói a fila: ele apaga o
segundo arquivo e **não tem como** alcançar o primeiro. Num documento só,
preservar os comandos dependeria de alguém lembrar de filtrar — e é o tipo de
coisa que se esquece na versão em que passa a importar.

Escrita atômica: grava num temporário e renomeia por cima. `rename(2)` é atômico
no mesmo sistema de arquivos, então um corte de energia deixa o journal anterior
intacto em vez de um arquivo truncado. As gravações são serializadas — duas
concorrentes fariam a última vencer, e a perdida seria trabalho de alguém.

## O ciclo

```text
push (≤50)  →  um recibo por comando  →  pull autoritativo  →  reconcilia
```

O servidor responde `nextRecommendedAction: PULL` porque os recibos dizem o
desfecho de cada intenção, não o estado resultante. Deduzir o estado a partir
dos recibos seria reconstruir domínio no cliente.

### Recibos

| status | o que o app faz |
|---|---|
| `APPLIED` | grava o recibo e tira da fila, na mesma escrita |
| `ALREADY_APPLIED` | idem — é sucesso reconciliado, não erro |
| `CONFLICT` | para, mostra o motivo, espera uma pessoa |
| `REJECTED` | terminal; sem retry |
| `RETRYABLE_ERROR` | volta para a fila, com espera crescente |
| `BLOCKED` | volta para a fila **sem** contar tentativa |

`BLOCKED` não é falha do próprio comando: é o servidor recusando processar um
comando cujo antecessor no mesmo atendimento não foi aplicado. Marcar um item de
checklist depois de um `start` recusado aplicaria a segunda intenção sobre um
estado que a primeira não alcançou.

Um recibo cujo `commandId` não corresponde a nada da leva é **ignorado**.
Atribuí-lo ao primeiro comando à mão resolveria a intenção errada, e a errada
sairia da fila como se tivesse sido aplicada.

### Ordem

Comandos do mesmo atendimento vão na ordem em que foram criados, e o servidor os
processa em sequência — é o bloqueio acima que depende disso. Atendimentos
diferentes não dependem uns dos outros.

### Repetição e espera

Cada intenção é tentada **no máximo uma vez por sincronização**. Sem isso, um
erro temporário devolveria o comando à fila e a rodada seguinte o reenviaria no
mesmo instante — um laço apertado que ignora o backoff e gasta bateria.

A espera cresce: 5s, 30s, 2min, 10min, 30min. Gatilhos automáticos a respeitam;
o toque manual não, porque quem tocou está olhando para a tela.

Conflito e recusa **nunca** viram retry. O mundo mudou, e insistir sozinho é
como se sobrescreve o trabalho de outra pessoa.

### Desfecho incerto

Se o push falha sem resposta, pode ter chegado ou não. Os comandos voltam para a
fila com o mesmo `commandId` e o mesmo conteúdo; se chegaram, o próximo envio
recebe `ALREADY_APPLIED`. É para isso que a idempotência existe.

## Pull, cursor e tombstones

Cursor opaco, `base64url` de `{v:1, sequence}`, persistido por escopo. Um cursor
único faria a troca de contexto continuar de onde outra pessoa parou.

**A página e o cursor avançam na mesma gravação.** Avançar antes abriria a janela
clássica: cursor adiantado com a página não aplicada, e a mudança some para
sempre — o servidor não a repete, porque já a considerou entregue.

`knownWorkItemIds` é o que permite ao servidor emitir tombstone: sem dizer o que
se tem em mãos, não há como ele apontar o que deixou de valer. Tombstone,
`REMOVED`, `REVOKED` e `OUT_OF_SCOPE` têm o mesmo efeito local — a projeção
perde o item. A diferença entre eles é o motivo, não a consequência: um
atendimento que saiu do escopo não pode continuar parecendo trabalho a fazer.

### Full resync

`FULL_RESYNC_REQUIRED` não é erro: é o servidor dizendo que o cursor ficou velho
demais para reconstruir o delta. A projeção recomeça; **a fila permanece**.

## Retenção

Os números são do servidor (`mobile-sync-retention.ts`): 90 dias de janela de
replay, 120 de recibo. Guardar por mais tempo do que o servidor aceita
reprocessar produziria uma fila que só existe para falhar.

Recibo velho sai na limpeza. Comando fora da janela **não** sai: passa a
`expired` e aparece na tela como

> Esta ação ficou tempo demais sem sincronizar e não pode mais ser enviada.

Sumir com ele seria apagar trabalho sem contar a ninguém. O servidor recusaria
de todo jeito; a diferença é a pessoa ficar sabendo.

## Quando se sincroniza

Três gatilhos: voltar ao primeiro plano, a rede reaparecer, e o botão
**Sincronizar agora**. Um mutex global garante uma sincronização em voo — uma
tempestade de eventos de conectividade coalesce numa só em vez de virar dez.

Ter rede não é ter internet: o callback de conectividade é um convite a tentar,
e quem diz se dá para falar com o servidor é a resposta da API.

**Não há sincronização contínua em segundo plano.** iOS e Android decidem quando
um app suspenso executa; prometer isso na interface seria prometer o que o
sistema operacional não garante.

## O que a interface diz

Estado local e estado do servidor nunca se parecem:

> Marcado — aguardando sincronização

nunca

> Confirmado

Um atendimento com início pendente não é um atendimento em andamento. Um aceite
guardado no aparelho é "salvo neste aparelho", não "registrado". A tela de
execução mostra as intenções pendentes num bloco separado, acima das ações.

Contadores do dashboard **não** são recalculados com comandos pendentes, e a
linha do tempo continua sendo a do servidor — inventar entradas locais criaria
uma auditoria paralela que ninguém pode conferir.

Nada de `commandId`, `expectedVersion` ou nome de comando na tela: isso é
vocabulário do protocolo, e quem abre a tela quer saber se o trabalho da manhã
chegou.

### Conflitos

Cada código vira uma frase que diz o que houve **e** o que fazer. Um código que
o app ainda não conhece cai num texto neutro — a pessoa precisa saber que aquilo
não foi, mesmo sem o motivo exato.

Resolução é manual: atualizar, revisar, ou descartar. **Não há merge
automático**, e descartar só é oferecido para o que o servidor não aplicou — uma
intenção ainda pendente pode estar em voo neste instante.

## Escopo e troca de usuário

Todo comando carrega `userId`, `organizationId` e `businessUnitId`. Ao trocar de
usuário ou de organização a fila não some: ela deixa de ser visível e
sincronizável. Enviar a fila de um técnico sob o token de outro trocaria o autor
do trabalho.

### Logout

Duas decisões distintas:

- **A projeção é apagada.** O próprio pacote vem marcado `purgeOnLogout: true`,
  e carrega nome de cliente, endereço e histórico. Isso não fica num aparelho
  depois que a pessoa sai dele.
- **A fila permanece.** Apagá-la destruiria o registro de um trabalho que
  aconteceu de verdade só porque alguém tocou "Sair" antes de pegar sinal.

Com pendências, o logout avisa antes.

## Segurança e dados locais

**O armazenamento local não é criptografado pelo aplicativo.** Isto é uma
afirmação, não uma omissão:

- o journal e a projeção são arquivos JSON no diretório de documentos do app;
- a proteção que existe é a do sistema — sandbox do app em ambas as plataformas,
  e Data Protection do iOS enquanto o aparelho está bloqueado;
- não há chave gerenciada pelo Orbit, e o app **não** promete criptografia em
  repouso.

O que isso implica sobre o conteúdo:

| dado | onde | mitigação |
|---|---|---|
| nome do signatário do aceite | payload do comando | sai no logout junto com o comando resolvido |
| nome e endereço de cliente | projeção | apagada no logout |
| observações de campo | payload do comando | limitado ao necessário |
| tokens de sessão | **secure storage**, separado | keychain / keystore |
| imagem de assinatura | não fica local | upload é online, por URL assinada |

Tokens continuam no armazenamento seguro e nunca passam por estes arquivos. Um
aparelho perdido e desbloqueado expõe a fila e a projeção; a mitigação real é o
logout, que apaga a projeção, e o bloqueio do aparelho.

## Identidade do aparelho

`deviceInstanceId` é um valor aleatório gerado na primeira execução — não IMEI,
não serial, não identificador de anúncio. Esses identificam o aparelho e quem o
carrega; para distinguir instalações, um número aleatório serve igual e não vaza
nada.

Reinstalar gera outro. Isso é aceitável porque a identidade da intenção é o
`commandId`: o device serve para diagnóstico, e a idempotência não depende dele.
Uma fila pendente não sobrevive à desinstalação de qualquer forma.

## Limites conhecidos

- Sem fila offline para evidência (FL-06), documento (FL-07) ou upload de
  assinatura.
- Sem execução offline de PMOC e RVT: o backend só aceita `aggregateType`
  `OPERATION`, e o pacote desses tipos é de leitura.
- Sem merge automático de conflito, sem CRDT.
- Sem garantia de sincronização em segundo plano.
- A projeção local guarda no máximo 300 itens; acima disso os mais antigos saem,
  e o servidor os devolve na próxima consulta.
