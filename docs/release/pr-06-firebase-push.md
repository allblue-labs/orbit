# PR-06 — Firebase Push Android/iOS

Achado tratado: **F09**, base `bc2026c`. Código implementado e validado localmente.
**Aceite externo pendente; push ainda não qualificado para produção.** Nenhum
push, deploy, envio Firebase real ou publicação nas lojas foi executado nesta PR.

**Complemento de configuração em 14/11/2026:** os apps Android e iOS agora usam
`com.allbluelabs.orbit`. O caminho Apple correto é
`mobile/ios/Runner/GoogleService-Info.plist`, ignorado pelo Git e usado tanto pelo
validador/cópia do Xcode quanto pelo SDK. Os arquivos cliente foram fornecidos
localmente e validados, e o AAB Release foi compilado com os recursos Firebase
correspondentes. O cenário atual libera o Android enquanto aguarda aprovação da
conta Apple/configuração APNs; o teste físico Android será feito posteriormente
pelo responsável. Isso não constitui evidência de entrega real. As instruções
atuais estão no [guia operacional](mobile-push.md).

Neste complemento passaram 15 testes de configuração nativa, 45 testes unitários
do backend, 10 testes HTTP com PostgreSQL/RLS e 25 testes Flutter de registro,
rotação/revogação, recebimento e navegação. A assinatura do AAB foi verificada e
os recursos Firebase gerados pelo Gradle correspondem ao arquivo cliente. O
`Package.resolved` do projeto Xcode foi sincronizado com o do workspace, mantendo
Firebase 13.1.1 e as mesmas revisões das dependências já resolvidas no workspace.
O Runner também compilou para simulador iOS, sem assinatura: o bundle final usa
`com.allbluelabs.orbit`, mantém push desligado e não incorpora o plist nesse modo.
Isso valida a preparação do cliente, sem comprovar provisioning ou entrega APNs.

## Alterações

- O iOS deixou de registrar APNs puro como destino do Firebase Admin. O SDK oficial
  Firebase Messaging 13.1.1, fixado pelo SwiftPM, associa APNs ao FCM e publica apenas
  o token FCM ao Flutter. Foram preservados consentimento, atualização de token e
  eventos guardados até a escuta nativa existir. A obtenção do token é repetida
  quando APNs/rede ainda não estão prontos.
- Android mantém o SDK oficial existente. O backend agora envia notification+data:
  o SDK mostra o alerta em background e o receiver trata foreground. Destino e
  identidade acompanham o Intent; um identificador estável substitui alertas repetidos.
- O payload acrescenta `recipientUserId`, reservado ao servidor. Ao tocar no aviso,
  o app confere destinatário e organização da sessão, inclusive depois da restauração
  inicial. Links antigos sem identidade, caminhos relativos, queries e fragmentos
  não viram navegação. Os detalhes continuam na API autenticada com RLS/RBAC.
- Registro APNs legado é recusado pelo transporte Firebase com o novo código público
  `MOBILE_PUSH_UPGRADE_REQUIRED` e mensagem em português. Gateway legado permanece
  compatível com APNs; não houve exclusão em massa de instalações ou mudança de schema.
- `FieldAssignmentOutbox` grava intenções na mesma transação da criação/edição de
  visitas RVT e da autorização de OS/RVT/PMOC; abertura/ativação de ciclos PMOC
  também integra a fila. Respeita o técnico substituto por equipamento e auxiliares.
  Os avisos existentes de atribuição de OS/PMOC continuam integrados.
- O worker reconfere a atribuição/autorização antes de materializar e enviar.
  Operações canceladas/concluídas não geram aviso atrasado; RVT possui resolução
  própria pelo ID da visita. Troca de conta/tenant, revogação e preferências continuam
  sendo verificadas. PMOC considera escalas por equipamento e o técnico previsto
  no plano quando não existe uma escala específica. As consultas leem somente os
  campos necessários ao aviso; a resolução por equipamento usa mapas, sem buscar
  observações, evidências ou dados completos do cliente.
- `check_push_config.py` é chamado por Gradle/Xcode e testado na CI. Exige projeto
  esperado e `ORBIT_FLAVOR`, confere os IDs de cada plataforma e recusa configuração
  trocada/ausente e JSON Admin. Xcode copia somente o plist validado. Archives exigem
  push, entitlement e APNs production. Personal Team pode optar explicitamente por
  instalação local sem push; esse opt-out não é aceito para distribuição.

## Configuração e implantação posteriores

O [guia de release](../../mobile/docs/firebase-push-release.md) contém os passos dos
consoles Firebase/Apple, os dois caminhos locais dos arquivos públicos, comandos de
build, configuração de worker e a matriz de teste físico. No registro original da
PR, os arquivos Firebase e `Push.local.xcconfig` estavam ausentes neste checkout;
no complemento acima os arquivos cliente já estão disponíveis localmente, sem
versionamento. Os exemplos não contêm credenciais.
A nova entrada pública foi sincronizada para os contratos web.

Não há migration nem nova chave privada exigida. Manter `FIREBASE_*` somente na API,
`PUSH_PROVIDER=firebase` e worker ativo. O projeto do backend deve corresponder a
`ORBIT_FIREBASE_PROJECT_ID` no build e aos arquivos públicos de ambos os apps.
Projetos/arquivos de staging e produção devem ser distintos. Publicar o backend e
as builds atualizadas de forma coordenada; o app antigo iOS com APNs puro precisa
ser atualizado. Falhas terminais antigas não são reenviadas automaticamente.

## Evidências locais

| Gate | Resultado |
| --- | --- |
| Backend unitário | 255 suítes, 2.030 testes; regressão final de notificações/erros públicos: 92 aprovados |
| Push + autorização com PostgreSQL/RLS | Duas suítes, 15 testes aprovados no runner isolado |
| PMOC/RVT/agenda | Três suítes aprovadas na execução ampla; ativação/rollback PMOC repetidos no código final: três testes aprovados |
| Mobile completo | 1.278 testes aprovados, um ignorado pela suíte; 38 direcionados também aprovados |
| Web | TypeScript e 678 testes aprovados após sincronização de contratos |
| Preflight | 12 testes com arquivos públicos sintéticos; Gradle recusou distribuição sem seleção Firebase |
| Nativo | APK Android Debug compilado; Runner iOS Debug para simulador compilado com Firebase via SwiftPM, sem assinatura |
| Estática | Lint/TypeScript backend, analyzer Flutter sem alertas, contratos e erros públicos aprovados |

O provider inspecionável do E2E substitui apenas a fronteira Firebase: registro,
materialização, fila/worker, preferências, rotação, limpeza e RLS usam banco real.
O teste de documento cobre o evento e sua entrega idempotente, sem alegar geração
ou recebimento físico desse PDF. Casos de autorização recorrente comprovam rollback
do lote e gravação dos destinos RVT/PMOC na mesma transação.

A execução ampla inicial encontrou a mensagem de upgrade substituída pelo erro
genérico; o contrato público foi corrigido e o cenário passou. Seu teste de drain
excedeu a janela durante o backlog das suítes de relatórios; passou com banco
isolado, mantendo o prazo original. A execução unitária concorrente apresentou
dois timeouts de renderização; os 2.030 testes passaram ao repetir sem a carga
gráfica simultânea, sem aumentar timeouts nem remover asserções. A qualificação de
backlog/carga entre serviços continua nas PR-15/PR-19.

## Aceite externo obrigatório

Instalar builds realmente configuradas em Android e iPhone, com assinatura/provisioning
compatíveis, e executar a matriz do guia: OS/RVT/PMOC, autorização, cancelamento,
substituição, documento, token renovado, preferências, logout/troca de conta, app
aberto/background/encerrado e toque no destino correto. Não confundir
`ACCEPTED_BY_PROVIDER` com exibição no sistema operacional ou leitura do usuário.
Não foi acessado o Firebase Console, enviado um push real nem inspecionado um perfil
Apple de distribuição. O parecer global de produção permanece não aprovado.
