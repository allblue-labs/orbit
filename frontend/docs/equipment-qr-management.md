# QR do equipamento — Web

Uma frase governa tudo o que segue:

> QR é **identidade** operacional do equipamento. Não é credencial, e não é
> comando.

Disso decorrem as três garantias que a tela precisa manter: ler a etiqueta não
concede permissão, não cria atendimento e não inicia nada.

## Identidade

Cada equipamento tem uma identidade QR ativa. Ela nasce por **gatilho no
banco** (`assets_ensure_qr_identity`, AFTER INSERT) — inclusive para o
equipamento que o aplicativo de campo cadastra durante uma visita. Por isso não
existe botão "gerar QR": não há escolha a oferecer.

O painel vive no detalhe do equipamento, em [/ativos/:id](../app/ativos). Ele
mostra situação, datas e a etiqueta; e oferece download e rotação.

### O token não aparece

`GET /assets/:id/qr` devolve `{ qrAvailable, status, createdAt, lastRotatedAt }`
— e **não** devolve o token. Não é uma limitação a contornar. O token é o que
dá acesso ao contexto do equipamento para quem já tem permissão; transformá-lo
em texto copiável na tela administrativa o espalharia por prints, conversas e
planilhas. Não há "copiar token" em lugar nenhum.

## Payload

O código gravado contém exatamente isto:

```text
https://<origem>/q/<token de 43 caracteres>
```

Nada mais. Sem identificador de equipamento, cliente, organização ou unidade;
sem número de série; sem endereço. Há teste de navegador que **decodifica** o
PNG renderizado e reprova se qualquer um desses valores aparecer — a prova vem
da imagem que vai colada na máquina, não do que o servidor diz ter gravado.

O token é opaco para o frontend: não é interpretado, decodificado nem usado
para derivar identidade. Vai como veio na URL e volta um Read Model.

## Etiqueta

`GET /assets/:id/qr/render?format=svg|png|pdf` devolve os bytes, com
`Content-Type` e `Content-Disposition` do backend. O nome do arquivo é o que
ele escolheu — `equipment-<código>-qr.<ext>`, com o código do equipamento e
nunca o token.

O caminho é o cliente canônico (`apiClient.raw` → BFF → API), com a sessão em
cookie `HttpOnly`. Um `fetch` paralelo teria de carregar credencial por conta
própria; é assim que nasce um segundo caminho de autenticação.

A pré-visualização é a mesma etiqueta, exibida por `<img>` sobre um object URL.
Não se injeta o SVG com `dangerouslySetInnerHTML`: SVG é um documento que pode
carregar script, e `<img>` renderiza a imagem sem lhe dar essa porta.

Nada é redesenhado no navegador — nem o QR, nem a arte, nem a marca. Branding
vem do backend (`branding=ORGANIZATION|BUSINESS_UNIT`).

### O QR gerado no cliente foi removido

Até esta PR o painel codificava `asset.identifier` com `qrcode.react`. Era um
**segundo mecanismo**: um código que a etiqueta impressa pelo backend não
conhece, apontando para outra resolução. Dois QRs para o mesmo equipamento é um
convite a colar o errado na máquina. A dependência saiu do projeto.

## Rotação

`POST /assets/:id/qr/rotate` revoga a identidade atual e cria outra **na mesma
transação**, sob lock consultivo. A etiqueta anterior para de resolver na hora.

A confirmação diz esse efeito e só ele: o código atual deixa de funcionar, um
novo nasce, e o equipamento e o histórico não mudam. Não promete reimprimir
nem avisar ninguém.

`POST /assets/:id/qr/revoke` existe e faz a **mesma** substituição atômica,
devolvendo `{ revoked, replacementCreated, qr }`. Não há estado "equipamento
sem QR" — o invariante é uma identidade ativa por equipamento, garantido no
banco. Por isso a tela expõe apenas "Rotacionar": duas ações com o mesmo efeito
e nomes diferentes ensinariam uma distinção que o domínio não faz.

Depois de rotacionar, o cliente **esquece** as resoluções em cache
(`removeQueries`), em vez de revalidá-las: aquela consulta não existe mais.

## Resolução

A rota é [`/q/:token`](../app/q) — ditada pelo backend, que grava esse caminho
no payload. Mudá-la invalidaria toda etiqueta já impressa.

Ela é **protegida**. `GET /assets/qr/:token` exige `assets.read`, então quem
chega sem sessão passa pelo login e volta ao mesmo endereço. Abrir a página ao
público entregaria o contexto de um equipamento a quem apenas fotografou um
adesivo.

Uma consulta resolve tudo: `EquipmentFieldDetailsReadModel` traz equipamento,
cliente, local, último atendimento, próxima manutenção, contextos de PMOC e as
ações permitidas. Não há join no navegador — teste de navegador reprova
qualquer consulta de domínio adicional.

### Falha fechada, sem distinção

Token inexistente, substituído, de outra organização ou de outra unidade
recebem a **mesma** resposta do servidor: 404. A tela preserva isso com uma
frase única. Diferenciar os casos entregaria um oráculo para descobrir quais
etiquetas existem.

## Ações

`allowedActions` é a autoridade. O servidor a monta a partir das permissões do
ator, do estado do equipamento e dos contextos de PMOC e RVT — e a tela não
acrescenta nada. Deduzir "está ativo, então pode abrir atendimento" produziria
um botão que a API recusa.

Uma ação publicada que a tela ainda não sabe apresentar simplesmente não vira
botão. Um botão sem nome claro é pior que a ausência dele.

PMOC e RVT reaproveitam as telas canônicas — o link leva ao plano ou à visita
já existentes. Nada de reconstruir busca de PMOC aqui.

### Preparar atendimento não é criar

```text
etiqueta lida → contexto → preparar → formulário preenchido → confirmação → OS
```

`GET /assets/:id/service-order-preparation` devolve o contexto e carrega
`operationCreated: false` — um literal de tipo, não um booleano que um dia
poderia vir `true`. O formulário é o mesmo de qualquer atendimento, apenas com
equipamento, cliente e unidade preenchidos.

A data fica em branco de propósito: a preparação sabe **o que** será atendido,
não **quando**. Sugerir "agora" faria a etiqueta parecer um comando de início.

Há teste de navegador que conta os atendimentos antes de abrir o formulário e
depois de fechá-lo sem salvar, e reprova se o número mudar.

## O Web não executa em campo

Nenhuma ação desta tela inicia, conclui ou assina. Isso pertence ao aplicativo
de campo, com o técnico diante do equipamento — a mesma regra do PMOC e do RVT.

## Lacunas conhecidas

- **Sem indicador de QR na lista de equipamentos.** Seria possível, mas exigiria
  uma consulta por linha: não há endpoint que devolva a situação das identidades
  em lote. Carregar imagem de QR por linha está fora de questão.
- **Sem impressão em lote.** Não existe endpoint de etiquetas em lote; montá-lo
  no cliente significaria N requisições e uma composição de página que o backend
  já sabe fazer melhor.
- **`revoke` não tem apresentação própria**, pelo motivo descrito acima: seu
  efeito é idêntico ao de `rotate`.
- **Concorrência de rotação não é induzível pela UI.** O backend serializa com
  lock consultivo e o invariante é do banco; não há como duas sessões
  produzirem duas identidades ativas.
