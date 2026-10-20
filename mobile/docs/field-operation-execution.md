# Execução de atendimento em campo

O que o Flutter faz quando o profissional executa um `SERVICE_OPERATION`, e o
que ele deliberadamente se recusa a decidir.

## Autoridade

```text
O Flutter não implementa a máquina de estados do atendimento.
Ele apresenta o estado publicado e envia comandos semânticos autorizados.
```

Nada aqui calcula se pode iniciar, se pode concluir ou se o checklist está
completo o bastante. `allowedActions` chega pronto e é a **única** fonte do que
a tela oferece; `primaryAction` decide qual é o botão de baixo.

## Preparação

```text
GET /mobile/field/operations/:id/execution-preparation
```

Uma requisição traz tudo: atendimento, cliente, local, equipamentos, escala,
checklist, políticas de material, evidência e artefato, `allowedTransitions`,
`allowedActions`, `primaryAction`, `version` e `executionEligibility`.

**Abrir a preparação não muda nada** — é um `GET`. O smoke lê duas vezes e
confere que `version`, `status` e `startedAt` não mudaram: se a leitura mexesse
no domínio, a versão mudaria.

## Comandos

Nunca há atualização genérica de status. Não existe `PATCH {status:
IN_PROGRESS}` em lugar nenhum deste código — iniciar e concluir são comandos
semânticos, e a transição é decisão do servidor:

```text
POST /commands/start          POST /notes
POST /commands/complete       PUT  /checklists/:id
                              POST /materials
```

Todo comando carrega o mesmo envelope:

```text
commandId | idempotencyKey | expectedVersion | occurredAt
```

## Concorrência e repetição

Dois problemas diferentes, duas defesas diferentes.

**Sobrescrever o que outro mudou** → `expectedVersion`, que é o `updatedAt` do
atendimento como texto. O comando carrega a versão que o usuário viu ao
decidir; se algo mudou desde então, o servidor recusa com 409 e a tela relê em
vez de insistir. O smoke envia uma versão de 1999 e confere a recusa.

**Fazer duas vezes o que se pediu uma** → `commandId`. Uma intenção do usuário
tem uma chave, e reenviá-la é inofensivo: o servidor devolve `idempotentReplay:
true` em vez de um segundo efeito.

Uma descoberta do backend real merece registro: a repetição precisa reenviar o
**payload idêntico**, não só a mesma chave. Reenviar com `expectedVersion`
atualizado recebe `Idempotency key reused with a different payload`. Faz
sentido — é a mesma intenção, tomada no mesmo momento, sobre o mesmo estado. Por
isso o controlador guarda o envelope inteiro, e não apenas a chave.

Enquanto um comando está em voo, a fase é `mutationPending` e a ação fica
desabilitada: é o que impede o toque duplo de virar dois comandos.

## Estados da tela

```text
loading | ready | mutationPending | conflict | error
```

Um estado nomeado em vez de meia dúzia de booleanos — `carregando && !erro &&
pendente` é o tipo de combinação que passa a existir sem ninguém decidir que
deveria.

Todo comando termina relendo a preparação. O estado autoritativo é o do
servidor, não o que o app supôs ao enviar.

## Checklist

Itens, progresso e obrigatoriedade vêm do servidor. A identidade de cada item é
o **ID do backend**, nunca o rótulo ou a posição: dois itens podem se chamar
igual, e a ordem pode mudar.

`required` é **apresentação**. Marcar um item obrigatório não libera a
conclusão, e deixá-lo em branco não a impede — quem decide é `allowedActions`.

O contrato substitui o mapa de respostas inteiro, então o app parte do que o
servidor devolveu e altera um item. Montar o mapa do zero apagaria respostas
que a tela não está mostrando.

O leitor de tela anuncia item e estado como um nó só: "Filtro limpo,
obrigatório, marcado". Alvo de 48px — em campo o toque é com luva.

## Observações

Limite de 2000 caracteres, o do contrato. `visibility` é do domínio (interna
por padrão); o app não inventa destinatário. As notas ficam onde o servidor as
publica — não há lista local paralela.

## Materiais

A busca é do servidor (`GET /catalog/products?search=`). Carregar o catálogo
inteiro para filtrar no aparelho pareceria mais simples até o primeiro
almoxarifado com milhares de itens.

O estoque é do **Inventory**. O app envia a intenção e lê o `balanceAfter` que
voltou; quantidade e saldo chegam como texto, decimal exato, sem passar por
`double`. Recusa por saldo insuficiente é decisão do servidor, mostrada como
veio — o app não ajusta a quantidade sozinho.

## Linha do tempo

Fatos persistidos, na ordem publicada, com a frase que o servidor escreveu.
Nenhum evento é fabricado no cliente para "mostrar" o que o usuário acabou de
fazer: se não está na timeline, não aconteceu.

## Conclusão

`COMPLETE` só aparece quando publicado. A confirmação é proporcional — sem
alarme — e diz o efeito real:

> O atendimento será encerrado. O documento é emitido em separado.

**Concluir não é finalizar documento.** Não colhe assinatura, não registra
ciência do cliente e não gera relatório. Essas são FL-04, FL-06 e FL-07, e
prometê-las aqui seria mentir. Há teste que reprova a promessa.

`startedBy` e `completedBy` são **histórico**: quem executou pode ser outra
pessoa que a atualmente escalada, e trocar um pelo outro apagaria o fato.

## Fronteira

Não há fila offline. Falha de rede durante um comando é falha — o comando não é
guardado em silêncio para "sincronizar depois". Isso é FL-05, e antecipá-lo
parcialmente criaria a pior versão: o usuário achando que registrou.

| PR | O que herda daqui |
|---|---|
| FL-04 — assinatura e aceite | `professionalSignature` já lido na preparação |
| FL-05 — offline e sync | o envelope de comando já é o precursor da fila |
| FL-06 — evidência | `evidencePolicy` já lido; upload desabilitado |
| FL-07 — documentos | `artifactPolicy.eligibleAfterCompletion` já lido |

## Lacunas conhecidas

- **PMOC e visita técnica seguem em leitura.** Suas ações de execução aparecem
  descritas e desabilitadas até as PRs delas.
- **`answers` é JSON livre** e fica contido no contrato, sem espalhar `dynamic`.
- **Sem retry automático de comando.** Depois de um timeout o app relê o estado
  antes de oferecer repetir; reenviar às cegas é o que a idempotência protege,
  não o que ela recomenda.
