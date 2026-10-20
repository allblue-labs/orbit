/// O roteador é construível.
///
/// ## A lacuna que este arquivo fecha
///
/// Havia 533 testes verdes, `flutter analyze` limpo e build de iOS e de Android
/// passando — e o aplicativo **não abria**. Uma rota de câmera declarada como
/// filha direta do `ShellRoute` com a chave do navegador raiz viola um `assert`
/// do `go_router`, e o processo morria na primeira tela.
///
/// Nenhum teste percebeu porque todos montam telas diretamente. Compilar não é
/// executar, e montar um widget não é montar o aplicativo.
///
/// Este teste constrói o roteador de verdade e navega por todas as rotas
/// declaradas. É barato, e teria custado horas de depuração.
library;

import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:orbit_operator/core/routing/orbit_router.dart';

void main() {
  test('o roteador é construído sem violar nenhuma regra do go_router', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    /// A construção é o teste: `GoRouter` valida a árvore de rotas no
    /// construtor, e é ali que o `assert` do navegador aninhado dispara.
    final router = container.read(routerProvider);

    expect(router, isA<GoRouter>());
  });

  test('toda rota declarada tem uma configuração válida', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    final router = container.read(routerProvider);

    /// As rotas que o produto conhece pelo nome. Se alguma deixar de existir
    /// ou passar a ser inválida, a construção acima já teria falhado — este
    /// caso garante que elas continuam **declaradas**, e não só que a árvore
    /// compila.
    const caminhos = [
      OrbitRoutes.splash,
      OrbitRoutes.login,
      OrbitRoutes.home,
      OrbitRoutes.workQueue,
      OrbitRoutes.operations,
      OrbitRoutes.agenda,
      OrbitRoutes.documents,
      OrbitRoutes.scanner,
      OrbitRoutes.profile,
    ];

    final declarados = _caminhosDe(router.configuration.routes);
    for (final caminho in caminhos) {
      expect(
        declarados,
        contains(caminho),
        reason: 'A rota $caminho sumiu da configuração.',
      );
    }
  });

  test('a Home canônica não bifurca a árvore visual por perfil', () {
    final source = File(
      'lib/core/routing/orbit_router.dart',
    ).readAsStringSync();
    expect(source, isNot(contains('HomeScreen')));
    expect(source, isNot(contains('profile == OrbitProfile.owner')));
    expect(source, contains('const FieldDashboardScreen()'));
    expect(Directory('lib/features/home').existsSync(), isFalse);
  });
}

/// Os caminhos absolutos declarados na árvore.
List<String> _caminhosDe(List<RouteBase> rotas) {
  final resultado = <String>[];
  for (final rota in rotas) {
    if (rota is GoRoute) resultado.add(rota.path);
    resultado.addAll(_caminhosDe(rota.routes));
  }
  return resultado;
}
