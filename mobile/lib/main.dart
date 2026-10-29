/// Ponto de entrada do Orbit Operator.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/providers.dart';
import 'app/session_runtime.dart';
import 'core/storage/read_cache.dart';
import 'features/artifact/data/document_file.dart';
import 'core/routing/orbit_router.dart';
import 'core/theme/orbit_theme.dart';
import 'core/presentation/orbit_format.dart';
import 'features/authentication/domain/session.dart';
import 'features/notifications/application/push_providers.dart';
import 'features/notifications/domain/deep_link.dart';
import 'features/notifications/presentation/foreground_notifications.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // O app de campo é usado na vertical, com o aparelho na mão.
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Sem isto, `DateFormat` em pt_BR lança ao formatar: os símbolos de idioma
  // são carregados sob demanda. É barato e acontece uma vez.
  await initializeDateFormatting('pt_BR');

  // A leitura das preferências é assíncrona; a árvore precisa dela pronta.
  final preferences = await SharedPreferences.getInstance();
  await PreferencesReadCache.purgeLegacy(preferences);
  await TemporaryDocumentFileStore().purge();

  runApp(
    ProviderScope(
      overrides: [sharedPreferencesProvider.overrideWithValue(preferences)],
      child: const OrbitOperatorApp(),
    ),
  );
}

class OrbitOperatorApp extends ConsumerStatefulWidget {
  const OrbitOperatorApp({super.key});

  @override
  ConsumerState<OrbitOperatorApp> createState() => _OrbitOperatorAppState();
}

class _OrbitOperatorAppState extends ConsumerState<OrbitOperatorApp>
    with WidgetsBindingObserver {
  StreamSubscription<String>? _avisosTocados;
  SessionRuntime? _runtime;
  Object? _runtimeIdentity;
  bool _refreshingProfile = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // Restaura a sessão guardada.
      ref.read(authControllerProvider.notifier).restore();
    });

    /// Tocar num aviso abre o que ele é sobre.
    ///
    /// A escuta fica aqui, acima do roteador, porque o toque pode chegar com
    /// o aplicativo fechado: a tela de destino ainda não existe, e quem
    /// precisa estar de pé para receber o caminho é a raiz.
    _avisosTocados = ref
        .read(pushTokenSourceProvider)
        .onDeepLink
        .listen(_abrirAviso);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _avisosTocados?.cancel();
    _runtime?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed &&
        !_refreshingProfile &&
        ref.read(authControllerProvider) is AuthAuthenticated) {
      unawaited(_refreshProfile());
    }
  }

  Future<void> _refreshProfile() async {
    _refreshingProfile = true;
    final auth = ref.read(authControllerProvider.notifier);
    final logger = ref.read(loggerProvider);
    try {
      // Inclui preferências alteradas na web enquanto o app estava em segundo plano.
      await auth.refreshProfile();
    } on Object {
      logger.warning('Não foi possível atualizar as preferências da conta.');
    } finally {
      _refreshingProfile = false;
    }
  }

  void _abrirAviso(String caminho) {
    final destino = routeForDeepLink(caminho);

    /// Caminho desconhecido leva à caixa de avisos, nunca a um palpite: uma
    /// tela errada passa por defeito, quando só chegou um tipo novo de aviso.
    _runtime?.container
        .read(routerProvider)
        .go(destino ?? OrbitRoutes.notifications);
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final session = auth is AuthAuthenticated ? auth.session : null;
    final identity = (
      auth.runtimeType,
      session?.user.id,
      session?.claims.sessionId,
      session?.organizationId,
      session?.businessUnitId,
      session == null
          ? null
          : ref.read(apiClientProvider).authenticator.generation,
    );
    if (_runtime == null || identity != _runtimeIdentity) {
      final previous = _runtime;
      previous?.retire();
      PaintingBinding.instance.imageCache.clear();
      PaintingBinding.instance.imageCache.clearLiveImages();
      _runtimeIdentity = identity;
      _runtime = SessionRuntime(
        root: ProviderScope.containerOf(context, listen: false),
        session: session,
      );
      if (session != null) {
        unawaited(_runtime!.container.read(pushRegistrarProvider).start());
      }
      WidgetsBinding.instance.addPostFrameCallback((_) => previous?.dispose());
    }

    return KeyedSubtree(
      key: ValueKey(identity),
      child: UncontrolledProviderScope(
        container: _runtime!.container,
        child: Consumer(
          builder: (context, scopedRef, _) => MaterialApp.router(
            title: 'Orbit Operator',
            locale: const Locale('pt', 'BR'),
            supportedLocales: const [Locale('pt', 'BR')],
            localizationsDelegates: GlobalMaterialLocalizations.delegates,
            scaffoldMessengerKey: scopedRef.watch(
              notificationMessengerKeyProvider,
            ),
            builder: (context, child) => OrbitTimeScope(
              timezone: scopedRef.watch(userTimezoneProvider),
              child: ForegroundNotifications(
                child: child ?? const SizedBox.shrink(),
              ),
            ),
            debugShowCheckedModeBanner: false,
            theme: OrbitTheme.light(),

            /// Só o claro nesta rodada. A paleta é uma `ThemeExtension`: ligar o
            /// escuro no futuro é acrescentar uma segunda paleta aqui, sem tocar em
            /// tela nenhuma.
            themeMode: ThemeMode.light,
            routerConfig: scopedRef.watch(routerProvider),
          ),
        ),
      ),
    );
  }
}
