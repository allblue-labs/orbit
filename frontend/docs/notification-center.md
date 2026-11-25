# Notification Center

Central de notificações operacionais, sistêmicas e inteligentes.

|            |                                                       |
| ---------- | ----------------------------------------------------- |
| Rota       | `/notificacoes`                                       |
| Capability | `notifications.read`                                  |
| Permissões | `notifications.read`                                  |
| Contratos  | forma **espelhada** — o módulo não publica Read Model |

---

## 1. Endpoints utilizados

| Endpoint                        | Uso                                                        |
| ------------------------------- | ---------------------------------------------------------- |
| `GET /notifications`            | listagem, filtros, paginação **e o contador de não lidas** |
| `PATCH /notifications/:id/read` | marcação individual                                        |
| `PATCH /notifications/read-all` | marcação em lote                                           |

Existem e **não** são consumidos: `POST /notifications` e
`POST /:id/dispatch` (emissão, exige `notifications.manage` — é de quem produz
a notificação, não de quem a lê), `GET`/`PATCH /preferences` e
`POST`/`DELETE /push-subscriptions` (configuração de canal, não a central).

### O contador vem de graça

`GET /notifications` devolve, além de `data` e `meta`, um campo **`unread`**:

```ts
// notification.repository.ts
const [data, total, unread] = await Promise.all([…]);
return { ...PaginationHelper.result(data, total, pagination), unread };
```

É contado no banco e **independe do filtro aplicado** — o `where` do `unread`
ignora `status`, `type` e `unreadOnly`. Ou seja: o badge continua correto mesmo
com a central filtrada, sem endpoint extra e sem contagem no cliente.

---

## 2. Resource Reference

Uma notificação sabe **o que** aconteceu, não **onde fica** a tela.

```
payload: { entityType: "customer", entityId: "…" }
                       │
             readResourceReference()
                       │
                Entity Registry
                       │
                  /clientes/…
```

**Nenhuma URL do backend é usada como destino.** Guardar a rota na notificação
faria o servidor decidir a navegação do cliente: uma rota renomeada quebraria
notificações antigas, e web e mobile precisam de caminhos diferentes para o
mesmo registro.

O contrato (`src/entities/resource-reference.ts`) tem três campos —
`entityType`, `entityId` e metadados opcionais — e é **reutilizável**: qualquer
coisa que aponte para um registro (auditoria, resultado de busca) pode usar a
mesma leitura.

### Tolerância deliberada

`payload` é `Json?` sem esquema, e cada módulo o escreve como acha melhor. O
leitor:

- aceita referência aninhada (`resource`, `reference`, `target`) e plana;
- aceita as grafias correntes de tipo (`entityType`, `resourceType`,
  `targetType`, `type`) e de id;
- traduz o nome do módulo para a chave do registry (`operations` →
  `operation`);
- devolve `null` quando não encontra referência — a notificação continua
  aparecendo, só não navega.

### Entidade desconhecida não quebra a central

Verificado na API com uma notificação apontando para `invoice`, que **não é uma
entidade registrada**: ela aparece normalmente, com o texto "Invoice sem tela
registrada" e sem link. `resolveEntity` devolve definição derivada e a ausência
de `href` significa "não navegável" — o mesmo comportamento de `customer` antes
da PR-10.

---

## 3. Caixa autenticada e polling

A PR-10 de produção removeu o gateway Socket.IO legado da aplicação. A web
consulta a caixa via BFF com cookies HttpOnly; cada requisição verifica sessão,
vínculo, papel e organização atuais. `NEXT_PUBLIC_NOTIFICATIONS_POLL_MS` mantém
padrão de 60 s e piso de 10 s, com atualização ao focar a janela.

O mobile consulta a mesma caixa por HTTP (12 s em primeiro plano) e mantém FCM
para avisos nativos. Nenhum cliente depende de sockets. Réplicas compartilham
notificações e leitura no PostgreSQL, sem salas ou entrega em memória.
`REALTIME` é somente alias legado de `IN_APP`; as preferências novas não o oferecem.
Entregas históricas pendentes desse canal são `SKIPPED`, nunca recibos de socket.

---

## 4. Concorrência entre polling e mutações

O polling e o "marcar como lida" disputam a mesma lista. Três medidas:

1. **`cancelQueries` antes de escrever** — impede que uma leitura em voo
   aterrisse depois da mutação e reponha o estado anterior;
2. **a resposta confirmada prevalece** — a marcação devolve a notificação
   atualizada, e é ela que vale, não um palpite;
3. **`scope` na mutação** — cliques repetidos são serializados.

**Sem atualização otimista.** Marcar como lida pode ser recusado (403 por
capability, 404 quando a notificação não é do usuário); antecipar mostraria um
estado que o servidor talvez rejeite.

### Deduplicação por identificador

A ordenação é `createdAt desc`. Se algo for criado entre duas leituras, um
registro novo desloca os demais e a mesma notificação pode aparecer em duas
páginas. A central deduplica por `id` — o que sai é a segunda cópia do mesmo
registro, nunca informação.

---

## 5. Categorias vêm dos dados

`Notification.type` é `VarChar(80)` e o `NotificationQueryDto` o valida com
`@IsString()`, não `@IsIn` — qualquer módulo pode emitir um tipo novo. Existe um
literal `NotificationType` com quatro valores, mas ele não é imposto.

Então a central:

- traduz os tipos que conhece (inclusive por prefixo: `OPERATION_ASSIGNED` cai
  em "Operação");
- **mostra cru** o que não conhece — um tipo novo precisa ser visto, não virar
  "Outro";
- monta o filtro de categoria com os tipos **que apareceram na página**, não
  com uma lista fixa. Não há taxonomia paralela.

---

## 6. Conceitos que o backend não suporta

| Conceito pedido   | Situação                                                                           |
| ----------------- | ---------------------------------------------------------------------------------- |
| **Busca textual** | não existe — verificado: `?search=` devolve `['property search should not exist']` |
| **Arquivar**      | não há campo nem endpoint                                                          |
| **Fixar**         | não há campo nem endpoint                                                          |
| **Prioridade**    | não há campo; `channels` não é prioridade                                          |
| Realtime no web   | o gateway existe, mas é inalcançável por este cliente (§3)                         |

Nenhum deles foi implementado. Marcação em lote **existe** e está implementada.

Outras limitações do módulo:

| Limitação                                                                         | Consequência                                    |
| --------------------------------------------------------------------------------- | ----------------------------------------------- |
| Sem Read Model de notificação                                                     | forma espelhada do Prisma, com acesso tolerante |
| `payload` sem esquema                                                             | a Resource Reference é lida com tolerância (§2) |
| Sem endpoint de contagem isolado                                                  | o contador vem da listagem, com `limit: 1`      |
| `channels` é obrigatório na emissão (1 a 4 de `IN_APP`/`REALTIME`/`EMAIL`/`PUSH`) | irrelevante para a central, que não emite       |

---

## 7. Badge no Topbar — a menor extensão necessária

O `Topbar` já tinha um botão de sino **com um ponto fixo, sempre aceso**, que
não vinha de dado algum. A extensão foi trocar esse botão por
`NotificationBell`: mesmo tamanho, mesma variante, mesma posição do indicador.

O ganho não é só o número: **o indicador desaparece quando não há nada não
lido**, o que antes não acontecia. Um badge sempre aceso ensina o usuário a
ignorá-lo.

`Topbar` é componente de **layout**; o Design System (`components/ui/**`)
permanece intocado. Nenhum token, tema ou componente base foi alterado.

---

## 8. Verificação contra a API real

```
criar notificação com referência conhecida (customer)   ✓
criar notificação com entidade DESCONHECIDA (invoice)   ✓  aparece, sem link
GET /notifications                                      ✓  total 2 · unread 2
PATCH /:id/read                                         ✓  readAt · status SENT
unread após marcar                                      ✓  1
PATCH /read-all                                         ✓  { updated: 1 }
unread final                                            ✓  0
?search=visita                                          ✓  400 — não existe

tsc --noEmit  ·  eslint .  ·  next build                ✓
Design System                                           intacto
```

---

## 9. O que **não** foi implementado no frontend

- nenhuma contagem local — `unread` vem do banco;
- nenhuma taxonomia de categorias inventada;
- nenhuma simulação de realtime;
- nenhuma URL do backend usada como destino de navegação;
- nenhum arquivamento, fixação ou prioridade;
- nenhum componente novo no Design System.
