/// O que o aplicativo lê de `/notifications`.
///
/// O backend já publica título, corpo, tipo e `payload` — e a listagem devolve
/// `unread` junto, que é o número do sino. Nada aqui é derivado no aplicativo:
/// contar não lidas percorrendo a página daria um número errado assim que a
/// página não fosse a primeira.
library;

class OrbitNotification {
  const OrbitNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.createdAt,
    this.readAt,
    this.payload = const {},
  });

  factory OrbitNotification.fromJson(Map<String, dynamic> json) =>
      OrbitNotification(
        id: json['id'] as String? ?? '',
        type: json['type'] as String? ?? '',
        title: json['title'] as String? ?? '',
        body: json['body'] as String? ?? '',
        readAt: DateTime.tryParse(json['readAt'] as String? ?? ''),
        createdAt:
            DateTime.tryParse(json['createdAt'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
        payload: json['payload'] as Map<String, dynamic>? ?? const {},
      );

  final String id;
  final String type;
  final String title;
  final String body;
  final DateTime? readAt;
  final DateTime createdAt;

  /// Contexto do evento. É de onde sai o destino do "ver detalhes".
  final Map<String, dynamic> payload;

  bool get isUnread => readAt == null;
}

/// Uma página de notificações, com o total de não lidas do servidor.
class OrbitNotificationPage {
  const OrbitNotificationPage({required this.data, required this.unread});

  factory OrbitNotificationPage.fromJson(Map<String, dynamic> json) {
    final lista = (json['data'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(OrbitNotification.fromJson)
        .toList(growable: false);
    return OrbitNotificationPage(
      data: lista,
      unread: (json['unread'] as num?)?.toInt() ?? 0,
    );
  }

  final List<OrbitNotification> data;

  /// Não lidas na organização inteira, não só nesta página.
  final int unread;
}
