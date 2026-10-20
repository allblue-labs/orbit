/// A tradução do destino publicado pelo servidor.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/routing/orbit_router.dart';
import 'package:orbit_operator/features/notifications/domain/deep_link.dart';

void main() {
  test('atendimento atribuído abre o item de trabalho', () {
    expect(
      routeForDeepLink('/field/work-items/OPERATION:abc-123'),
      OrbitRoutes.workItemDetail('OPERATION:abc-123'),
    );
  });

  test('documento disponível abre a lista de documentos', () {
    expect(routeForDeepLink('/field/artifacts/abc-123'), OrbitRoutes.documents);
  });

  test('pendência de sincronização abre o centro de sincronização', () {
    expect(routeForDeepLink('/field/sync'), OrbitRoutes.syncCenter);
  });

  test('destino desconhecido não vira palpite', () {
    /// Um tipo novo de aviso chega antes de o aplicativo conhecê-lo. Abrir a
    /// tela errada parece defeito; devolver nada deixa quem chamou levar a
    /// pessoa para a caixa de avisos, que é sempre uma resposta correta.
    expect(routeForDeepLink('/field/algo-que-ainda-nao-existe'), isNull);
    expect(routeForDeepLink('/field/work-items/'), isNull);
    expect(routeForDeepLink('/admin/usuarios'), isNull);
    expect(routeForDeepLink(''), isNull);
    expect(routeForDeepLink(null), isNull);
  });

  test('lê o destino de dentro do payload', () {
    expect(
      routeForNotificationPayload(const {
        'version': 1,
        'deepLink': '/field/sync',
      }),
      OrbitRoutes.syncCenter,
    );
    expect(routeForNotificationPayload(const {}), isNull);
  });
}
