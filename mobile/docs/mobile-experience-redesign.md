# Orbit Operator — Redesenho de UX/UI e endurecimento operacional

> Aplicativo de campo. Nenhuma regra de negócio mudou de lado: o que o
> servidor decide continua sendo decidido por ele.

## 1. O problema que este round resolve

O aplicativo funcionava e era feio de um jeito específico: **65 usos de
`Card`**. Cada informação virava uma caixa, caixas dentro de caixas, e numa
tela de celular isso não organiza nada — divide o olhar em dezenas de
retângulos de mesma importância, e o que importa deixa de se destacar porque
tudo se destaca igual.

E a tela inicial abria com quatro contadores. Contador informa; ele não
responde a pergunta que a pessoa faz ao desbloquear o celular às 7h40 no
estacionamento do cliente: **"o que eu preciso fazer agora?"**

## 2. A regra que organiza tudo

> Caixa é para **agrupamento semântico real**; o resto é linha.

Uma lista de atendimentos é uma lista, com separadores e a coluna de horário
alinhada de cima a baixo. Um bloco que junta coisas de naturezas diferentes —
identidade (avatar, nome, e-mail), um comando pendente (natureza, motivo do
bloqueio, ação de descarte) — é uma caixa.

Resultado: **zero** usos de `Card` no aplicativo. O que sobrou de `Card` no
código são a `cardTheme` do tema e comentários explicando por que a caixa saiu.

## 3. Tema

Claro, branco dominante. Azul é **ação**; roxo é **Orbit Intelligence**; verde,
âmbar e vermelho são **estado**. Cor significa; não decora.

Os tokens vivem em `OrbitPalette`, uma `ThemeExtension` com 21 cores de papel —
`background`, `surface`, `ink`, `inkMuted`, `accent`, `accentSoft`, `success`,
`danger`, `intelligence`… A arquitetura comporta um tema escuro **sem que ele
exista agora**: `OrbitPalette.dark` simplesmente não foi escrito, e
`themeMode: ThemeMode.light` é explícito.

`OrbitColors` continua existindo como fachada semântica, apontando para os
mesmos tokens. Foi o que permitiu trocar a paleta inteira sem reescrever 33
arquivos: o vocabulário já era de papel (`textSecondary`, `danger`,
`intelligence`), não de cor.

## 4. Os primitivos

`lib/core/design/orbit_primitives.dart`:

| Primitivo | Para quê |
|---|---|
| `OrbitSection` | Rótulo em caixa alta e respiro. Separa por tipografia, sem borda. |
| `OrbitListRow` | A linha de lista: coluna de leitura rápida, título, apoio, selo. |
| `OrbitStatusBadge` | Estado, com tom semântico. |
| `OrbitQuickAction` | Acesso rápido compacto. |
| `OrbitPanel` | A caixa — só quando o agrupamento é real. |
| `OrbitEmptyState` | Vazio que orienta em vez de constatar. |
| `OrbitRowDivider` | Separador entre linhas. |

`lib/core/design/orbit_wizard.dart` acrescenta `OrbitWizard` — um roteiro de
etapas reutilizável, que **não decide nada de domínio**: quem chama declara
`complete` e `enabled` a partir do que o servidor publicou.

`SectionCard` virou `SectionBlock` — mesma API, agora sem moldura, com
`boxed: true` para os poucos casos em que a caixa se justifica. Uma mudança,
53 telas.

## 5. Tela inicial

`GET /mobile/field/home` — **uma requisição**.

```text
1. quem é você, e que dia é hoje
2. o que já começou           → em andamento, em destaque
3. o que dá para fazer daqui  → ações rápidas
4. o que atrasou / o que é de hoje
5. o que vem depois
6. o que ficou pronto         → documentos e agendamentos recentes
```

Seção vazia **desaparece**. A contagem do servidor acompanha o título quando é
maior que a lista (`ATRASADOS · 7` com cinco linhas é honesto; inventar sete
linhas não seria).

Nada é contado, classificado ou reordenado no aplicativo: `counters`, `next`,
`inProgress`, `overdue`, `today` e o estado de cada documento chegam prontos.

## 6. Navegação

```text
Início · Atendimentos · Agenda · Documentos · Perfil
```

Eram quatro abas. **Documentos** virou destino porque "cadê a OS de ontem?" é
pergunta de todo dia e custava quatro toques e uma memória — o documento só
existia por dentro do atendimento que o gerou.

"Trabalho" virou **"Atendimentos"**: o rótulo antigo descrevia a estrutura de
dados (a fila de itens de campo), não a coisa que a pessoa faz.

A seleção da aba passou a escolher **o destino mais específico**:
`/perfil/sincronizacao` começa com `/perfil`, e a varredura anterior acertava
por acaso enquanto os prefixos não colidissem.

## 7. Leitura de etiqueta (QR)

`GET /assets/qr/:token` já existia no backend e nunca tinha tela. Agora tem:
câmera em tela cheia, lanterna, mira, e **entrada manual** — casa de máquinas
tem pouca luz, etiqueta velha descasca, e luva de raspa não segura um celular
firme.

O token é **chave de busca, nunca autorização**: quem lê continua sendo quem
está logado, e o servidor responde de acordo com as permissões da sessão. A
tela não guarda o token, não o mostra e não o coloca em log.

`equipmentQrToken()` aceita tanto a URL da etiqueta (`…/q/<token>`) quanto o
token puro, e exige que o casamento de 43 caracteres base64url seja o
**segmento inteiro** — sem isso, qualquer texto longo viraria uma requisição.

O resultado mostra o contexto de campo e lista `allowedActions` como *o que é
permitido a você*, **não como botões**: as telas que executam essas ações são
as do atendimento, e um botão que leva a lugar nenhum é pior do que nenhum
botão.

## 8. Execução em etapas

```text
Preparação → Execução → Evidências → Materiais → Confirmação → Finalização
```

Eram sete seções empilhadas numa rolagem só. O roteiro responde **onde estou** e
**o que falta**.

O que **não** mudou: `allowedActions` decide o que vira botão, `blockers` dizem
por que ainda não dá, `version` viaja em todo comando (OCC), e o journal offline
é o mesmo. **Mudar de etapa não envia comando nenhum** — é navegação, e sair no
meio não perde o que já foi registrado.

Etapa "cumprida" vem de `eligible` e do `progress` que o servidor calcula.
Etapa sem conteúdo (um atendimento sem checklist) fica **desabilitada, não
some**: sumir faria "etapa 3 de 5" significar coisas diferentes em atendimentos
diferentes.

## 9. Backend — o que foi acrescentado, e por quê

Somente **Read Models de agregação**. Nenhuma regra nova, nenhuma migração,
nenhuma mudança de banco. Mesmos filtros de permissão, mesmo isolamento por
organização e unidade.

| Rota | Por que existe |
|---|---|
| `GET /mobile/field/home` | Montar "documentos recentes" no aplicativo custaria **uma requisição por atendimento da fila**. |
| `GET /mobile/field/documents` | A tela de Documentos lista o que a inicial resume. Mesma projeção, sem o teto de cinco, com filtro por tipo e cursor. |

O rótulo público do tipo de documento (`Ordem de serviço`, `PMOC`, `RVT`) é
resolvido no servidor: uma segunda tabela de nomes no Flutter divergiria da do
backend no dia em que um tipo novo aparecesse, e o aplicativo antigo mostraria a
sigla crua.

### O estado do documento

`state` tem **três** valores, e a diferença entre os dois últimos importa para
quem está esperando:

| `renderStatus` | `state` | O que a tela diz |
|---|---|---|
| `READY` | `AVAILABLE` | abre |
| `NOT_RENDERED`, `PENDING`, `RENDERING` | `PREPARING` | "Preparando" |
| `FAILED` | `FAILED` | "Falhou" |
| desconhecido | `PREPARING` | "Preparando" |

O mapa é declarado como `Record<ArtifactRenderStatus, …>` — exaustivo, de
propósito. **A primeira versão deste código comparava com `'RENDERED'`**, valor
que nenhum ponto do sistema produz: o estado pronto se chama `READY`. Nada
quebrou, nenhum teste caiu, e os 66 documentos emitidos deste ambiente
apareciam como "Preparando" para sempre. O `Record` transforma o mesmo erro em
erro de compilação.

"Falhou" existir separado de "preparando" é a mesma ideia: preparando resolve
sozinho, falhou não resolve. Chamar os dois de preparando deixaria a pessoa
esperando um documento que nunca chega.

## 10. O download de documento virou serviço

`DocumentDownloader` — pedir acesso, baixar, **conferir os bytes**, gravar.
Extraído porque a sequência passou a ser pedida de dois lugares (a execução e a
lista de Documentos), e duplicá-la significaria que um dia a verificação do PDF
seria corrigida num lado só, e o outro passaria a aceitar uma página de erro
HTML como se fosse documento.

## 11. Smoke — duas correções de acúmulo de dado

Dois testes falhavam por **acúmulo**, não por regressão. Nos dois casos a
correção foi provisionar, não afrouxar: nenhum limite do backend foi alterado e
nenhum dado existente foi apagado.

**RVT (FL-06).** O teste varria a fila atrás de "alguma execução que aceite
evidência" e encontrava sempre a mesma, histórica. Cada rodada somava uma
evidência. Na vigésima, `FIELD_EVIDENCE_RVT_MAX_FILES = 20` fez o que existe
para fazer. Agora a suíte cria a própria execução avulsa
(`POST /rvt/ad-hoc/executions`), com cliente contextual, e o alvo nasce com
zero. Não conseguir criá-la é **falha**, não ausência.

**Atendimento (FL-05, FL-07).** A projeção de campo entrega no máximo 500
atendimentos designados, ordenados por `scheduledStart` — e no Postgres o nulo
vai para o fim. O cenário provisionado não tinha horário, então era o último da
fila de 500; passados 500 atendimentos designados a este técnico, o recurso
recém-criado deixava de existir para o aplicativo e o smoke falhava com 404 num
recurso que acabara de criar. Os cenários passaram a nascer **com horário**, que
é o que um atendimento de verdade tem.

Ver também §13 — a limitação da projeção continua de pé no produto.

## 12. Acessibilidade e resiliência de layout

Verificado por teste em **320, 375, 390 e 430** pixels, com texto do sistema em
**1.0x, 1.3x e 2.0x**. Nenhuma fileira horizontal tem altura fixa: com o texto
ampliado o rótulo cresce, e uma caixa de altura fixa o cortava.

Alvos de toque com no mínimo 48 pixels. A linha de item declara um rótulo único
para leitor de tela, na ordem que importa, e exclui a semântica dos filhos —
sem isso o leitor lê a linha duas vezes, em duas ordens diferentes.

## 13. Limitação conhecida (produto, não teste)

A projeção de campo (`MobileFieldRepository.project`) lê no máximo **500**
atendimentos designados, ordenados por `scheduledStart ASC` — nulos por último.
Um técnico com 500 atendimentos designados **deixa de ver** trabalho novo sem
horário: ele não aparece na fila, no painel nem no pacote offline, e o servidor
responde 404 para o pacote daquele item.

Não foi corrigido nesta rodada porque é regra de leitura do backend, e a rodada
declarou `business rules = 0`. Fica registrado como dívida com reprodução
conhecida.

---

## Continuação — PR-FX-01

Duas coisas desta rodada mudaram telas descritas acima.

### Assinatura desenhada

`lib/core/design/orbit_signature_pad.dart` acrescenta `OrbitSignaturePad` ao
conjunto de primitivos. Ele atende **dois** fluxos que não são a mesma coisa —
a assinatura persistente do técnico e a do cliente, presa ao atendimento — e a
diferença mora em quem chama, não nele.

`Listener`, não `GestureDetector`: assinar é um arrasto contínuo, e o
reconhecedor de arrasto só entrega o gesto depois de decidir que não é rolagem
— o começo do traço se perde nessa decisão.

### A confirmação do cliente ganhou assinatura

A etapa **Confirmação** do roteiro passou a coletar a assinatura gráfica, depois
do resumo e do nome. A assinatura da OS A nunca reaparece na OS B; há teste
cobrando, e ele encontrou um defeito real na primeira execução.

Detalhes em `frontend/docs/public-plans-account-signatures.md`.
