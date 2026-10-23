# Pagamento: evidência de produção e publicação verificável

Em 23/10/2026 foram feitas somente leituras públicas de
`https://orbit.allblue-labs.com/login`, `/cadastro?plano=PROFESSIONAL` e dos
scripts referenciados nessas páginas. Nenhuma env local foi usada para concluir
qual configuração estava em produção; nenhuma conta ou cobrança foi criada.

## Resultado observado

O arquivo publicado `/_next/static/chunks/2xynayfgeowl6.js` exportava `useRegister`
com `onSuccess` chamando apenas o redirecionamento autenticado. Não continha a
abertura do Checkout após o cadastro. O formulário publicado ainda exibia
“Sua organização está pronta”, anterior à correção desse fluxo.

A conferência pública também não encontrou os novos identificadores de release
em `/api/release` e `/api/v1/release`. Isso não identifica sozinho a versão da
API, mas o código JavaScript confirma que o frontend recebido pelo navegador
não continha a correção. Flags de cobrança habilitadas não atualizam um bundle
já construído. A origem pode estar usando imagem/container antigo, outro
checkout ou haver cache de HTML no proxy/CDN; a leitura pública não permite
escolher entre essas causas sem conferir o servidor.

## Correção complementar

- Contas `PENDING_PAYMENT` ficam na contratação, com perfil e pagamento
  acessíveis. Rotas de produto marcadas com `RequiresActivePlan` recusam também
  leitura com `402 SUBSCRIPTION_PAYMENT_REQUIRED` até o primeiro pagamento.
  Assinaturas vencidas continuam podendo consultar seu histórico.
- O cadastro comercial não grava um teste legado de 14 dias antes de decidir a
  elegibilidade pelo contrato canônico.
- A sessão prioriza a assinatura canônica. Uma compra pendente não publica um
  prazo de acesso; testes usam `trial.endsAt`, não o aniversário da cobrança.
- Avisos de vencimento exigem uma data já passada. Uma data futura não é
  apresentada como “seu teste terminou”.
- A confirmação de mudança mantém o erro dentro do modal e valida a URL antes
  de navegar. Abrir uma sessão de pagamento não espera um refetch do dashboard
  de cobrança, pois ainda não houve alteração da assinatura.

## Publicar o commit correto

Execute no servidor, no checkout que contém e já versionou esta correção.
Confira o resultado de `git rev-parse HEAD` contra o commit que pretende publicar.
Não substitua nem exponha os segredos de Stripe já configurados em produção.

```sh
git rev-parse HEAD
export ORBIT_COMMIT_SHA="$(git rev-parse HEAD)"
export ORBIT_BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker compose build --no-cache api migrate frontend
docker compose run --rm migrate
docker compose up -d --no-deps --force-recreate --pull never api frontend
docker compose images
node scripts/check-web-release.mjs https://orbit.allblue-labs.com "$ORBIT_COMMIT_SHA"
```

A migração de intenções de checkout da correção anterior continua necessária.
Esta correção complementar não acrescenta migration.
`restart` não troca a imagem de um container já criado.

O último comando faz apenas GETs públicos, com query de diagnóstico para evitar
reaproveitar HTML antigo. Confere o marcador `checkout-required-v2`, os commits
de API/frontend e a presença da chamada de checkout no JavaScript realmente
referenciado pelo cadastro. Uma divergência termina com código 1. Nenhum
`.env`, cookie, token, dado de cliente ou API autenticada é lido.

Para comparar origem e endereço público, usando a porta de frontend desta
implantação:

```sh
curl --fail --silent http://127.0.0.1:7070/api/release
curl --fail --silent https://orbit.allblue-labs.com/api/release
```

Se a origem estiver nova e o público antigo, confira o upstream do Nginx e as
regras de cache/purge do HTML no CDN. Se a origem também estiver antiga, confira
o diretório do build, o commit e a imagem efetivamente usada pelo container.
Os endpoints de release expõem apenas serviço, commit, horário do build e
marcador do fluxo; não expõem flags ou credenciais.

## Validar depois da publicação

1. Cadastro em plano pago: sai para o Stripe. Cancelar o pagamento volta à
   contratação; `/dashboard` e `/clientes` não abrem o produto sem pagamento.
2. Essencial elegível: recebe os 30 dias reais; a data exibida é a do teste.
3. Conta em teste: a troca avisa a perda dos dias restantes, faz o POST de
   `change-plan` e abre o Stripe. Se falhar, a recusa fica no modal.
4. Pagamento confirmado: o webhook processado atualiza plano e acesso. O
   redirect isoladamente continua sem conceder direitos.

Não altere assinaturas existentes para `ACTIVE` como reparo de navegação.
Contas que ficaram sem assinatura canônica por cadastro parcial devem usar o
reparo específico descrito em `registration-plan-handoff.md`.
