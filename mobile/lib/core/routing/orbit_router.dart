/// Navegação.
///
/// Um `GoRouter` que observa a sessão: enquanto ela é restaurada mostra a
/// splash, sem sessão manda para o login, e com sessão monta o shell do perfil.
///
/// **Guards são de navegação, não de autorização.** A interface esconde o que
/// o usuário não pode fazer; quem recusa de verdade é o backend.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/providers.dart';
import '../../features/authentication/domain/session.dart';
import '../../features/authentication/presentation/change_password_screen.dart';
import '../../features/authentication/presentation/login_screen.dart';
import '../../features/authentication/presentation/splash_screen.dart';
import '../../features/field/presentation/field_dashboard_screen.dart';
import '../../features/field/presentation/operation_execution_screen.dart';
import '../../features/field/presentation/work_item_detail_screen.dart';
import '../../features/field/presentation/work_queue_screen.dart';
import '../../features/signature/presentation/customer_acknowledgement_screen.dart';
import '../../features/signature/presentation/my_signature_screen.dart';
import '../../features/sync/presentation/sync_center_screen.dart';
import '../../features/sync/presentation/sync_triggers.dart';
import '../../features/operations/presentation/operation_detail_screen.dart';
import '../../features/operations/presentation/operations_screen.dart';
import '../../features/pmoc/presentation/pmoc_attendance_screen.dart';
import '../../features/pmoc/presentation/pmoc_plan_screen.dart';
import '../../features/pmoc/presentation/pmoc_plans_screen.dart';
import '../../features/profile/presentation/profile_screen.dart';
import '../../features/profile/presentation/settings_screen.dart';
import '../../features/scheduling/presentation/agenda_screen.dart';
import '../../features/documents/presentation/documents_screen.dart';
import '../../features/equipment/presentation/equipment_scanner_screen.dart';
import '../../features/customers/presentation/customers_screen.dart';
import '../../features/notifications/presentation/notifications_screen.dart';
import 'app_shell.dart';

abstract final class OrbitRoutes {
  static const splash = '/';
  static const login = '/login';

  /// Troca obrigatória de senha — irmã do login, fora do shell.
  static const changePassword = '/definir-senha';
  static const home = '/inicio';

  /// A fila de campo — o item de trabalho canônico, não a lista
  /// administrativa de atendimentos.
  static const workQueue = '/trabalho';
  static const operations = '/operacoes';
  static const agenda = '/agenda';

  /// O que já foi emitido. Era alcançável só por dentro de um atendimento;
  /// agora é destino próprio, porque "cadê a OS de ontem?" é pergunta de todo
  /// dia e não tinha resposta a menos de quatro toques.
  static const documents = '/documentos';
  static const customers = '/clientes';

  /// Os PMOCs configurados.
  ///
  /// Destino próprio porque a fila de trabalho responde outra pergunta: ela é
  /// filtrada por atribuição, e o dono precisa ver os contratos para atender o
  /// que o técnico escalado não atendeu.
  static const pmoc = '/pmoc';

  /// A leitura de etiqueta. Fora do shell: a câmera ocupa a tela inteira.
  static const scanner = '/etiqueta';
  static const notifications = '/avisos';

  /// Perfil, sincronização e assinatura. É o "mais" do aplicativo, com o nome
  /// do que ele de fato contém.
  static const profile = '/perfil';

  static String operationDetail(String id) => '$operations/$id';

  static String pmocPlan(String planId) =>
      '$pmoc/${Uri.encodeComponent(planId)}';

  /// O atendimento de **um equipamento** num ciclo.
  ///
  /// Os três identificadores vão no caminho porque é assim que o domínio
  /// endereça a execução: o plano diz o contrato, o ciclo diz o período, e o
  /// equipamento diz de qual aparelho é a manutenção — e a contagem que o
  /// relatório imprime é a dele.
  static String pmocAttendance({
    required String planId,
    required String cycleId,
    required String assetId,
  }) =>
      '${pmocPlan(planId)}/ciclos/${Uri.encodeComponent(cycleId)}'
      '/equipamentos/${Uri.encodeComponent(assetId)}/atendimento';

  /// O ID do item é **opaco** e vai codificado: o backend o compõe com `:`
  /// (`PMOC:<ciclo>:<equipamento>`), que é separador de caminho na URL.
  static String workItemDetail(String id) =>
      '$workQueue/${Uri.encodeComponent(id)}';

  /// Execução de um atendimento. A rota usa o **id da Operation**, que é o
  /// que os comandos do MB-02 endereçam — não o id composto do item.
  static String operationExecution(String operationId) =>
      '$workQueue/execucao/$operationId';

  /// A fila local: o que ainda não chegou ao servidor.
  static const syncCenter = '/perfil/sincronizacao';

  /// Configurações do aplicativo — avisos e o que é deste aparelho.
  static const settings = '/perfil/configuracoes';

  /// A assinatura profissional pertence ao usuário: mora sob o perfil.
  static const mySignature = '/perfil/assinatura';

  /// Aceite do cliente — a única tela feita para outra pessoa ler.
  static String customerAcknowledgement(String operationId) =>
      '$workQueue/execucao/$operationId/aceite';
}

final routerProvider = Provider<GoRouter>((ref) {
  final notifier = _AuthRefreshNotifier(ref);
  ref.onDispose(notifier.dispose);

  return GoRouter(
    initialLocation: OrbitRoutes.splash,
    refreshListenable: notifier,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final location = state.matchedLocation;

      if (auth is AuthRestoring) {
        return location == OrbitRoutes.splash ? null : OrbitRoutes.splash;
      }
      if (auth is AuthUnauthenticated) {
        return location == OrbitRoutes.login ? null : OrbitRoutes.login;
      }

      /// Senha temporária prende o aplicativo na troca.
      ///
      /// Antes de qualquer outra decisão de rota: quem entrou com a senha que o
      /// dono da organização escolheu não deve abrir atendimento nem assinar
      /// nada enquanto essa senha valer — o dono ainda a conhece.
      if (auth is AuthAuthenticated && auth.session.user.mustChangePassword) {
        return location == OrbitRoutes.changePassword
            ? null
            : OrbitRoutes.changePassword;
      }

      // Autenticado: sai da splash, do login e da troca já cumprida.
      if (location == OrbitRoutes.splash ||
          location == OrbitRoutes.login ||
          location == OrbitRoutes.changePassword) {
        return OrbitRoutes.home;
      }
      return null;
    },
    routes: [
      GoRoute(
        path: OrbitRoutes.splash,
        builder: (context, state) => const SplashScreen(),
      ),
      GoRoute(
        path: OrbitRoutes.login,
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: OrbitRoutes.changePassword,
        builder: (context, state) => const ChangePasswordScreen(),
      ),

      /// A leitura de etiqueta fica **fora** do shell, e por isso é declarada
      /// aqui — irmã da splash e do login, não filha do `ShellRoute`.
      ///
      /// A tentativa anterior era declará-la dentro do shell com
      /// `parentNavigatorKey: _rootNavigatorKey`. O `go_router` recusa: uma
      /// sub-rota direta de um `ShellRoute` só aceita a chave do próprio shell
      /// ou nenhuma. A recusa é um `assert`, então o aplicativo **não abria** —
      /// e nenhum teste de widget percebeu, porque todos montam telas
      /// diretamente e nunca constroem o roteador.
      GoRoute(
        path: OrbitRoutes.scanner,
        builder: (context, state) => EquipmentScannerScreen(
          returnsToken: EquipmentScannerRequest.fromExtra(
            state.extra,
          ).returnsToken,
        ),
      ),

      /// A caixa de avisos é um destino, não uma aba: abre por cima do shell
      /// e volta para onde estava. Por isso é **irmã** dele, e não filha —
      /// uma sub-rota direta de `ShellRoute` não pode carregar a chave do
      /// navegador raiz, e o `go_router` recusa a árvore inteira se carregar.
      GoRoute(
        path: OrbitRoutes.notifications,
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => const NotificationsScreen(),
      ),
      /// O PMOC abre **por cima** do shell, como a caixa de avisos.
      ///
      /// Não é aba: as cinco estão ocupadas, e nenhuma delas vale trocar por
      /// esta. Como filha do shell, `/pmoc` deixaria a barra inferior sem aba
      /// correspondente — e o realce cairia em "Início", dizendo à pessoa que
      /// ela está onde não está. Por isso é **irmã** dele, com o navegador raiz:
      /// tela inteira, com voltar, e o trabalho do atendimento sem uma barra de
      /// abas convidando a sair no meio.
      GoRoute(
        path: OrbitRoutes.pmoc,
        parentNavigatorKey: _rootNavigatorKey,
        builder: (context, state) => const PmocPlansScreen(),
        routes: [
          GoRoute(
            path: ':planId',
            builder: (context, state) =>
                PmocPlanScreen(planId: state.pathParameters['planId'] ?? ''),
            routes: [
              GoRoute(
                path: 'ciclos/:cycleId/equipamentos/:assetId/atendimento',
                builder: (context, state) => PmocAttendanceScreen(
                  planId: state.pathParameters['planId'] ?? '',
                  cycleId: state.pathParameters['cycleId'] ?? '',
                  assetId: state.pathParameters['assetId'] ?? '',
                ),
              ),
            ],
          ),
        ],
      ),
      ShellRoute(
        /// Os gatilhos vivem no shell: existem enquanto houver sessão, e não
        /// por tela.
        builder: (context, state, child) => SyncTriggers(
          child: AppShell(location: state.matchedLocation, child: child),
        ),
        routes: [
          GoRoute(
            path: OrbitRoutes.home,

            /// One operational mobile product. Permissions change data and
            /// actions; they never select a parallel visual application.
            builder: (context, state) => const FieldDashboardScreen(),
          ),
          GoRoute(
            path: OrbitRoutes.workQueue,
            builder: (context, state) => const WorkQueueScreen(),
            routes: [
              /// Antes de `:id`, senão o caminho de execução seria lido como
              /// um id de item.
              GoRoute(
                path: 'execucao/:operationId',
                parentNavigatorKey: _rootNavigatorKey,
                builder: (context, state) => OperationExecutionScreen(
                  operationId: state.pathParameters['operationId'] ?? '',
                ),
                routes: [
                  GoRoute(
                    path: 'aceite',
                    parentNavigatorKey: _rootNavigatorKey,
                    builder: (context, state) => CustomerAcknowledgementScreen(
                      operationId: state.pathParameters['operationId'] ?? '',
                    ),
                  ),
                ],
              ),
              GoRoute(
                path: ':id',

                /// Fora do shell: o contexto do item ocupa a tela inteira.
                parentNavigatorKey: _rootNavigatorKey,
                builder: (context, state) => WorkItemDetailScreen(
                  workItemId: Uri.decodeComponent(
                    state.pathParameters['id'] ?? '',
                  ),
                ),
              ),
            ],
          ),
          GoRoute(
            path: OrbitRoutes.operations,
            builder: (context, state) => const OperationsScreen(),
            routes: [
              GoRoute(
                path: ':id',
                // Fora do shell: o detalhe ocupa a tela inteira.
                parentNavigatorKey: _rootNavigatorKey,
                builder: (context, state) => OperationDetailScreen(
                  operationId: state.pathParameters['id']!,
                ),
              ),
            ],
          ),
          GoRoute(
            path: OrbitRoutes.agenda,
            builder: (context, state) => const AgendaScreen(),
          ),
          GoRoute(
            path: OrbitRoutes.documents,
            builder: (context, state) => const DocumentsScreen(),
          ),
          GoRoute(
            path: OrbitRoutes.customers,
            builder: (context, state) => const CustomersScreen(),
          ),
          GoRoute(
            path: OrbitRoutes.profile,
            builder: (context, state) => const ProfileScreen(),
            routes: [
              GoRoute(
                path: 'assinatura',
                parentNavigatorKey: _rootNavigatorKey,
                builder: (context, state) => const MySignatureScreen(),
              ),
              GoRoute(
                path: 'sincronizacao',
                parentNavigatorKey: _rootNavigatorKey,
                builder: (context, state) => const SyncCenterScreen(),
              ),

              /// Neta da `ShellRoute`, e não filha — por isso pode carregar
              /// a chave do navegador raiz. Numa filha direta do shell essa
              /// mesma chave derruba o aplicativo na abertura.
              GoRoute(
                path: 'configuracoes',
                parentNavigatorKey: _rootNavigatorKey,
                builder: (context, state) => const SettingsScreen(),
              ),
            ],
          ),
        ],
      ),
    ],
    navigatorKey: _rootNavigatorKey,
    errorBuilder: (context, state) => Scaffold(
      body: Center(child: Text('Rota não encontrada: ${state.uri}')),
    ),
  );
});

final _rootNavigatorKey = GlobalKey<NavigatorState>();

/// Faz o GoRouter reavaliar o `redirect` quando a sessão muda.
class _AuthRefreshNotifier extends ChangeNotifier {
  _AuthRefreshNotifier(Ref ref) {
    _subscription = ref.listen<AuthState>(
      authControllerProvider,
      (_, __) => notifyListeners(),
    );
  }

  late final ProviderSubscription<AuthState> _subscription;

  @override
  void dispose() {
    _subscription.close();
    super.dispose();
  }
}
