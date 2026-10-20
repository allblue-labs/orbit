# Fundação do app de campo

O que esta base garante, e o que ela deliberadamente se recusa a fazer.

## Autoridade do servidor

```text
O Mobile não decide:
- autorização
- elegibilidade de atribuição
- transições de estado
- conformidade
- disponibilidade de execução
```

O app **executa fluxos autorizados**. Quando o backend publica `allowedActions`,
`primaryAction` ou `blockedReason`, o app renderiza a lista pronta e traduz o
motivo. Não recalcula, não completa e não antecipa.

A tentação recorrente é escrever `if (status == aberta) podeIniciar`. É assim
que nasce a segunda máquina de estados — a que diverge da do servidor na
primeira regra nova, e ninguém percebe até o técnico apertar um botão que a API
recusa. `lib/core/presentation/field_registry.dart` existe para traduzir e
**não sabe o que é status**.

Guards de navegação escondem o que o backend recusaria, para não oferecer ação
impossível. Esconder não é segurança: quem recusa é o NestJS.

## Sessão

```text
abrir o app
→ ler o armazenamento seguro
→ validar / renovar
→ resolver o contexto
→ rotear
```

A splash existe para que nenhuma tela autenticada pisque antes da decisão.

**Tokens vivem só no armazenamento seguro** — Keychain no iOS,
EncryptedSharedPreferences no Android. Nunca em `SharedPreferences`, nunca em
cache de leitura, nunca em log. `TokenPair.toString()` imprime apenas o prazo.

### Renovação concorrente

O backend **consome o refresh token a cada uso** e emite um novo par. A tela
inicial dispara várias requisições em paralelo; se cada 401 disparasse o próprio
refresh, a primeira rotacionaria o token e as demais chegariam com um token já
consumido — derrubando a sessão sem motivo.

Duas proteções em `SessionAuthenticator`:

1. **Chamada única em voo** — requisições concorrentes aguardam a mesma
   `Future`.
2. **Janela de rotação** — quem saiu antes da rotação recebe o par recém-emitido
   em vez de tentar consumir um token morto.

Falha de renovação encerra a sessão e emite `onExpired`; a navegação reage.

### Logout

Limpa tokens, cache de leitura com escopo e o estado do autenticador. Ainda não
há fila offline; quando houver (FL-05), a política de descarte de comandos
pendentes precisa ser decidida antes — apagar trabalho não sincronizado é perda
de dado, não limpeza.

## Rede

`OrbitApiClient` é o **único** ponto que conhece a URL e o envelope. Nenhum
widget faz requisição: a UI chama providers, que chamam repositories, que chamam
o cliente. Features ganham repositories sobre esse limite — nunca um cliente
próprio.

O envelope `{ success, data, requestId }` é desembrulhado no cliente. Erros
viram `OrbitException` com `status`, `code` e `requestId`.

| Situação | Apresentação |
|---|---|
| 401 | renova quando possível; falhando, limpa a sessão e vai ao login |
| 403 | "Você não possui permissão para realizar esta ação." — sem "tentar novamente" |
| 404 | ausência neutra, sem distinguir inexistente de fora de escopo |
| 409 | "Os dados foram alterados. Atualize e tente novamente." — botão **Atualizar** |
| sem rede | fala do aparelho, oferece nova tentativa |
| inesperado | mensagem do servidor + `Referência: <requestId>` |

O `requestId` não é para o usuário entender: é para ele dizer ao suporte qual
requisição falhou. Por isso não aparece em 409 nem em falta de rede — ali ele
seria ruído.

## Tempo

Duas coisas que o app não pode confundir:

```text
instante   → um ponto no tempo; exibir no relógio de quem lê está certo
data civil → um dia no calendário de alguém; só significa algo dentro de um fuso
```

`CivilDate` existe para tornar impossível o erro que `DateTime` convida a
cometer. Não há função que converta uma na outra.

**"Hoje" não é uma pergunta que o aparelho saiba responder.** O técnico trabalha
no fuso da unidade; o telefone pode estar em roaming ou com o relógio errado. A
agenda envia o **instante** e deixa o servidor decidir em que dia civil ele cai —
e é a data que o servidor devolve (`range.timezone`, `days[].date`) que a tela
exibe e da qual navega.

O caso que isso impede: às 22h em Recife (UTC-3), a meia-noite "local" do
aparelho já é o dia seguinte em UTC, e o servidor devolveria a agenda do dia
errado.

Formatação em `OrbitFormat`, um lugar só, em `pt_BR`.

## Contratos

Os contratos Dart são **espelhos escritos à mão** dos Read Models do backend —
não há geração de código para Flutter. Isso funciona até alguém acrescentar um
campo no NestJS: o app continua compilando, os testes continuam passando, e o
dado novo é ignorado em silêncio. O erro não aparece; a funcionalidade só não
existe.

`test/contracts/contract_drift_test.dart` lê o TypeScript e confere, campo a
campo, que o espelho cobre o que o Read Model publica. Ele encontrou drift real
na primeira execução: o contexto de campo do QR omitia cliente, setor, último
atendimento, próxima manutenção, contextos de PMOC e disponibilidade.

Não há lista de exceções no gate, de propósito: um campo que o espelho decide
não carregar deveria ser decisão discutida, não uma linha silenciosa.

## Navegação

`GoRouter` com redirect por estado de sessão: restaurando → splash; sem sessão →
login; autenticado → shell. O shell tem cinco entradas — Início,
Atendimentos, Agenda, Documentos e Perfil — e o indicador de fila acima da barra, visível
durante o trabalho.

Fluxos específicos entram por item de trabalho, deep link ou etiqueta. Rotas
novas não viram aba: o app de campo precisa de poucas entradas e nenhum "Em
breve" em produção.

## Estados

`SectionCard`, `SectionLoading`, `SectionEmpty`, `SectionError` e
`StaleDataBanner`. Uma seção que falha mostra o próprio erro e **não derruba a
tela**: as demais continuam utilizáveis — regra que vale mais em campo, onde a
conexão oscila.

## Fronteira offline

Existe hoje: cache de leitura com aviso de dado velho (`StaleDataBanner`), fila
de uploads de evidência, e o monitor de conectividade.

Não existe ainda, e é da FL-05: fila de comandos, protocolo de sincronização e
resolução de conflito. A separação a manter é

```text
estado do servidor  |  comandos pendentes  |  estado de sincronização
```

Misturá-los agora tornaria a fila um cache — e um cache que aceita escrita é
como se perde trabalho de campo.

## O que vem depois

| PR | O que a fundação já oferece |
|---|---|
| FL-02 — Dashboard e Work Queue | contratos espelhados e conferidos, estados de lista, pull-to-refresh |
| FL-03 — Execução | `allowedActions`/`primaryAction` prontos para consumo, área de ação inferior |
| FL-04 — Assinatura e aceite | papéis profissionais com os termos oficiais |
| FL-05 — Offline e sync | fronteira documentada acima |
| FL-06 — Evidência e documentos | pipeline de upload e cliente binário |

Nenhuma dessas precisa de um router novo, um cliente novo, um mapeador de erro
novo ou outra arquitetura de estado.
