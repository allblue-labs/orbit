# Evidências e mídia

Um arquivo no aparelho não é uma evidência. Seis conceitos, e nenhum deles é o
outro:

```text
ARQUIVO LOCAL        os bytes gravados no aparelho
REGISTRO LOCAL       o que o app sabe sobre esses bytes
INTENÇÃO             o pedido de upload, com chave de idempotência
RESERVA              a URL assinada que o servidor devolveu
OBJETO ENVIADO       os bytes já no storage
EVIDENCE CANÔNICA    o que o servidor aceitou, validou e materializou
```

Um `PUT` a 100% produz o quinto. **Não** o sexto.

## O pipeline

```text
POST /mobile/field/evidence/uploads                 intenção + URL assinada
PUT  <url assinada>                                 os bytes
POST /mobile/field/evidence/uploads/:id/finalize    valida e materializa
GET  /mobile/field/evidence?targetType=&targetId=   as confirmadas
GET  /mobile/field/evidence/:id/access?operation=   preview ou download
```

No `finalize` o servidor **relê o objeto do storage** e confere: magic bytes,
correspondência com o tipo declarado, tamanho real, SHA-256 esperado, e por fim
o limite do alvo. Só então a Evidence existe. Tratar o `PUT` como sucesso seria
prometer em nome de uma validação que ainda não aconteceu.

## Alvos

`OPERATION`, `PMOC_EQUIPMENT_EXECUTION`, `RVT_EXECUTION`. Quem autoriza anexar é
o servidor, pela ação publicada **`ADD_EVIDENCE`** em `allowedActions` — não uma
inferência do app sobre quem parece estar trabalhando.

A seção de evidências está ligada à tela de execução de atendimento. RVT e PMOC
são alvos válidos no backend, mas suas telas de execução ainda não existem no
Flutter; antecipá-las aqui seria inventar fluxo.

## `localMediaId`

A identidade do arquivo **no aparelho**. Nasce na captura e acompanha a mídia
até a evidência existir: sobrevive a reinício, retry e timeout.

**Não é o `evidenceId`.** Esse só o servidor gera, e só depois de aceitar o
arquivo. Por isso o local tem prefixo próprio (`lm-…`) e não se parece com um
UUIDv7 — confundi-los faria o app inventar identidade canônica.

O servidor casa intenções por `idempotencyKey` **ou** por `localMediaId`. Isso é
o que garante uma evidência por arquivo: mesmo com outra chave, o mesmo
`localMediaId` reencontra a intenção original.

## Tipo, tamanho e hash

**Extensão não é tipo.** Um arquivo chamado `foto.png` pode conter um PDF. A
checagem é pelos primeiros bytes — os mesmos que o `sniff` do servidor lê, e há
um único detector no app justamente para as duas checagens não divergirem.

Aceitos: JPEG, PNG, WEBP, PDF. Limites do backend: **10 MB** para imagem, **20 MB**
para documento. A reserva devolve o `maxSize` vigente, e a checagem local usa o
mesmo número — para não prometer um upload que o servidor recusaria.

O SHA-256 é calculado sobre os bytes **exatos** que serão gravados e enviados. O
redimensionamento acontece na captura, **antes** do hash: comprimir depois
enviaria um arquivo que não corresponde ao hash declarado, e o servidor recusaria
— com razão.

## Captura

```text
escolher  →  ver  →  confirmar  →  guardar  →  tentar enviar
```

Enviar direto ao tocar o obturador parece mais rápido até a primeira foto do
chão virar evidência de um atendimento — e evidência aceita não se apaga do
aparelho.

Cancelar antes de confirmar não deixa rastro: nada foi gravado no diretório do
app. A permissão é pedida quando a pessoa escolhe a origem, nunca na abertura —
pedir câmera no startup treina o usuário a negar. Negada de vez é diferente de
negada agora: só a primeira exige as Configurações do sistema, e a mensagem diz
isso.

## Armazenamento local

```text
media_queue.json     metadados, escrita atômica (temp + rename)
media/<id>.<ext>     os bytes, no diretório de documentos do app
```

Não no cache do seletor: o sistema o limpa quando quer, e é exatamente ali que
uma foto pendente não pode morar.

**Não é o journal de comandos.** Aquele guarda intenções semânticas com envelope
e versão; este guarda bytes. Misturá-los colocaria megabytes num arquivo
reescrito a cada toque de checklist, e faria um full resync de estado ameaçar a
foto que ninguém enviou ainda.

### Registro sem arquivo

Se o arquivo sumiu do disco, o registro vira `missing` — um estado honesto. Sem
isso, o app tentaria enviar um arquivo inexistente em laço, sem nunca dizer o
motivo, e a pessoa veria "aguardando envio" para sempre.

## Recuperação

| o app morreu… | ao voltar |
|---|---|
| depois do `PUT`, antes do `finalize` | a mídia volta a pendente; a reserva reencontra a intenção pelo `localMediaId` e o `finalize` a materializa |
| depois do `finalize`, antes da limpeza | a reserva responde `FINALIZED` com `uploadUrl: null`; o app remove o registro local sem reenviar nada |
| durante o `PUT` | os bytes sobem de novo, com a mesma identidade — uma evidência, não duas |

Estados em voo (`uploading`, `finalizing`) **não** são persistidos como finais:
ao reabrir, voltam a pendente. Deixá-los presos perderia a evidência para
sempre.

## Recusas

| natureza | exemplos | o que acontece |
|---|---|---|
| temporária | 5xx, sem rede, 429 | volta para a fila, com espera crescente |
| definitiva | tipo, tamanho, hash, limite, autorização, escopo | para e mostra o motivo |

**O arquivo fica nos dois casos.** Descartar o trabalho de alguém porque o
servidor disse não é decisão da pessoa, não do app. Descartar é oferecido só
para o que o servidor **não** aceitou: uma mídia ainda pendente pode estar em
voo neste instante, e apagá-la deixaria bytes no storage sem ninguém para
finalizá-los.

Um código de recusa que o app ainda não conhece vira um texto neutro — a pessoa
precisa saber que aquilo não foi, mesmo sem o motivo exato.

### Janela de envio

A intenção vale 24 horas (`pendingUploadTtlHours`). Vencida, não há como
renová-la para aquele `localMediaId`: o servidor reencontra sempre a mesma
intenção. O app diz isso e a pessoa registra de novo — insistir eternamente
gastaria bateria para chegar à mesma resposta.

## Limite por alvo

Server-authoritative, aplicado no `finalize` sob `pg_advisory_xact_lock` do
alvo: 20 para atendimento, **6 para PMOC**, 20 para RVT. Dois aparelhos
disputando a última vaga — só um entra, e é o banco que decide.

O backend **não publica** esses números em nenhum read model que o app consuma
(`EvidencePolicyReadModel` existe como tipo, sem rota que o sirva). Por isso a
tela mostra a contagem, não a fração: escrever "4 de 6" exigiria embutir o 6 no
aplicativo, que é exatamente o tipo de regra que não se reconstrói no cliente.

## Contagem

> 4 confirmadas · 2 aguardando envio

nunca

> 6

Somar as duas produziria um número que o servidor não reconhece — e é justamente
a contagem dele que decide se o limite foi atingido. Contadores do dashboard não
mudam, e a linha do tempo continua sendo fato do servidor: nenhum evento de
evidência é fabricado localmente.

## Acesso a evidências confirmadas

Emitido sob demanda (`/access`), vale minutos, e é descartado depois. Guardá-lo
como atributo da evidência renderia um link morto na próxima abertura. O nome
mostrado é o do arquivo, nunca a chave do objeto no storage.

## Envio

Sequencial, um de cada vez. O limite é aplicado no `finalize`, e mandar várias
em paralelo faria o app disputar consigo mesmo a última vaga; também é o que
evita saturar a rede de um aparelho em 3G num subsolo.

Os gatilhos são os mesmos do sincronismo de comandos — primeiro plano, volta da
rede, botão manual — porque uma segunda engine de conectividade duplicaria o
problema sem resolver nada. Cada orquestrador tem mutex e backoff próprios.

**Não há upload contínuo em segundo plano.** iOS e Android decidem quando um app
suspenso executa, e prometer isso seria prometer o que o sistema não garante.

## Segurança e dados locais

**A mídia local não é criptografada pelo aplicativo.** Isto é uma afirmação, não
uma omissão:

- os arquivos são gravados no diretório de documentos do app, em claro;
- a proteção que existe é a do sistema — sandbox em ambas as plataformas, e Data
  Protection do iOS enquanto o aparelho está bloqueado;
- não há chave gerenciada pelo Orbit, e o app **não** promete criptografia em
  repouso.

Uma foto de campo pode conter placa de equipamento, documento de cliente, rosto
de pessoa. Um aparelho perdido e desbloqueado expõe o que estiver pendente.

**Dívida de endurecimento para release:** criptografia em repouso da fila de
mídia, com chave no keystore/keychain. Registrada aqui de propósito, e não
escondida atrás de um "o sistema já protege".

Tokens continuam no armazenamento seguro e nunca passam por estes arquivos. Não
se registra em log: caminho de arquivo, URL assinada, chave de objeto, bytes de
imagem, nem dado de cliente.

### EXIF e localização

O app **não** lê nem reescreve EXIF, e **não** usa a localização embutida na foto
como verdade de domínio — onde o atendimento aconteceu é fato do servidor, não
de um metadado que qualquer editor altera. O redimensionamento na captura
costuma descartar EXIF como efeito colateral do reencode, mas isso é
comportamento do plugin, não uma garantia que este app ofereça: **a remoção de
metadados não está implementada**, e é dívida junto com a criptografia.

## Retenção e limpeza

O arquivo local é removido quando — e só quando — a evidência existe no
servidor. Antes disso ele é a única cópia. Não há backup em nuvem da mídia
pendente, e o app não promete nenhum: até o `finalize`, o que existe está no
aparelho.

Desinstalar o app leva os dados junto, incluindo capturas não enviadas.

## Limites conhecidos

- Sem vídeo: o backend aceita JPEG, PNG, WEBP e PDF.
- Sem edição ou remoção de evidência confirmada — o backend não publica esses
  comandos, e inventá-los seria inventar domínio.
- Sem legenda/descrição: o `CreateFieldEvidenceUploadDto` não tem esse campo.
- Sem OCR, classificação ou pontuação automática.
- Sem execução de PMOC e RVT no Flutter; os alvos existem, as telas não.
