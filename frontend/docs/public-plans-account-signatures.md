# PR-FX-01 — Planos públicos, conta, assinaturas e navegação

> Quatro lacunas de produto fechadas antes do PR-36. Nenhuma regra de negócio
> nova: as de cobrança são as da PR-PL-01..04, as de assinatura são as da PR-27,
> e as de aceite são as da MB-03.

## 1. Planos públicos

### A rota canônica

`/planos`. Uma só — `/precos` não existe e não deve passar a existir: duas
rotas para a mesma pergunta dividem link, SEO e manutenção, e uma delas
envelhece.

Ela fica **fora** do matcher do middleware, então é pública por construção, não
por configuração que alguém precise lembrar de manter.

### Duas superfícies, um catálogo

| Onde | O quê |
|---|---|
| Landing (`/#planos`) | Resumo: quatro cartões, periodicidade, CTA e o caminho para a comparação |
| `/planos` | Comparação completa: limites e funcionalidades, lado a lado |
| `/configuracoes?secao=assinatura` | A superfície **autenticada** canônica — contratação, troca, consumo |

As duas públicas leem `GET /plans/catalog`, que já era `@Public()`. **Uma
chamada**, no servidor, cacheada por cinco minutos: uma leitura por plano
transformaria a página de preços numa cascata, e quem chega de um anúncio não
espera.

### A fronteira que mantém a página pública

`src/components/pricing/` não importa nenhum hook de assinatura. É essa
separação — e não um comentário — que impede a página de, por descuido, passar a
exigir login para mostrar preço.

### O que a página não decide

Nada. Preço, limite e capacidade chegam prontos. Ela não multiplica, não aplica
desconto, não infere "ilimitado" de número mágico e **não avalia elegibilidade
de avaliação gratuita**: anuncia a regra do plano (Essencial, 30 dias na
primeira contratação elegível) e deixa a decisão individual para a contratação,
no backend. Perguntar publicamente se um documento já usou o benefício seria
publicar um verificador de quem é cliente do Orbit.

A ordem dos planos sai do **preço publicado**, não de uma lista fixa de códigos:
um plano novo aparece no lugar certo sem que ninguém edite código. A
inteligência sai da **capacidade** `ORBIT_INTELLIGENCE`, não do nome do plano.

### Comparação: duas formas

No celular, uma lista por plano. Quatro colunas não cabem em 375 pixels, e a
tabela que rolava de lado empurrava a página inteira junto — a leitura virava um
exercício de arrastar para descobrir de que plano era aquela coluna. A partir de
`md`, a tabela, que é onde ela ganha.

### O CTA não assina nada

Contratar exige organização autenticada. O botão leva ao cadastro; oferecer um
checkout público prometeria um atalho que o produto não tem.

## 2. O painel de plano legado saiu

Havia dois painéis respondendo à mesma pergunta: `PlanSection` na aba
Organização e a aba Plano e assinatura. O primeiro era o mais pobre dos dois e
ainda caía no **código interno do plano** quando o rótulo comercial faltava
(`organization.plan?.name ?? data.planKey`).

Ficou um. A aba Organização aponta para ele.

Junto saiu `UsageSection`, que duplicava o consumo já mostrado em
`PlanUsageSection`. E `CapabilitiesSection` passou a exibir o **nome** do plano
em vez da chave — `PROFESSIONAL_INTELLIGENCE` não é como ninguém chama o plano.

## 3. Foto de perfil

### O que muda no banco

Uma coluna: `users.avatar_storage_file_id`, referência ao objeto de storage.
Nunca o binário — manter a imagem no `users` transformaria toda leitura de
usuário num download, e a foto perderia o ciclo de vida (validação, hash, URL
temporária) que todo arquivo do produto já tem.

`avatar_url` continua existindo e não foi tocada: é a URL herdada de provedor
externo que algumas contas trazem.

### O caminho do arquivo

```text
POST /identity/me/avatar/uploads  → destino assinado e temporário
PUT  <destino>                    → os bytes
PUT  /identity/me/avatar          → o servidor relê, confere e adota
```

A conferência acontece **depois** de o arquivo estar no storage, sobre os bytes
que ficaram lá — não sobre o que o navegador prometeu. Entre a promessa e a
gravação cabe outro conteúdo. São conferidos: dono do upload, tamanho,
**assinatura de formato nos primeiros bytes** e SHA-256.

A leitura devolve **URL assinada com validade**. Nunca um endereço permanente:
"para sempre" inclui depois de a pessoa sair da empresa.

Trocar a foto apaga a anterior do storage. Foto de perfil não é histórico de
nada — ninguém a audita —, e guardá-la seria acumular imagens de pessoas reais
sem motivo.

### Sem foto

As iniciais. Nenhuma silhueta genérica: duas letras dizem mais do que um
desenho de pessoa, e não parecem um lugar por preencher.

## 4. Assinatura profissional

### O que ela é

A **representação gráfica** da assinatura da pessoa. Não é ICP-Brasil, não é
certificado digital, não é assinatura qualificada — e nenhum texto do produto
sugere que seja. Há teste de E2E cobrando essa ausência.

### O que já existia, e o que faltava

O aggregate `UserSignature` (versionado, com storage seguro, um ativo por
usuário) e os endpoints `mobile/field/me/signature` já existiam desde a PR-27.
Faltavam **duas portas**:

| Faltava | Ficou |
|---|---|
| Web não alcançava as rotas | `identity/me/signature` — mesmo serviço, mesmas regras, outro prefixo |
| Não havia como desenhar | Um pad em cada plataforma |

O controller novo delega ao **mesmo** `MobileSignatureService`. Zero regra nova:
continua exigindo perfil profissional ativo, continua criando versão em vez de
sobrescrever, e a recusa continua vindo do mesmo lugar. Ele mora no módulo
`mobile-field`, ao lado do serviço — o caminho da URL diz a quem a rota pertence
para quem a usa; a fiação diz de quem é o código.

### O pad

Web e mobile produzem o mesmo objeto: um PNG de fundo transparente, recortado
nos limites do traço, com margem. Recortar importa — sem isso a assinatura vira
um retângulo com muito espaço vazio, e no documento aparece minúscula no meio do
nada.

Nada é enviado enquanto se desenha. Só a confirmação produz bytes.

**Pointer Events** na Web: um só conjunto cobre mouse, dedo e caneta. Tratar
`mouse*` e `touch*` em paralelo é o caminho conhecido para o traço duplicado, e
deixa a caneta de fora — justamente quem assina melhor.

### Pad vazio não confirma

Um toque acidental produz um ponto. Exigir extensão em algum eixo **ou**
comprimento acumulado separa "assinou" de "encostou" — sem virar biometria e sem
julgar a assinatura de ninguém. Uma rubrica cabe num quadrado pequeno e percorre
muito caminho; exigir só extensão recusaria assinatura legítima.

O botão de confirmar nasce desabilitado e só habilita com traço válido.

### O técnico assina uma vez

A assinatura é persistente e versionada. A execução usa a **ativa no momento**,
congelada no documento. Trocar depois não reescreve documento histórico — isso é
da PR-27 e continua sendo, com teste de smoke cobrindo.

## 5. Assinatura do cliente

### A distinção que o código protege

```text
Assinatura do técnico   persistente · versionada · reutilizada entre OS
Assinatura do cliente   daquele atendimento · uma vez · nunca reutilizada
```

A confusão é fácil de escrever e difícil de perceber: o pad é o mesmo, o upload
é o mesmo, o formato é o mesmo. O que separa é o destino.

O cliente **não** tem assinatura de perfil. A assinatura da OS A não aparece na
OS B — há teste cobrando exatamente isso, e ele encontrou um defeito real: o pad
sobrevivia à troca de atendimento se o Flutter reaproveitasse o `State`. Hoje a
navegação empurra uma rota nova e o estado nasce limpo por acaso; a limpeza
passou a ser deliberada.

### O caminho

```text
1. o cliente lê o resumo congelado
2. o técnico digita quem está recebendo
3. o cliente assina
4. a imagem sobe, marcada CUSTOMER_ACKNOWLEDGEMENT
5. o comando entra no journal, com o id do arquivo
```

A assinatura vem **depois** do resumo e do nome. Assinar primeiro e ler depois
inverte o sentido do gesto, e é o que transforma aceite em formalidade vazia.

`contentVersion` e `contentHash` viajam verbatim: é o que amarra o aceite ao
texto que o cliente leu. Se o atendimento mudou no meio, o servidor recusa com
409 em vez de registrar concordância com outro conteúdo.

A assinatura gráfica é **opcional** por política do servidor
(`signatureRequired: false`). Sem ela, fica registrado o nome de quem recebeu.
Bloquear a confirmação por falta dela criaria uma regra que o backend não tem.

### Idempotência

O comando passa pelo journal offline como qualquer outra intenção. Reenviar
reenvia a **mesma** intenção — mesmo `commandId`, mesmo `signatureStorageFileId`
— e o servidor responde `ALREADY_APPLIED`. A tela também não deixa confirmar
duas vezes em sequência.

### Limitação conhecida: assinatura offline

O aceite funciona offline: o comando fica no journal e sobe quando a rede volta.
A **imagem** não — reservar o destino do upload exige rede, e o comando carrega
o identificador do arquivo, que precisa existir antes.

Offline, portanto, o aceite é registrado com o nome de quem recebeu, que é
exatamente o que o contrato do backend modela como caso normal. Nenhum caminho
alternativo foi criado para contornar isso: enfileirar a imagem exigiria acoplar
a fila de mídia à fila de comandos, o que é mudança de arquitetura e não cabia
nesta rodada.

## 6. Execuções de artefato saíram do menu

`ArtifactExecution` continua inteiro no backend. O que saiu foi a **porta de
entrada global** — uma entrada de produto para um conceito de arquitetura.

Quem procura um documento procura a **ordem de serviço**, o **PMOC** ou a
**visita técnica**; e o Centro de Documentos reúne o que foi emitido. Uma área
de "execuções" juntava as três sob um nome que ninguém usa para falar do próprio
trabalho.

| O que | Onde ficou |
|---|---|
| Item de menu | Removido |
| `/execucoes` (listagem) | Redireciona para `/documentos` |
| `/execucoes/:id` (contexto) | **Continua** — é o deep link do cliente, da equipe e do ciclo PMOC |
| `ExecutionCenter` e painéis | Removidos: código morto é pior do que menu morto |
| Backend, capabilities, permissões | Intocados |

Redireciona em vez de 404 porque o caminho continua alcançável por favorito e
histórico: um 404 diria "isto não existe", quando o que existe é outro nome para
a mesma coisa.

## 7. Backend — o delta

Somente o necessário. Nenhuma regra de cobrança, de assinatura ou de artefato
foi alterada.

| Mudança | Por quê |
|---|---|
| `users.avatar_storage_file_id` + migração | A foto precisava de persistência; §120 pede referência, não blob |
| `AvatarService` / `AvatarRepository` / 4 rotas | Não havia upload de foto em lugar nenhum |
| `identity/me/signature` | Porta para a Web; delega ao serviço existente |
| `purpose` na reserva de assinatura | Registrar a assinatura de um cliente como "assinatura profissional" seria uma linha falsa na trilha |
| `image-signature.ts` | A conferência de magic bytes existia em duplicata; virou um lugar só |
| `storage` na allowlist do BFF | O navegador precisa alcançar o destino do upload assinado |

## 8. Limitação conhecida: foto e múltiplas organizações

O arquivo da foto pertence ao inquilino (RLS forçada em `storage_files`); o
usuário é global. Quem participa de duas organizações e envia a foto por uma
delas verá as iniciais na outra — o arquivo não é alcançável de lá.

A alternativa seria dar à foto um caminho fora do isolamento por inquilino, o
que é decisão de segurança maior do que esta rodada comporta. A leitura degrada
para as iniciais em vez de mostrar um endereço quebrado.

## 9. Testes

### Novos

| Onde | O quê |
|---|---|
| `src/components/pricing/pricing-catalog.test.ts` | Ordem por preço, avaliação só no Essencial, inteligência por capacidade |
| `e2e/public-plans.spec.ts` | Landing, página pública **sem sessão**, três periodicidades, sem `planKey`, sem armazenamento, CTA, quatro larguras |
| `e2e/account-media.spec.ts` | Foto: enviar, trocar, remover, formato e tamanho recusados. Assinatura: pad vazio, traço, limpar, sem ICP-Brasil |
| `e2e/artifact-navigation.spec.ts` | Menu sem execuções, redirecionamento, deep link vivo, documentos e modelos de pé, plano legado ausente |
| `test/features/signature_pad_test.dart` | O que vale como assinatura, recorte, tamanho do PNG, punho |
| `test/widgets/customer_signature_test.dart` | **OS B abre com pad vazio**, `purpose` correto, comando com o arquivo, aceite sem assinatura, duplo toque |
| `test/features/sync_controller_test.dart` | Reenvio leva a mesma assinatura; aceite sem assinatura não inventa uma |

### Atualizados por mudança de comportamento

`e2e/executions-context.spec.ts`, `e2e/shell.spec.ts`,
`e2e/product-language.spec.ts`, `test/widgets/my_signature_screen_test.dart`.

### O que um teste encontrou

O caso "OS B abre com o pad vazio" **falhou na primeira execução**: o Flutter
reaproveita o `State` quando o widget no mesmo lugar é do mesmo tipo, e o traço
do cliente anterior sobrevivia à troca de atendimento. A navegação real empurra
uma rota nova e o estado nascia limpo por acaso — "por acaso" não é garantia. A
limpeza passou a ser deliberada, em `didUpdateWidget`.
