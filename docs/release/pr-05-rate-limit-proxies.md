# PR-05 — Limites coordenados e origem confiável

Achado tratado: **F05** da revisão de produção. O contador anterior existia
somente na memória de cada API; chamadas da web compartilhavam o IP do BFF e
o middleware deixava de atuar em `NODE_ENV=test`.

## Comportamento

- Nginx aceita `CF-Connecting-IP` somente dos intervalos oficiais da Cloudflare.
  Substitui os cabeçalhos recebidos e transmite um endereço único junto de uma
  credencial privada. Não concatena `X-Forwarded-For` fornecido pelo cliente.
- O BFF verifica a credencial e mantém a origem em `AsyncLocalStorage`, isolada
  por requisição. O cliente HTTP central remove qualquer origem fornecida pelo
  chamador e injeta somente a verificada. O código exclusivo do servidor foi
  separado dos utilitários comerciais usados no navegador.
- A API mantém `trust proxy=false`. Sem atestado válido, utiliza o endereço do
  socket; nunca acredita em `request.ip`, `Forwarded`, `X-Real-IP` ou na cadeia
  `X-Forwarded-For`. Login, cadastro, portal e contextos de auditoria usam a
  mesma resolução. As portas de API e frontend permanecem no loopback/rede
  privada: a credencial interna não substitui essa proteção de rede.
- Login, cadastro, refresh, recuperação/alteração de senha por token, confirmação
  de e-mail, cadastro/ativação de MFA, autenticação do portal e sessões de
  checkout/portal de cobrança possuem contagens separadas por ação.
- Padrão da API: **120 tentativas por origem/ação** e **20 por conta/ação** em
  janela fixa de **60 segundos**. São dois orçamentos independentes: trocar IP
  não reinicia o da conta; contas diferentes não compartilham o orçamento de
  conta do container BFF. Pessoas na mesma rede ainda compartilham o teto de
  origem, deliberadamente maior. Nginx acrescenta 120 requisições/minuto por IP,
  com burst de dez nos endpoints sensíveis, independentemente do contador SQL.
- A chave de conta usa e-mail normalizado sem consultar sua existência. No portal,
  inclui o identificador da organização. Fluxos sem e-mail usam o token opaco
  recebido ou o bearer; nesse caso o orçamento é por credencial, não por uma
  identidade estável depois de cada rotação. A origem continua limitada.
- PostgreSQL arbitra as contagens com locks de linha e admissão serializada por
  partição. Duas APIs compartilham a mesma decisão sem Redis nem fallback local.
  Somente hashes HMAC-SHA256 persistem, sem e-mails, IPs ou tokens em texto claro.
  A tabela possui RLS forçada e não permite leitura direta pelo runtime; somente
  a função específica recebe permissão de execução.
- Existem no máximo **16.384 chaves** (16 partições de 1.024). Cada admissão
  nova remove no máximo 64 chaves vencidas na sua partição. Uma partição cheia
  recusa novas chaves por 60 segundos sem expulsar contagens ativas. A limpeza
  é preguiçosa; o limite de linhas não representa um teto físico de WAL/bloat.
  Recusas não prolongam a janela. Os limites configuráveis são inteiros positivos
  até 100.000; a janela aceita até 3.600.000 ms.
- Uma recusa retorna **429**, `Retry-After` e mensagem em português em API,
  Nginx e BFF. Web e mobile preservam a sessão quando a renovação recebe 429,
  503 ou falha transitória de transporte; somente recusa de autenticação encerra
  a sessão. Falha no armazenamento do contador retorna 503, sem permitir a ação
  por um contador em memória independente.

Esta camada limita abuso dos fluxos sensíveis; não substitui proteção volumétrica
na Cloudflare, dimensionamento de pool, observabilidade ou ensaio de carga.

## Banco e configuração

Migration aditiva: `20261113210000_auth_rate_limit`. Não altera dados de clientes.
Novas variáveis documentadas em `.env.example` e encaminhadas pelo Compose:

| Variável | Destino / regra |
| --- | --- |
| `TRUSTED_PROXY_SECRET` | Mesmo segredo no Nginx, frontend e réplicas de API; nunca `NEXT_PUBLIC_*` |
| `AUTH_RATE_LIMIT_SECRET` | Segredo independente, somente nas réplicas de API; HMAC das chaves |
| `AUTH_RATE_LIMIT_MAX` | 20 por conta/ação por padrão |
| `AUTH_RATE_LIMIT_ORIGIN_MAX` | 120 por origem/ação por padrão |
| `AUTH_RATE_LIMIT_WINDOW_MS` | 60.000 por padrão |

O instalador `deploy/staging/bin/configure-proxy-origin.py` gera dois segredos
hexadecimais aleatórios independentes de 64 caracteres, preserva valores válidos,
recusa duplicatas/valores inválidos e grava `.env` e include privado com modo 600.
Não imprime os segredos. A API de produção e o Compose recusam sua ausência. No desenvolvimento local,
aplicar a migration e configurar também as chaves antes de usar os endpoints
protegidos; o contador não possui bypass por ambiente.
Trocar o segredo HMAC reinicia a identidade dos orçamentos; evitar rotação em
réplicas desencontradas. A credencial de proxy é uma autoridade interna: não deve
ser exposta em respostas, logs, repositórios ou ao navegador.

## Implantação posterior

**Nenhum comando abaixo foi executado no staging nesta PR.** Preparar uma janela
curta e manter todas as réplicas com configuração igual. Não reaplicar o bootstrap
geral do host para esta atualização.

1. Fazer backup e preparar as imagens novas por digest, o Compose atualizado e
   o bundle `deploy/staging` em `~/orbit-bootstrap`, preservando os arquivos
   anteriores do Nginx e o lock de imagens para rollback.
2. No Ubuntu, executar `sudo python3 ~/orbit-bootstrap/bin/configure-proxy-origin.py`.
   O arquivo de origem é `/opt/stacks/orbit/.env`; o include gerado é
   `/etc/nginx/orbit-proxy-secret.inc`. Não copiar os segredos para este Mac.
3. Instalar os arquivos atualizados, ainda sem reload:

   ```sh
   sudo install -m 0644 ~/orbit-bootstrap/nginx/00-orbit-common.conf /etc/nginx/conf.d/00-orbit-common.conf
   sudo install -m 0644 ~/orbit-bootstrap/nginx/proxy-common.inc /etc/nginx/orbit-proxy.inc
   sudo install -m 0644 ~/orbit-bootstrap/nginx/orbit-tls.conf /etc/nginx/conf.d/10-orbit.conf
   sudo nginx -t
   ```

4. Publicar com o fluxo existente `~/orbit-bootstrap/bin/deploy.sh`: o migrator
   aplica a migration antes da API; API e frontend precisam ser recriados para
   receber os novos segredos. Confirmar que as portas continuam no loopback.
5. Executar `sudo systemctl reload nginx` e validar login/recuperação através do
   domínio público, além de 429 e `Retry-After` com conta sintética controlada.
   Não fazer brute force com uma conta real. Sem a nova configuração do Nginx,
   as chamadas caem no IP do proxy, compartilhando indevidamente o teto de origem.
6. Publicar o mobile atualizado no fluxo próprio. Rollback exige restaurar juntos
   imagens, Compose e configuração Nginx anteriores; a tabela aditiva pode ficar.
   Não remover a função enquanto alguma API nova ainda a utiliza.

## Evidências e reprodução

O runner cria PostgreSQL descartável e credenciais sintéticas. Duas aplicações
NestJS no mesmo processo possuem clientes/pools separados: a prova demonstra
coordenação SQL, não carga entre máquinas. Os testes abrangem oito solicitações
concorrentes com duas admissões, contas existentes/inexistentes, falsificação de
origem, separação de ações/contas, fim da janela, teto de armazenamento e RLS.

As suítes amplas usam limites explícitos de 100.000 para suas origens sintéticas;
o middleware continua ativo em testes. A suíte de segurança reduz esses valores
para dois e valida recusas reais.

O teste Nginx inicia um container isolado com os arquivos reais de configuração,
certificado descartável e upstreams sintéticos. Exercita remoção de cabeçalhos,
confiança no peer configurado e recusa com cabeçalhos de segurança. Não é um teste
da Cloudflare ou do firewall de produção.

```sh
python3 scripts/test_proxy_origin.py
node scripts/verify-proxy-ingress.mjs
node scripts/verify-integrations.mjs backend --testPathPatterns=auth-rate-limit\|identity-concurrency\|team-members\|public-error-contract
node scripts/verify-integrations.mjs browser identity-rotation
```

Os testes do instalador e do Nginx foram acrescentados ao pipeline existente.
A CI remota depende do push do owner. Resultados finais ficam registrados em
[evidência estruturada](evidence/pr-05-rate-limit-proxies.json).

O parecer global permanece **não aprovado** até a qualificação dos PRs restantes.
Firebase continua como próximo escopo, **PR-06**, sem presumir entrega real de push.

| Gate local | Resultado |
| --- | --- |
| Backend unitário | 254 suítes, 2.025 testes; regressão final de origem/rotas: 16 testes |
| API com PostgreSQL/RLS | 4 suítes, 46 testes; 113 migrations aplicadas |
| Web unitário | 70 arquivos, 678 testes |
| Next standalone | Build de produção, dois cenários de identidade e seis smokes aprovados |
| Mobile | 155 testes selecionados de sessão/rede/login/segurança; analyzer sem alertas |
| Infraestrutura isolada | Nginx: sintaxe, spoofing, peer confiável e 429/Retry-After; dois testes do instalador |
| Estática | Lint e TypeScript backend/web, contratos, erros públicos, Prisma e diff aprovados |

A suíte completa mobile e a matriz completa de integrações não foram repetidas
nesta PR. As verificações selecionadas cobrem as mudanças de rede, sessão,
origem, persistência e limitação de requisições. O gate consolidado segue na PR-19.
