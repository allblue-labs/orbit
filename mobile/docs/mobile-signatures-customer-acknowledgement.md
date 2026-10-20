# Assinatura profissional e aceite do cliente

Três coisas que a interface **nunca** funde:

```text
assinatura profissional → do usuário; vale em qualquer documento que ele assine
aceite do cliente       → deste atendimento; registra quem recebeu o serviço
documento               → emitido em separado, com política própria
```

Cada uma tem seu cartão na tela de execução. Um bloco único chamado
"Assinaturas" seria a forma mais rápida de apagar uma distinção que o domínio
mantém de propósito — e concluir o atendimento não é nenhuma das três.

## Assinatura profissional

Pertence ao **usuário**, não ao atendimento, ao cliente ou ao documento. Por
isso mora no Perfil → **Minha assinatura**, e não escondida dentro de um
atendimento: quem precisa cadastrá-la costuma descobrir isso longe do campo.

O servidor mantém **uma ativa por profissional** e diz qual é. O app não conta
versões nem escolhe ativa, e só gerencia a própria — não há tela de
administração de assinatura alheia.

### Pipeline de upload

```text
POST /me/signature/uploads   → reserva URL assinada (fileId, url, headers)
PUT  <url assinada>          → bytes
POST /me/signature           → confirma com storageObjectId e ativa
```

A assinatura **só passa a valer no terceiro passo**. Se a rede cair entre o
envio dos bytes e a confirmação, o que existe é um arquivo órfão no storage —
não uma assinatura ativa, e o app não a marca como tal.

O `PUT` na URL assinada passa pelo cliente canônico (`putBytes`), sem o token da
sessão: a própria assinatura é a credencial, e mandar o `Bearer` para fora da
API seria vazá-lo. Um `Dio` avulso é como nascem dois tratamentos de erro, um
deles esquecido.

### Escolher não é enviar

O servidor **não publica caminho de leitura** da assinatura ativa — não há URL,
assinada ou não, em `MobileSignatureStatusReadModel`. Então não há como exibir
a assinatura que está lá; a tela informa que existe, quando foi atualizada e
para quais papéis vale.

O que dá para mostrar é a imagem que o usuário acabou de escolher, e é o que a
tela faz: escolher exibe a prévia, e só **Confirmar** dispara o pipeline. Sem
esse passo o envio seria às cegas — uma galeria devolve a foto errada com
facilidade, e aqui o arquivo errado vira o traço que sai nos documentos.

Uma falha no envio mantém a imagem escolhida na tela: repetir não deve custar
uma nova ida à galeria.

### Validação antes de gastar rede

PNG, JPEG e WEBP; até 2 MB — os limites do `MobileSignatureUploadReservationDto`,
não outros inventados. A checagem roda na escolha, antes da confirmação: fazer
o usuário confirmar algo já sabidamente recusado é fazê-lo esperar por nada. O backend confere de novo e é a autoridade final; a
checagem local existe para não fazer o profissional esperar uma recusa
previsível, e para explicá-la em português.

**Extensão não é tipo.** Um arquivo chamado `assinatura.png` pode conter um PDF
— basta alguém ter renomeado. A checagem é pelos primeiros bytes: assinatura
PNG (`89 50 4E 47 0D 0A 1A 0A`), JPEG (`FF D8 FF`) e o contêiner RIFF/WEBP.

### Substituir

Cria uma **nova versão**; a anterior fica registrada como substituída. O texto
da tela diz o efeito real:

> A nova assinatura será usada nos documentos futuros. Os documentos já
> emitidos permanecem como estão.

Documentos guardam a assinatura de quando foram gerados. Prometer propagação
retroativa seria falso.

### Dois papéis, uma assinatura

O mesmo profissional pode ser Técnico em Campo e Responsável Técnico. O
contexto (`signedAs`) é do documento, não do arquivo — guardar uma imagem por
papel duplicaria o mesmo traço. Ter conta de Owner não confere papel
profissional: quem decide elegibilidade é o servidor.

## Aceite do cliente

Pertence à **execução**. Registrar ciência nunca chama `PATCH /customers/:id` —
há smoke que lê o cadastro antes e depois e confere que `legalName`,
`tradeName` e `updatedAt` não mudaram.

`signerName` é de quem recebeu o serviço naquele atendimento: pode ser o
zelador, o síndico, quem estava presente. A tela diz isso ao técnico, para que
ninguém tente "corrigir" o cadastro.

### O aparelho passa de mão

É a única tela do app pensada para ser lida por outra pessoa. Ela mostra o
resumo, o campo do nome e a confirmação — sem navegação administrativa à vista
enquanto o cliente decide. A sessão continua sendo a do profissional: o aceite
não cria identidade nem autenticação própria.

### Resumo congelado

`serviceSummary` chega redigido do servidor, e é exatamente o texto que o
`contentHash` cobre. Montar um resumo alternativo no app quebraria a
correspondência: o cliente concordaria com um texto e o backend registraria
outro.

O comando devolve `contentVersion` e `contentHash` **verbatim**. Se o
atendimento mudou nesse meio-tempo, o servidor recusa com 409 —

> O atendimento foi alterado. Revise os dados antes de coletar uma nova
> assinatura.

— e a tela recarrega a preparação em vez de registrar concordância com um texto
que ninguém leu.

### Aceite não é assinatura

A assinatura gráfica é **opcional** por política (`signatureRequired: false`).
Por isso o termo é "aceite" / "ciência", nunca "assinatura do cliente". E em
lugar nenhum se promete assinatura digital certificada, qualificada ou
ICP-Brasil — o produto não faz isso, e há teste que reprova essas palavras.

## Conclusão e documento

Concluir o atendimento continua separado. O app **não** exige aceite antes de
concluir: se o backend publica `COMPLETE`, o botão existe. E concluir não emite
documento — a tela diz "a emissão acontece depois da conclusão, em separado".

A política de signatários é consumida, não reconstruída: a cadeia
`completedBy → startedBy → responsável` é resolvida no servidor, e o app mostra
o que veio.

## Fronteira offline

Sem rede não há cadastro local de assinatura nem aceite guardado em silêncio.
Falha é falha — a fila de comandos é FL-05, e antecipá-la parcialmente criaria a
pior versão: o técnico achando que registrou.

## Lacuna conhecida

**A preparação não publica se um aceite já registrado ainda corresponde ao
estado atual.** `existingAcknowledgement` traz nome, data e se houve assinatura
— sem o hash com que foi registrado. O backend só invalida um aceite quando ele
é **substituído** (`invalidationReason: 'REPLACED'`); o desalinhamento por
mudança no atendimento aparece apenas no 409 ao tentar coletar de novo.

Por isso o app apresenta o aceite anterior como **fato** — "fulano deu ciência
em tal data" — e acrescenta "se o atendimento mudou depois disso, colete
novamente", sem afirmar que segue válido nem calcular hash por conta própria.
Um indicador de "aceite desatualizado" exige o backend publicar essa
correspondência.

## Integração

| PR | Relação |
|---|---|
| FL-03 — execução | `professionalSignature` já vinha na preparação; aqui ganhou tela |
| FL-05 — offline | o envelope de comando do aceite já é compatível com a fila |
| FL-07 — documentos | emissão e download; aqui só se lê que existem |
