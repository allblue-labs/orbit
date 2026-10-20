/// As preferências de aviso, por tipo.
///
/// ```text
/// GET   /notifications/preferences   o que já foi escolhido
/// PATCH /notifications/preferences   um tipo por vez
/// ```
///
/// ## Ausência quer dizer "ligado"
///
/// O servidor guarda **só o que foi mexido**: um tipo sem linha na tabela
/// segue o padrão, que é receber. A tela precisa saber disso — desenhar
/// "desligado" para o que nunca foi tocado faria a pessoa acreditar que não
/// recebe avisos que recebe.
library;

import '../../../core/network/orbit_api_client.dart';

/// Os tipos que o aplicativo móvel recebe.
///
/// A lista é a do `MobileNotificationPolicy` no backend — os três casos que
/// geram push hoje. Não é a lista de tudo que o produto notifica: o resto
/// chega por e-mail e pelo Orbit no navegador, e oferecer um interruptor
/// aqui para algo que este aplicativo não mostra seria mentira.
enum MobileNoticeKind { workAssigned, artifactAvailable, syncAttention }

const mobileNoticeCodes = <MobileNoticeKind, String>{
  MobileNoticeKind.workAssigned: 'WORK_ASSIGNED',
  MobileNoticeKind.artifactAvailable: 'ARTIFACT_AVAILABLE',
  MobileNoticeKind.syncAttention: 'SYNC_ATTENTION_REQUIRED',
};

const mobileNoticeLabels = <MobileNoticeKind, (String, String)>{
  MobileNoticeKind.workAssigned: (
    'Novo atendimento',
    'Quando um trabalho é atribuído a você',
  ),
  MobileNoticeKind.artifactAvailable: (
    'Documento pronto',
    'Quando uma OS, PMOC ou RVT termina de ser gerada',
  ),
  MobileNoticeKind.syncAttention: (
    'Sincronização travada',
    'Quando algo deste aparelho não conseguiu subir',
  ),
};

/// A escolha para um tipo.
class NoticePreference {
  const NoticePreference({
    required this.type,
    required this.enabled,
    this.channels = const ['IN_APP', 'REALTIME'],
  });

  factory NoticePreference.fromJson(Map<String, dynamic> json) =>
      NoticePreference(
        type: json['type'] as String? ?? '',
        enabled: json['enabled'] as bool? ?? true,
        channels: (json['channels'] as List<dynamic>? ?? const [])
            .whereType<String>()
            .toList(growable: false),
      );

  final String type;
  final bool enabled;
  final List<String> channels;

  bool get hasPush => channels.contains('PUSH');
}

class NotificationPreferencesRepository {
  const NotificationPreferencesRepository({required OrbitApiClient client})
    : _client = client;

  final OrbitApiClient _client;

  /// O cliente já **desembrulha** o envelope: o que chega aqui é a lista de
  /// dentro de `data`, não o objeto inteiro. Procurar `json['data']` de novo
  /// devolvia vazio em silêncio, e a tela desenhava tudo ligado.
  Future<Map<String, NoticePreference>> list() async {
    final linhas = await _client.get<List<dynamic>>(
      '/notifications/preferences',
    );
    return {
      for (final linha in linhas.whereType<Map<String, dynamic>>())
        if (NoticePreference.fromJson(linha) case final preferencia
            when preferencia.type.isNotEmpty)
          preferencia.type: preferencia,
    };
  }

  /// Grava um tipo.
  ///
  /// Os canais vão **inteiros** a cada chamada: o contrato substitui a lista,
  /// não faz união. Mandar só `PUSH` apagaria o aviso dentro do aplicativo.
  Future<void> set({
    required String type,
    required bool enabled,
    required List<String> channels,
  }) => _client.patch<Map<String, dynamic>>(
    '/notifications/preferences',
    body: {'type': type, 'enabled': enabled, 'channels': channels},
  );
}
