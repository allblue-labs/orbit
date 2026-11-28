# PR-19 — Qualificação da release

**A release permanece bloqueada para produção em 18/11/2026.** O código de aplicação
avaliado corresponde ao SHA `ba5e4077b652b5e77a0ed7efdc2093a22bbc2b1b`.
O staging continuava no SHA `e133b24a2f8fd4412f65d85def1e6875a360a66f`.
Os resultados desses dois ambientes foram registrados separadamente.

## Recuperação e carga

O ensaio criou duas organizações sintéticas, emitiu um PDF por HTTP e
interrompeu os processos de escrita antes de copiar banco e objetos.
O restore usou outra base e outro diretório de objetos em PostgreSQL
descartável. Aplicação com `orbit_app` sem superusuário ou bypass de RLS,
127 migrations aplicadas, mesmo SHA-256 dos bytes do PDF, uma revisão ativa
e acesso negado ao outro tenant. A janela observada da cópia ao smoke do
restore foi de 51 s para um dump de 1,25 MB. É uma medição do cenário
sintético.

O ensaio também executou o backend de `e133b24` sobre a base restaurada,
sem revertê-la. O PDF foi baixado e conferido novamente, e a autorização do
outro tenant continuou a negar a leitura. A reprodução usa o mesmo
lockfile e schema Prisma nas duas revisões. O ensaio de rollback por
digest de imagem e o restore pareado de R2 do staging continuam pendentes.

```sh
node scripts/verify-release-recovery.mjs e133b24a2f8fd4412f65d85def1e6875a360a66f
node --expose-gc scripts/verify-analytics-benchmark.mjs
```

O benchmark de analytics repetiu 112 mil operações sintéticas. O snapshot
de todos os domínios ficou em 958 bytes com cinco consultas. A amostra
legada de operações devolveu 12 mil linhas e cerca de 2,95 MB. O plano
utilizou os índices de criação, conclusão e fila aberta. O ensaio de PMOC
100 × 12 mediu p95 de 254 ms em 20 amostras, três consultas e resposta de
68.455 bytes. Os números são de um ambiente local.

## Aplicativos e imagens

- Android gerado com a chave de upload existente e assinatura JAR
  verificada. O bundle usa `com.allbluelabs.orbit`, versão `0.1.0`, código
  `1`, flavor `production` e a API pública HTTPS do Orbit. A configuração
  Firebase do app coincide com o projeto escolhido para a build.
- iOS compilou em Release sem assinatura de distribuição, com o mesmo
  bundle ID, versão e número de build. O Mac tem zero identidades válidas
  de Apple Distribution. O archive para App Store/TestFlight depende do
  perfil, entitlement APNs de produção e configuração APNs no Firebase.
  O plist corresponde ao mesmo projeto Firebase e ao bundle ID da build.
  [Provisionamento Apple](https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile).
- Gerados inventários CycloneDX dos grafos npm de produção. O export OCI
  linux/amd64 com proveniência e SBOM falhou com o disco Linux do Docker
  Desktop a 100%. Imagens finais, assinaturas por digest e SBOMs da camada
  de sistema permanecem pendentes.
  [Limite de disco no Docker Desktop](https://docs.docker.com/desktop/settings-and-maintenance/settings/).
- A landing do staging ainda publica links de exemplo para as duas
  lojas. A ficha pública do Android respondeu 404. Antes do envio às
  lojas, conferir a disponibilidade do número de build nos painéis.

O AAB está em `mobile/build/app/outputs/bundle/release/app-release.aab`.
O [guia mobile](../../mobile/docs/firebase-push-release.md) contém o fluxo
para validar push, ação ao tocar na notificação e isolamento após trocar
de conta. A compilação unsigned do iOS é uma validação técnica local.

## Segurança e gates

As duas auditorias npm `--omit=dev` retornaram zero. A auditoria completa
reprovou o backend com nove avisos moderados e 43 altos, e o frontend com
seis moderados e 11 altos, contando dependências transitivas.
O achado alto comum é `picomatch`. O registro publicou até `4.0.7` e o
advisory ainda não indica versão corrigida. Preservada a política de
bloqueio. Um upgrade só de `glob` ou `minimatch` não resolve o achado alto.
[Advisory picomatch](https://github.com/advisories/GHSA-fc5q-39xc-vjpf).
O alvo do migrator deriva do estágio que contém as ferramentas de build.
A auditoria npm do grafo de produção não substitui a inspeção da imagem.

Os controles de organização, suporte a papéis restritos, auditoria de
storage LOCAL e maturidade dos testes de produto constam nas evidências.
A rodada backend registrou expiração da transação interativa durante
inícios simultâneos de PMOC e timeout na conexão do teste de documentos.
A primeira rodada web também teve timeouts de conexão. As duas rodadas
globais foram interrompidas. PMOC concorrente, renderização de QR, emissão
e download do relatório mobile e os sete cenários web de mídia da conta
passaram nos ensaios isolados, com os limites originais.

O inventário de FKs agora inclui e verifica a referência criada pelo
formulário público. Os dez testes de integridade e upgrade passaram em
PostgreSQL. A fixture de upload passou a esperar a rejeição HTTP antes
de enviar o corpo, e os quatro testes dessa suíte passaram. Os ajustes
de teste estão no commit `ecb8287` e preservam o código da aplicação
usado no build do candidato.

Backend passou em 2.324 testes unitários na rodada posterior aos ajustes
das fixtures. Frontend passou em 704 testes unitários e lint. Flutter passou em 1.281
testes com um skip, analyzer e 60 smokes contra a API. O smoke foi repetido
com o Flutter 3.47.2 da CI após uma tentativa usar o Flutter 3.41.9 do PATH.
TypeScript, lint e guardas de contrato no backend passaram. O Node local
dessas rodadas foi 25.1.0. A imagem de qualificação usa Node 22.23.5.

## Staging e aceites externos

- A URL pública de login respondeu 200 com TLS verificado. A rota
  autenticada respondeu 401 sem sessão. Nginx, UFW, Fail2ban e backup
  agendado ativos. Dockge e portas publicadas da API/Web em loopback.
  O backup agendado mais recente terminou com sucesso.
- PostgreSQL do staging tem 126 migrations aplicadas e `orbit_app`
  restrito. A base descartável do candidato tem 127.
- Preflight SES remoto em `us-east-2` retornou `READY`, com produção,
  envio, identidade e quota confirmados. SNS/feedback continua habilitado.
  A rodada anterior comprovou feedback de entrega, bounce e complaint no
  Mailbox Simulator. A leitura dos e-mails reais na caixa do destinatário
  ainda depende da confirmação do destinatário.
- Credenciais Firebase estão configuradas. Recebimento e redirecionamento
  em aparelho físico Android permanecem pendentes. No iOS também falta
  o aceite de distribuição/APNs.
- TLS do CDN responde. O ambiente ainda está sem credencial de purge,
  com retenção automática desativada. Restore pareado de R2, backup
  cifrado fora do host e alarme operacional precisam de evidências
  deste ambiente antes de liberar remoção de mídia.

## Próximo checkpoint

Para fechar a qualificação, faltam as rodadas globais consecutivas, a
auditoria completa aprovada, as imagens imutáveis e os aceites externos
acima. O resultado desta inspeção mantém o parecer bloqueado, inclusive
para ativar a retenção automática.
