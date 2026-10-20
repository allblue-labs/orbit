/// Ponto de entrada do Orbit Operator.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/providers.dart';
import 'core/routing/orbit_router.dart';
import 'core/theme/orbit_theme.dart';
import 'features/authentication/domain/session.dart';
import 'features/notifications/application/push_providers.dart';
import 'features/notifications/domain/deep_link.dart';

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

class _OrbitOperatorAppState extends ConsumerState<OrbitOperatorApp> {
  StreamSubscription<String>? _avisosTocados;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      // Restaura a sessão guardada.
      ref.read(authControllerProvider.notifier).restore();
      // Retoma evidências que ficaram pendentes de uma sessão anterior.
      ref.read(uploadQueueProvider).restore();
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
    _avisosTocados?.cancel();
    super.dispose();
  }

  void _abrirAviso(String caminho) {
    final destino = routeForDeepLink(caminho);

    /// Caminho desconhecido leva à caixa de avisos, nunca a um palpite: uma
    /// tela errada passa por defeito, quando só chegou um tipo novo de aviso.
    ref.read(routerProvider).go(destino ?? OrbitRoutes.notifications);
  }

  /// Liga e desliga o registro conforme a sessão.
  ///
  /// O `revoke` do logout precisa acontecer **antes** de o token de acesso
  /// ser descartado, e por isso mora no controlador de sessão, não aqui.
  /// Aqui fica só o lado de entrar.
  void _acompanharSessao() {
    ref.listen<AuthState>(authControllerProvider, (anterior, atual) {
      if (atual is AuthAuthenticated && anterior is! AuthAuthenticated) {
        ref.read(pushRegistrarProvider).start();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    _acompanharSessao();

    return MaterialApp.router(
      title: 'Orbit Operator',
      debugShowCheckedModeBanner: false,
      theme: OrbitTheme.light(),

      /// Só o claro nesta rodada. A paleta é uma `ThemeExtension`: ligar o
      /// escuro no futuro é acrescentar uma segunda paleta aqui, sem tocar em
      /// tela nenhuma.
      themeMode: ThemeMode.light,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
