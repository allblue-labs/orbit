/// A projeção local do estado do servidor.
///
/// Vive num arquivo **separado** do journal de comandos, e a separação é a
/// garantia: um full resync apaga este arquivo e não tem como alcançar o
/// outro. Fosse tudo um documento só, preservar a fila dependeria de alguém
/// lembrar de filtrar — e é o tipo de coisa que se esquece exatamente na
/// versão em que passa a importar.
///
/// O que está aqui **não é autoritativo**. É a última coisa que o servidor
/// disse, guardada para a tela ter o que mostrar sem rede. Quando há rede, a
/// resposta do servidor vence sempre.
library;

import 'dart:convert';

import '../../../core/contracts/mobile_field_contracts.dart';
import 'journal_file.dart';

/// Teto da projeção guardada.
///
/// Uma fila de campo tem dezenas de itens, não milhares. O limite existe para
/// que um tenant grande não transforme o arquivo local num problema de memória
/// na abertura do app.
const projectionLimit = 300;

final class SyncProjection {
  const SyncProjection({
    this.cursors = const {},
    this.workItems = const {},
    this.lastSyncedAt = const {},
  });

  /// Cursor de pull por escopo. Um cursor único faria a troca de contexto
  /// continuar de onde outra pessoa parou.
  final Map<String, String> cursors;

  /// Itens por escopo, no formato cru em que o servidor os entregou —
  /// reparseados na leitura, para a projeção não envelhecer junto com uma
  /// versão antiga do contrato.
  final Map<String, Map<String, Map<String, dynamic>>> workItems;

  final Map<String, String> lastSyncedAt;

  List<MobileWorkItemContract> itemsFor(String scopeKey) {
    final raw = workItems[scopeKey] ?? const {};
    return raw.values
        .map(MobileWorkItemContract.fromJson)
        .whereType<MobileWorkItemContract>()
        .toList(growable: false);
  }

  Map<String, Object?> toJson() => {
    'version': 1,
    'cursors': cursors,
    'workItems': workItems,
    'lastSyncedAt': lastSyncedAt,
  };

  factory SyncProjection.fromJson(Map<String, Object?> json) => SyncProjection(
    cursors: (json['cursors'] as Map<Object?, Object?>? ?? const {}).map(
      (key, value) => MapEntry(key! as String, value! as String),
    ),
    workItems: (json['workItems'] as Map<Object?, Object?>? ?? const {}).map(
      (scope, items) => MapEntry(
        scope! as String,
        (items! as Map<Object?, Object?>).map(
          (id, item) =>
              MapEntry(id! as String, Map<String, dynamic>.from(item! as Map)),
        ),
      ),
    ),
    lastSyncedAt: (json['lastSyncedAt'] as Map<Object?, Object?>? ?? const {})
        .map((key, value) => MapEntry(key! as String, value! as String)),
  );
}

class SyncProjectionStore {
  SyncProjectionStore({required JournalFile file}) : _file = file;

  final JournalFile _file;
  SyncProjection? _cache;
  Future<void> _tail = Future.value();

  Future<SyncProjection> read() async {
    final cached = _cache;
    if (cached != null) return cached;
    final raw = await _file.read();
    if (raw == null || raw.isEmpty) return _cache = const SyncProjection();
    try {
      return _cache = SyncProjection.fromJson(
        Map<String, Object?>.from(jsonDecode(raw) as Map<Object?, Object?>),
      );
    } on Object {
      /// Projeção ilegível se joga fora sem cerimônia: ela é reconstruível a
      /// partir do servidor, ao contrário da fila de comandos.
      return _cache = const SyncProjection();
    }
  }

  Future<SyncProjection> update(
    SyncProjection Function(SyncProjection current) change,
  ) {
    final completer = _tail.then((_) async {
      final next = change(await read());
      await _file.write(jsonEncode(next.toJson()));
      return _cache = next;
    });
    _tail = completer.then((_) {}, onError: (_) {});
    return completer;
  }

  /// Aplica uma página do pull **e** avança o cursor, numa gravação só.
  ///
  /// Separar as duas coisas abriria a janela clássica: cursor avançado com a
  /// página não aplicada, e a mudança some para sempre — o servidor não a
  /// repete, porque já a considerou entregue.
  Future<SyncProjection> applyPage({
    required String scopeKey,
    required Map<String, Map<String, dynamic>> upserted,
    required Set<String> removed,
    required String? cursor,
    required DateTime syncedAt,
  }) => update((current) {
    final items = {...(current.workItems[scopeKey] ?? const {})};
    items.addAll(upserted);
    items.removeWhere((id, _) => removed.contains(id));

    /// Se a projeção estourar o teto, os mais antigos saem. Perder projeção é
    /// perder cache; o servidor a devolve na próxima consulta.
    final bounded = items.length <= projectionLimit
        ? items
        : Map<String, Map<String, dynamic>>.fromEntries(
            items.entries.toList().sublist(items.length - projectionLimit),
          );

    return SyncProjection(
      cursors: {...current.cursors, if (cursor != null) scopeKey: cursor},
      workItems: {...current.workItems, scopeKey: bounded},
      lastSyncedAt: {
        ...current.lastSyncedAt,
        scopeKey: syncedAt.toUtc().toIso8601String(),
      },
    );
  });

  /// Recomeça a projeção de um escopo.
  ///
  /// Usado quando o servidor responde `FULL_RESYNC_REQUIRED` ou pede purga. O
  /// journal de comandos está noutro arquivo e não é tocado — é a razão de
  /// serem dois.
  Future<SyncProjection> resetScope(String scopeKey) => update(
    (current) => SyncProjection(
      cursors: {...current.cursors}..remove(scopeKey),
      workItems: {...current.workItems}..remove(scopeKey),
      lastSyncedAt: {...current.lastSyncedAt}..remove(scopeKey),
    ),
  );

  /// Apaga tudo. O pacote de campo é marcado `purgeOnLogout: true` pelo próprio
  /// servidor, e conteúdo de cliente não fica num aparelho depois que a pessoa
  /// sai dele.
  Future<void> clear() async {
    await _file.delete();
    _cache = const SyncProjection();
  }
}
