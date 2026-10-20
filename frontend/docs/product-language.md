# Linguagem de produto

O Orbit fala com quem administra uma empresa de refrigeração. Essa pessoa
conhece PMOC, RVT, carga térmica e responsável técnico. Ela não conhece — e não
deveria precisar conhecer — Read Model, snapshot, state machine ou renderizador.

A regra que organiza tudo o que vem abaixo:

> A interface explica **o que aconteceu, o que isso significa e o que fazer
> agora**. Não explica como o sistema foi construído.

## Domínio ou implementação

A pergunta não é "esse termo é técnico?", e sim "esse termo é do **negócio** de
quem usa?".

| termo técnico do negócio — fica | termo técnico de software — sai |
|---|---|
| PMOC, RVT, carga térmica | Read Model, snapshot, DTO |
| Responsável técnico, ordem de serviço | state machine, transição |
| Receita, despesa, vencimento, saldo | endpoint, payload, idempotência |
| Evidência, aceite do cliente, assinatura | manifest, artifact execution |

`PMOC` é linguagem de produto. `PmocEquipmentExecutionReadModel` não é.

## Tom de voz

Claro, profissional, direto, calmo. B2B, não conversa de aplicativo de consumo.

Não usar: `Oops!`, `Algo deu errado :(`, `Eita!`, `Ops!`

Usar: `Não foi possível carregar os dados.` — e, quando houver o que fazer, um
botão ao lado: `Tentar novamente`.

## Situações

O usuário pode e deve ver o **estado de negócio**. O que ele não vê é o **nome
técnico** desse estado.

```text
o sistema guarda   IN_PROGRESS
a tela mostra      Em andamento
```

Enums crus nunca aparecem — nem no texto visível, nem em `aria-label`, nem como
legenda em fonte monoespaçada "para referência". Uma situação que o Orbit ainda
não conhece vira texto legível (`AGUARDANDO_REVISAO` → "Aguardando Revisao"),
nunca o identificador.

O mapeamento vive nos registries, uma vez cada. Situações de ciclo de vida
compartilhadas — ativo, inativo, suspenso, pendente — estão em
`src/registry/lifecycle.ts`. Situações específicas de um módulo ficam no
registry daquele módulo, porque significam coisas diferentes.

**Não** criar um `STATUS_LABELS` novo num componente: se a tradução já existe,
importe-a; se não existe, acrescente ao registry.

## Glossário

| interno | na tela |
|---|---|
| `ARTIFACT` / Artifact Studio | Documento · Modelos de documento |
| `RENDERING` / renderização | Documento em processamento |
| `PENDING` (documento) | Na fila |
| `READY` | Documento disponível |
| `FAILED` | Não foi possível emitir o documento |
| `IN_PROGRESS` | Em andamento |
| `COMPLETED` | Concluído |
| `ACTIVE` / `INACTIVE` | Ativa / Inativa |
| `SUSPENDED` | Suspensa |
| snapshot | Conteúdo · retrato do período |
| `sourceHash` / `contentHash` | Código de verificação |
| `allowedActions` | (nunca aparece — as ações disponíveis simplesmente são as que aparecem) |
| `blockedReason` | O que falta para continuar |
| Read Model / endpoint | (nunca aparece — descreva o que falta no produto) |

## Erros

Nada de status HTTP na tela. A conversão está em `src/lib/error-copy.ts`:

| situação | o que a pessoa lê |
|---|---|
| 401 | Sua sessão expirou. Entre novamente. |
| 403 | Você não tem permissão para realizar esta ação. |
| 404 | Este item não está mais disponível. |
| 409 | a explicação de negócio do servidor; sem ela, "Os dados foram alterados. Atualize para continuar." |
| 400 / 422 | a explicação de validação; sem ela, "Alguns dados precisam ser revisados." |
| 5xx | Não foi possível concluir a operação agora. Tente novamente em instantes. |
| sem rede | Não foi possível conectar. Verifique sua conexão e tente novamente. |

O 409 e o 400 preservam a frase do servidor de propósito: "O limite de 6
evidências foi atingido" é a informação mais útil que existe, e trocá-la por um
texto genérico esconderia o motivo. A troca só acontece quando a frase é texto
interno — em inglês, ou com identificador cru no meio.

### Referência para suporte

`requestId` acompanha log, auditoria e fila com o mesmo valor. Ele aparece
**discreto, selecionável e só quando existe**:

```text
Código de referência: 01a06244-fb99-7d15-b149-fd90d12688b5
```

Nunca `Request ID:` — o resto da interface fala português.

## Estados vazios

Contextuais e específicos. `Nenhum dado disponível.` não diz nada;
`Nenhum cliente cadastrado.` diz.

Quando existe uma ação real, ela acompanha o texto. Quando o fluxo ainda não
existe, **não** se inventa um botão que leva a lugar nenhum.

## Funcionalidade que ainda não existe

Diga que não existe, e o que existe no lugar:

```text
❌ O backend não publica histórico de cliente.
✅ O histórico do cliente ainda não está disponível.
```

Nunca justifique um botão inerte com "ainda não suportado". Se a ação não
funciona, ela não deveria estar ali — e se precisa estar (porque o dado vizinho
levanta a pergunta), o texto fala do produto, não da API.

## Ações e confirmações

Uma confirmação diz a **consequência real**:

```text
Deseja concluir este atendimento?
Após a conclusão, ele não poderá ser alterado.
```

não

```text
Alterar status para COMPLETED?
```

## Acessibilidade

`aria-label` e `title` são linguagem de produto como qualquer outra. Não pode
acontecer de a tela mostrar "Em andamento" e o leitor de tela anunciar
`IN_PROGRESS`.

## Offline (aplicativo de campo)

O vocabulário da FL-05 já está definido e não muda: **Aguardando sincronização**,
**Sincronizando**, **Precisa de atenção**, **Sem conexão**. Nunca "queued",
"pending command", "sync engine" ou "retrying job".

## O guard

```bash
npm run lint:language
```

Procura vocabulário de implementação **no texto que a pessoa lê** — remove
comentários, isola literais de string e texto JSX, descarta o que é claramente
código. Roda junto com `npm run lint`.

A lista de termos nasceu da auditoria da PR-FE-H01: cada entrada apareceu em
texto real exibido ao usuário. Não é uma lista de palavras proibidas no código —
`sourceId` como nome de variável é código correto.

Texto técnico mantido de propósito fica em `ALLOWED`, no próprio script, **com o
motivo escrito**. Hoje são dois: o erro de programação de `src/lib/env.ts` e a
mensagem de console do `panel-error-boundary`. Nenhum dos dois chega a uma tela.
