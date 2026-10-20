# Assinatura, períodos de cobrança e avaliação gratuita

## A assinatura é a autoridade

A partir da PR-PL-02, quem responde "o que esta organização contratou" é
`OrganizationSubscription`, e não `organizations.plan_id`. A coluna antiga
continua existindo — remover uma coluna referenciada por inquilinos em produção
é outra PR — mas ela deixou de decidir.

Quando o Stripe entrar, na PR-PL-03, ele traduzirá os eventos dele para os
comandos daqui. O provedor de pagamento é uma fonte de fatos financeiros; a
autoridade comercial continua sendo esta camada. Registrado em
`docs/adr/ADR-007-subscription-is-the-entitlement-authority.md`.

## Cobrança e uso são períodos diferentes

O cliente compra **tempo de acesso**, não um pacote acumulado de cotas.

```text
MONTHLY     cobrança 1 mês    → uso 1 mês
SEMIANNUAL  cobrança 6 meses  → uso 1 mês  (6 janelas)
ANNUAL      cobrança 12 meses → uso 1 mês  (12 janelas)
```

Assinatura começando em 15/09:

```text
cobrança anual   15/09/2026 → 15/09/2027
janelas de uso   15/09→15/10, 15/10→15/11, … doze delas
```

A periodicidade muda preço, duração e renovação. **Não muda direito nenhum**: o
Essencial tem 500 ordens de serviço por mês no mensal, no semestral e no anual.
E nada sobra de um mês para o outro — usar 100 de 500 não carrega 400 adiante.

### O mês é o do inquilino

Nunca o do calendário. Quem assinou dia 17 tem janelas que começam dia 17. A
mesma aritmética ancorada serve à cobrança e ao uso, com tamanhos diferentes —
duas contas parecidas seriam duas contas divergindo.

Âncora em 31 de janeiro passa por 28 de fevereiro e volta a 31 de março, porque
toda janela é calculada da âncora original. Somar de janela em janela prenderia
o cliente ao dia 28 para sempre, e um ano depois ele estaria sendo cobrado
noutro dia do mês. Em ano bissexto, 29 de fevereiro existe e é usado.

## Preços congelados

| | Mensal | Semestral | Anual |
|---|---:|---:|---:|
| Essencial | 5.990 | 32.940 | 59.900 |
| Profissional | 14.990 | 82.740 | 149.900 |
| Profissional + Inteligência | 24.990 | 137.940 | 249.900 |
| Empresarial Ilimitado | 69.990 | 386.340 | 699.900 |

Em **centavos**, inteiros. `0.1 + 0.2` não é `0.3` em ponto flutuante, e
dinheiro não perdoa arredondamento silencioso.

Não existem doze planos. Existem quatro planos e três periodicidades.

## Ciclo de vida

| Estado | Acessa o produto? | Renova? | Troca de plano? | Próximos estados |
|---|---|---|---|---|
| `TRIALING` | sim | — | sim | `ACTIVE`, `CANCELED`, `EXPIRED` |
| `ACTIVE` | sim | sim | sim | `PAST_DUE`, `GRACE_PERIOD`, `SUSPENDED`, `CANCELED`, `EXPIRED` |
| `PAST_DUE` | sim | sim | não | `ACTIVE`, `GRACE_PERIOD`, `SUSPENDED`, `CANCELED` |
| `GRACE_PERIOD` | sim | sim | não | `ACTIVE`, `SUSPENDED`, `CANCELED` |
| `SUSPENDED` | **não** | sim | não | `ACTIVE`, `CANCELED` |
| `CANCELED` | não | não | não | terminal |
| `EXPIRED` | não | não | não | terminal |

`PAST_DUE` e `GRACE_PERIOD` mantêm o acesso de propósito: uma cobrança que
falhou é quase sempre um cartão vencido, e derrubar a operação de campo de uma
empresa por isso seria a punição errada para o problema errado.

A carência é de **7 dias**. Terminada, suspende.

### Nada disso apaga nada

Suspender, cancelar, expirar e rebaixar mudam **acesso**. Organização, usuários,
clientes, ordens, equipamentos, PMOC, RVT e documentos continuam onde estavam.
Uma organização suspensa que regularize encontra tudo intacto.

## O estado é uma função do relógio

`subscription.projection.ts` calcula o estado a partir do que está guardado mais
o instante atual. O reconciliador aplica exatamente essa função e **persiste** o
resultado — mas nenhuma leitura espera por ele.

É isso que impede um worker parado por três horas de dar três horas de acesso
grátis a quem venceu, ou de negar acesso a quem está em dia. Rodar duas vezes
seguidas não muda nada: a segunda passagem não encontra o que reconciliar.

O reconciliador declara contexto de plataforma na transação dele, porque varrer
prazos não é trabalho de um inquilino — não existe "a organização" da passagem,
existem todas. A única tabela que ele toca é a da própria assinatura.

## O retrato dos direitos

Cada assinatura guarda `planCode`, `catalogVersion` e um retrato completo dos
direitos contratados. Se amanhã o Essencial passar de 5 para 8 usuários, quem
assinou ontem continua com 5 até renovar ou trocar de plano.

O retrato usa o **mesmo formato** que o perfil declarado de um plano já usava
(`{ capabilities, allocation, usage }`), e passa pelo mesmo verificador
fecha-falha: retrato incompleto ou inválido falha, e não vira ilimitado.

| | Muda globalmente | Estável para quem já assinou |
|---|---|---|
| rótulo, descrição, preço de tabela | sim | — |
| capacidades e limites | sim, para novas assinaturas | sim |

## Troca de plano

**Subir vale agora.** O cliente comprou mais e recebe na hora — a capacidade de
inteligência passa a existir no mesmo instante.

**Descer vale no próximo período.** Tirar capacidade e teto no meio de uma
operação quebraria o trabalho de quem está no telhado com o aplicativo aberto,
por um motivo administrativo.

Qual é qual sai do preço de tabela mensal do catálogo — a única ordenação
comercial que existe entre os planos, e ela não depende de nome.

### Acima do limite depois de rebaixar

Uma organização com 14 usuários que desce para um plano de 5:

- **nada é apagado ou desabilitado.** Os 14 continuam trabalhando;
- **nada novo é criado.** O 15º usuário é recusado até a conta voltar ao teto.

Não há remediação automática. Escolher quem sai é decisão de quem contrata.

## Cancelamento

Sempre no fim do período já contratado. Mensal, semestral e anual seguem a mesma
regra: o cliente pagou por um tempo de acesso e recebe esse tempo. Enquanto o
período corre, o cancelamento agendado pode ser desfeito.

Não há devolução nem cálculo proporcional nesta PR. Isso é decisão financeira, e
não existe provedor financeiro nesta etapa.

## Avaliação gratuita

**30 dias, só no Essencial.** Pode preceder qualquer periodicidade — quem quer o
plano anual testa 30 dias antes.

### A identidade forte é o documento

Uma conta nova não é uma empresa nova. Uma organização nova também não. O que
identifica quem contrata é o CPF ou o CNPJ.

| Tentativa | Resultado |
|---|---|
| primeira vez com aquele documento | concedida |
| usuário novo, mesmo documento | recusada |
| organização nova, mesmo documento | recusada |
| endereço novo, mesmo documento | recusada |
| documento diferente, mesmo endereço | **concedida** |

Endereço não bloqueia ninguém. Coworking, shopping, condomínio empresarial e
grupo econômico compartilham endereço legitimamente todos os dias; bloquear por
endereço recusaria empresas de verdade para atrapalhar uma fraude que muda de
endereço em cinco minutos. Razão social e e-mail, pelo mesmo motivo, também não
são identidade forte. Todos eles são **registrados** como sinal, e nenhum decide
sozinho.

### HMAC, não SHA

CPF tem 11 dígitos, CNPJ tem 14. O espaço inteiro cabe numa tabela: com um SHA
simples, quem obtivesse a coluna teria um dicionário reversível de todo CNPJ que
já testou o Orbit em algumas horas de GPU.

A coluna guarda `HMAC-SHA256` com `TRIAL_FINGERPRINT_SECRET` — segredo próprio,
de domínio separado. Reaproveitar o segredo do JWT ou a chave de cifra acoplaria
as rotações: girar a chave de sessões passaria a apagar a memória do antifraude,
e ninguém perceberia antes de os testes gratuitos duplicarem.

O documento cru **não** é copiado para o registro. A organização já o guarda na
unidade de negócio, pelo propósito de negócio dela; o antifraude precisa da
impressão, não de uma segunda cópia do dado sensível.

### A recusa não explica

Sempre a mesma frase: *"Este período de teste não está disponível."* Dizer o
motivo transformaria a resposta pública num verificador de quem é cliente do
Orbit — um atacante com uma lista de CNPJs faria a consulta que a Receita não
faz. O motivo fica no log, que tem outra plateia, e sem o documento nem a
impressão inteira.

### Concorrência

O índice único é **global** e é ele o antifraude — não uma consulta que alguém
pode esquecer de fazer. Quatro pedidos simultâneos com o mesmo documento
resultam em exatamente uma concessão: três colidem no banco.

A verificação prévia existe só para dar a resposta barata no caso comum.

### O registro é global para escrever e privado para ler

A tabela precisa detectar a mesma entidade em **outra** organização — uma
política de RLS ingênua quebraria justamente isso. A solução tem duas partes:

- o **índice único** vale entre organizações, porque unicidade no Postgres não
  passa por RLS. É o que garante a concessão única;
- a **leitura** é isolada por inquilino: cada organização enxerga a concessão
  dela e nenhuma outra. Uma credencial de runtime vazada não vira lista de quem
  já testou o Orbit.

A única leitura cruzada é `app_trial_fingerprint_consumed(text)`, uma função
`SECURITY DEFINER` que devolve um booleano e nada mais: nem organização, nem
data, nem quem. `PUBLIC` não tem `EXECUTE`; só o papel de runtime tem.

O registro também não aceita `DELETE` pelo papel de runtime: a memória de que
uma avaliação existiu **é** o antifraude.

## Migração dos inquilinos existentes

`npm run bootstrap:subscriptions` cria uma assinatura ativa espelhando o plano
que a organização já tem. Idempotente. E recusa três coisas:

- **nenhuma avaliação retroativa.** Quem já é cliente não ganha trinta dias por
  causa de uma migração, e o registro antifraude não é semeado com documentos de
  quem nunca pediu avaliação;
- **nenhuma troca de plano.** A organização continua exatamente onde estava;
- **nenhum contrato para fixture.** Plano fora do catálogo comercial —
  `STARTER`, `OWNER_FULL_ACCESS`, planos de teste — não vira assinatura. Continua
  resolvendo pelo caminho legado, que é o que já era. Inventar um contrato
  comercial para um inquilino interno faria a plataforma cobrar de si mesma.

A âncora é a data que a organização já tinha, de modo que a janela de uso nasce
igual à que a PR-PL-01 já usava — nenhuma cota é zerada nem duplicada.

### Sem assinatura, e ainda assim fecha-falha

Uma organização sem assinatura resolve pelo plano apontado nela: plano de
catálogo recebe os direitos do catálogo; plano legado recebe o perfil legado
explícito. Em nenhum caso a ausência vira "ilimitado".

## Fronteira com a PR-PL-03

Não foi implementado aqui, e é de propósito: Stripe, webhook, checkout, portal
de cobrança, meio de pagamento, fatura, dado de cartão, devolução, cálculo
proporcional e qualquer interface.

Os comandos `reportPaymentFailed` e `reportPaymentSucceeded` existem como
domínio, e é a partir deles que a PR-PL-03 ligará os eventos do provedor.
