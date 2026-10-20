# Documentos de campo

O aplicativo **nunca** monta o documento. Ele é uma projeção imutável de fatos
que o servidor consolidou, renderizada pelo Artifact Engine. O Flutter consulta,
pede, acompanha e busca o arquivo — não escolhe signatário, não monta snapshot,
não gera PDF.

Seis conceitos que não se fundem:

```text
ESTADO DA EXECUÇÃO   o atendimento em si
PRONTIDÃO            se dá para emitir, e o que falta
SNAPSHOT             os fatos congelados, com hash
RENDERIZAÇÃO         o estado do trabalho assíncrono
ARTEFATO             o documento como entidade do domínio
ACESSO ASSINADO      uma URL temporária para o arquivo
```

Duas confusões que a interface existe para impedir: **atendimento concluído não
é documento pronto**, e **requisição de emissão aceita não é PDF disponível**.

## O ciclo

```text
GET  .../sources/:id/preparation   elegibilidade, sem congelar nada
POST .../sources/:id/prepare       congela o snapshot
POST .../:id/render                agenda a renderização
GET  .../:id                       o estado agora
GET  .../:id/access?operation=     URL temporária
```

Abrir a seção consulta a preparação e só isso. Congelar é irreversível: a partir
dali o documento tem uma versão de fatos própria, e mudanças posteriores na fonte
não a reescrevem. Por isso preparar é ação explícita, nunca efeito colateral de
abrir a tela.

### Fontes

`OPERATION`, `RVT_EXECUTION` e `PMOC_EQUIPMENT_EXECUTION` — pelo id da
**execução**, nunca pelo plano, pelo ciclo ou pela ocorrência. O app não deriva
o id: ele vem do contexto publicado.

A seção está ligada à tela de execução de atendimento. RVT e PMOC são fontes
válidas no backend, mas suas telas de execução ainda não existem no Flutter.

## O que vem do servidor, e só dele

| fato | quem decide |
|---|---|
| elegibilidade e bloqueios | servidor |
| assinatura do técnico e do responsável técnico | servidor |
| executor real (`completedBy → startedBy → responsável`) | servidor |
| validade do aceite do cliente | servidor |
| quais evidências entram | servidor |
| quais ações existem agora | servidor |

Nada disso é recalculado aqui. Proibido em particular:

```dart
if (operation.status == completed) canGenerateDocument = true;  // não
```

`EVIDENCE_PENDING` merece nota: conta intenções de upload pendentes **no
servidor**, não a fila local do aparelho. Uma foto que nunca saiu do aparelho não
bloqueia o documento — e não deveria, porque o servidor não sabe dela. A tela
pode avisar que há mídia aguardando envio; não pode transformar isso em bloqueio.

## Renderização assíncrona

`POST .../render` responde "pedido aceito". O trabalho acontece fora da
requisição, e o snapshot não se mexe por causa dele. Repetir enquanto já está
`PENDING`, `RENDERING` ou `READY` devolve o mesmo estado, sem enfileirar de novo
— o retry é do mesmo documento, não um documento novo.

### Como o app acompanha

Consultando, e só enquanto há o que esperar:

- só em `PENDING` e `RENDERING`;
- com intervalo crescente — 3s, 8s, 20s, 60s;
- com teto de tentativas: o que não ficou pronto em muitas consultas não vai
  ficar por insistência, e um laço apertado gasta a bateria de quem está em
  campo;
- para ao sair da tela, e **não** continua em segundo plano;
- há sempre **Atualizar**, porque não existe notificação de conclusão (MB-07).

## O arquivo

O acesso é emitido no momento de usar e descartado depois. Uma URL assinada é
credencial, não estado de domínio: guardá-la renderia um link morto na próxima
abertura, e compartilhá-la entregaria a credencial em vez do arquivo.

### O que se verifica

**Os primeiros bytes decidem.** O `Content-Type` não serve como prova: o storage
do Orbit devolve `application/octet-stream` para um PDF legítimo, e um proxy mal
configurado devolve uma página de erro com status 200 e o cabeçalho certo. Um
cabeçalho é o que o servidor *diz*; a assinatura `%PDF-` é o que o arquivo *é*.

O nome vem do `Content-Disposition` publicado pelo servidor — é o nome que a
pessoa vê ao abrir ou compartilhar. Quando o cabeçalho não vem, o app constrói
um a partir do tipo e da versão; nunca do identificador do artefato, que não diz
nada a ninguém. O nome é sempre reduzido ao último segmento, sem caminho: um
cabeçalho é entrada externa, e `../` vindo dele não pode virar caminho de
gravação.

### Onde o arquivo fica

No diretório **temporário**, e só. O documento é do servidor; mantê-lo
indefinidamente criaria uma cópia que envelhece sozinha e que ninguém revoga
quando o acesso da pessoa muda. O app baixa para abrir ou compartilhar e limpa
depois.

Um PDF pode conter dados de cliente, endereço, assinatura. Como no resto do
aplicativo, **o armazenamento local não é criptografado** — a proteção é a do
sistema, e a mitigação real é a natureza temporária do arquivo.

### Dois estados, não um

```text
ARTEFATO   o que o servidor diz sobre o documento
DOWNLOAD   o que este aparelho conseguiu fazer com ele
```

O PDF pode estar pronto no servidor e o download ter falhado aqui. Fundir os
dois faria "não consegui baixar" parecer "o documento não existe" — e culparia o
servidor por um problema de rede local.

## Imutabilidade

Trocar a assinatura profissional, mudar o cadastro do cliente, alterar o
equipamento ou acrescentar evidência **depois** não reescreve um documento já
congelado. Ele continua mostrando o snapshot que tinha.

O app não busca o perfil, o cliente ou o equipamento atuais para montar um
documento histórico. Se o domínio suportar nova versão, o servidor cria outra —
a antiga permanece.

## Vocabulário

A tela fala português de campo, não a língua do motor:

| na tela | nunca |
|---|---|
| Documento em processamento | `RENDERING` |
| Documento disponível | Artifact Ready |
| Não foi possível emitir o documento | Render Job failed |

Hash e identificadores não aparecem: quem está no telhado não precisa deles. Um
estado publicado que o app ainda não conhece cai num texto neutro, em vez de
deixar a seção em branco no meio de um atendimento.

## Fronteira offline

**Não há criação de documento offline.** O protocolo MB-04 aceita seis comandos,
e nenhum é documental — a documentação do backend menciona a possibilidade de
enfileirar preparação e renderização, mas o `OfflineCommandType` não a publica.
Antecipar isso criaria uma fila que o servidor não sabe processar.

Sem rede, as ações documentais falham com erro controlado, como qualquer outra
consulta. Nada entra no journal de comandos da FL-05.

## Limites conhecidos

- **O hash do PDF não é verificável pelo aplicativo.** O `ArtifactManifest`
  publica `contentHash`, mas a superfície mobile (`FieldArtifactReadModel`) não o
  expõe. Verificar integridade exigiria o backend publicá-lo.
- Sem visualizador de PDF embutido: o arquivo é baixado e verificado; abri-lo
  fica a cargo do sistema.
- Sem notificação de conclusão de renderização — é MB-07.
- Sem histórico de versões na tela: o contrato publica um artefato vigente por
  fonte, não uma lista.
