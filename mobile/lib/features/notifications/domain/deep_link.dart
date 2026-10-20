/// De onde o aviso veio, para onde o aplicativo vai.
///
/// ## Por que existe uma tradução
///
/// O servidor publica um destino canônico no `payload` da notificação —
/// `/field/work-items/OPERATION:123`, `/field/artifacts/456`, `/field/sync`.
/// Ele é estável e não conhece as rotas desta tela: `/trabalho/...`,
/// `/documentos`, `/perfil/sincronizacao`. São dois vocabulários, e é bom que
/// sejam: renomear uma rota do aplicativo não pode invalidar avisos que já
/// foram entregues ao aparelho de alguém.
///
/// Esta função é a costura entre os dois, e é o único lugar que conhece as
/// duas pontas.
///
/// ## O que ela faz quando não sabe
///
/// Devolve `null`, e quem chamou leva a pessoa para a caixa de avisos. Um
/// destino adivinhado é pior que a lista: abre a tela errada e dá a impressão
/// de que o aplicativo está quebrado, quando só chegou um tipo novo de aviso.
library;

import '../../../core/routing/orbit_router.dart';

String? routeForDeepLink(String? deepLink) {
  if (deepLink == null || deepLink.isEmpty) return null;
  if (!deepLink.startsWith('/field/')) return null;

  final resto = deepLink.substring('/field/'.length);

  if (resto == 'sync') return OrbitRoutes.syncCenter;

  if (resto.startsWith('work-items/')) {
    final id = resto.substring('work-items/'.length);
    return id.isEmpty ? null : OrbitRoutes.workItemDetail(id);
  }

  /// Documento tem tela de lista, não de detalhe próprio no aplicativo: o
  /// artefato é consultado a partir dela. Levar para a lista é honesto;
  /// inventar uma rota de detalhe que não existe daria tela em branco.
  if (resto.startsWith('artifacts/')) return OrbitRoutes.documents;

  return null;
}

/// O destino de um aviso, já com o caminho do `payload` resolvido.
String? routeForNotificationPayload(Map<String, dynamic> payload) =>
    routeForDeepLink(payload['deepLink'] as String?);
