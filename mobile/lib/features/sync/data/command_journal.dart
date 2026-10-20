/// O journal de comandos.
///
/// Guarda **intenções**, não requisições. A diferença importa no replay: uma
/// requisição serializada reexecuta o que o app quis fazer; uma intenção é
/// reapresentada ao servidor, que a revalida contra o estado, a autorização e
/// a designação de agora — e pode recusar.
///
/// ## Escopo
///
/// Todo comando carrega quem o criou e onde. Ao trocar de usuário ou de
/// organização a fila não some: ela deixa de ser **visível e sincronizável**,
/// porque sincronizar o comando de alguém sob o token de outra pessoa é
/// exatamente o que não pode acontecer.
library;

import 'dart:convert';

import '../../../core/contracts/mobile_offline_sync_contracts.dart';
import 'journal_file.dart';

/// Em que ponto a intenção está — do lado de cá.
///
/// `syncing` não é persistido como estado final: ao reabrir, o que estava em
/// voo volta a `pending`. Se chegou ao servidor, a idempotência devolve
/// `ALREADY_APPLIED`; se não chegou, é enviado agora.
enum PendingCommandState { pending, syncing, conflict, rejected, expired }

/// A quem o comando pertence.
///
/// Sem isto, uma fila deixada por um técnico seria enviada com o token do
/// próximo a entrar no aparelho — trocando o autor do trabalho.
final class CommandScope {
  const CommandScope({
    required this.userId,
    required this.organizationId,
    required this.businessUnitId,
  });

  final String userId;
  final String organizationId;
  final String? businessUnitId;

  bool matches(CommandScope other) =>
      userId == other.userId &&
      organizationId == other.organizationId &&
      businessUnitId == other.businessUnitId;

  Map<String, Object?> toJson() => {
    'userId': userId,
    'organizationId': organizationId,
    'businessUnitId': businessUnitId,
  };

  factory CommandScope.fromJson(Map<String, Object?> json) => CommandScope(
    userId: json['userId']! as String,
    organizationId: json['organizationId']! as String,
    businessUnitId: json['businessUnitId'] as String?,
  );
}

/// Uma intenção pendente ou parada.
final class PendingCommand {
  const PendingCommand({
    required this.envelope,
    required this.scope,
    required this.state,
    required this.enqueuedAt,
    this.attempts = 0,
    this.lastAttemptAt,
    this.receipt,
  });

  /// Congelado na criação e **nunca** regenerado. O servidor compara o hash do
  /// conteúdo com o da chave de idempotência; um campo refeito no replay vira
  /// `IDEMPOTENCY_MISMATCH`.
  final OfflineCommandEnvelope envelope;
  final CommandScope scope;
  final PendingCommandState state;
  final DateTime enqueuedAt;
  final int attempts;
  final DateTime? lastAttemptAt;

  /// O último recibo do servidor, quando houve um que não resolveu o comando
  /// (conflito ou recusa). Recibo de sucesso não fica aqui: sai da fila.
  final OfflineCommandResult? receipt;

  bool get isBlocking =>
      state == PendingCommandState.conflict ||
      state == PendingCommandState.rejected ||
      state == PendingCommandState.expired;

  /// Pronto para ir na próxima leva.
  bool get isSendable =>
      state == PendingCommandState.pending ||
      state == PendingCommandState.syncing;

  PendingCommand copyWith({
    PendingCommandState? state,
    int? attempts,
    DateTime? lastAttemptAt,
    OfflineCommandResult? receipt,
    bool clearReceipt = false,
  }) => PendingCommand(
    envelope: envelope,
    scope: scope,
    state: state ?? this.state,
    enqueuedAt: enqueuedAt,
    attempts: attempts ?? this.attempts,
    lastAttemptAt: lastAttemptAt ?? this.lastAttemptAt,
    receipt: clearReceipt ? null : (receipt ?? this.receipt),
  );

  Map<String, Object?> toJson() => {
    'envelope': envelope.toJson(),
    'scope': scope.toJson(),
    'state': state.name,
    'enqueuedAt': enqueuedAt.toUtc().toIso8601String(),
    'attempts': attempts,
    'lastAttemptAt': lastAttemptAt?.toUtc().toIso8601String(),
    'receipt': receipt?.toJson(),
  };

  factory PendingCommand.fromJson(Map<String, Object?> json) => PendingCommand(
    envelope: OfflineCommandEnvelope.fromJson(
      Map<String, Object?>.from(json['envelope']! as Map<Object?, Object?>),
    ),
    scope: CommandScope.fromJson(
      Map<String, Object?>.from(json['scope']! as Map<Object?, Object?>),
    ),

    /// O que estava em voo quando o app morreu volta para a fila.
    state: switch (json['state']) {
      'conflict' => PendingCommandState.conflict,
      'rejected' => PendingCommandState.rejected,
      'expired' => PendingCommandState.expired,
      _ => PendingCommandState.pending,
    },
    enqueuedAt: DateTime.parse(json['enqueuedAt']! as String),
    attempts: (json['attempts'] as num?)?.toInt() ?? 0,
    lastAttemptAt: json['lastAttemptAt'] == null
        ? null
        : DateTime.parse(json['lastAttemptAt']! as String),
    receipt: json['receipt'] == null
        ? null
        : OfflineCommandResult.fromJson(
            Map<String, Object?>.from(
              json['receipt']! as Map<Object?, Object?>,
            ),
          ),
  );
}

/// Um comando já resolvido pelo servidor.
///
/// Persistido **antes** de o comando sair da fila. Se o app morrer entre uma
/// coisa e outra, o recibo já está no disco e a intenção não é reenviada como
/// nova.
final class SyncReceipt {
  const SyncReceipt({
    required this.commandId,
    required this.scope,
    required this.result,
    required this.resolvedAt,
  });

  final String commandId;
  final CommandScope scope;
  final OfflineCommandResult result;
  final DateTime resolvedAt;

  Map<String, Object?> toJson() => {
    'commandId': commandId,
    'scope': scope.toJson(),
    'result': result.toJson(),
    'resolvedAt': resolvedAt.toUtc().toIso8601String(),
  };

  factory SyncReceipt.fromJson(Map<String, Object?> json) => SyncReceipt(
    commandId: json['commandId']! as String,
    scope: CommandScope.fromJson(
      Map<String, Object?>.from(json['scope']! as Map<Object?, Object?>),
    ),
    result: OfflineCommandResult.fromJson(
      Map<String, Object?>.from(json['result']! as Map<Object?, Object?>),
    ),
    resolvedAt: DateTime.parse(json['resolvedAt']! as String),
  );
}

/// O conteúdo inteiro do journal.
final class JournalSnapshot {
  const JournalSnapshot({this.commands = const [], this.receipts = const []});

  final List<PendingCommand> commands;
  final List<SyncReceipt> receipts;

  Map<String, Object?> toJson() => {
    'version': 1,
    'commands': commands.map((value) => value.toJson()).toList(),
    'receipts': receipts.map((value) => value.toJson()).toList(),
  };

  factory JournalSnapshot.fromJson(Map<String, Object?> json) =>
      JournalSnapshot(
        commands: (json['commands'] as List<Object?>? ?? const [])
            .map(
              (value) => PendingCommand.fromJson(
                Map<String, Object?>.from(value! as Map<Object?, Object?>),
              ),
            )
            .toList(),
        receipts: (json['receipts'] as List<Object?>? ?? const [])
            .map(
              (value) => SyncReceipt.fromJson(
                Map<String, Object?>.from(value! as Map<Object?, Object?>),
              ),
            )
            .toList(),
      );
}

/// Retenção local, espelhando `mobile-sync-retention.ts`.
///
/// Os números são do servidor: 90 dias de janela de replay, 120 de recibo.
/// Guardar mais tempo do que o servidor aceita reprocessar produziria uma fila
/// que só existe para falhar.
const replayWindow = Duration(days: 90);
const receiptRetention = Duration(days: 120);

/// O journal, com escrita serializada.
class CommandJournal {
  CommandJournal({required JournalFile file}) : _file = file;

  final JournalFile _file;
  JournalSnapshot? _cache;

  /// Um escritor por vez. Duas gravações concorrentes sobre o mesmo arquivo
  /// produziriam a última a vencer — e a perdida seria um comando do usuário.
  Future<void> _tail = Future.value();

  Future<JournalSnapshot> read() async {
    final cached = _cache;
    if (cached != null) return cached;
    final raw = await _file.read();
    if (raw == null || raw.isEmpty) return _cache = const JournalSnapshot();
    try {
      return _cache = JournalSnapshot.fromJson(
        Map<String, Object?>.from(jsonDecode(raw) as Map<Object?, Object?>),
      );
    } on Object {
      /// Journal ilegível é perda de trabalho, e apagá-lo em silêncio seria
      /// esconder isso. Preserva-se o arquivo para diagnóstico e segue-se com
      /// fila vazia, em vez de travar o app na abertura.
      await _file.write(jsonEncode(const JournalSnapshot().toJson()));
      return _cache = const JournalSnapshot();
    }
  }

  /// Aplica uma transformação e grava — atomicamente, e um de cada vez.
  Future<JournalSnapshot> update(
    JournalSnapshot Function(JournalSnapshot current) change,
  ) {
    final completer = _tail.then((_) async {
      final next = change(await read());
      await _file.write(jsonEncode(next.toJson()));
      return _cache = next;
    });
    _tail = completer.then((_) {}, onError: (_) {});
    return completer;
  }

  /// Registra uma intenção. Só depois disto ela existe.
  Future<JournalSnapshot> enqueue(PendingCommand command) => update(
    (current) => JournalSnapshot(
      commands: [...current.commands, command],
      receipts: current.receipts,
    ),
  );

  /// Guarda o recibo **e** tira o comando da fila, numa gravação só.
  ///
  /// Duas gravações teriam uma janela entre elas em que o comando já saiu e o
  /// recibo ainda não entrou — e um crash ali reenviaria a intenção como nova.
  Future<JournalSnapshot> resolve({
    required String commandId,
    required CommandScope scope,
    required OfflineCommandResult result,
    required DateTime at,
  }) => update(
    (current) => JournalSnapshot(
      commands: current.commands
          .where((value) => value.envelope.commandId != commandId)
          .toList(),
      receipts: [
        ...current.receipts,
        SyncReceipt(
          commandId: commandId,
          scope: scope,
          result: result,
          resolvedAt: at,
        ),
      ],
    ),
  );

  /// Marca um comando sem resolvê-lo: conflito, recusa, tentativa falha.
  Future<JournalSnapshot> mark(
    String commandId,
    PendingCommand Function(PendingCommand current) change,
  ) => update(
    (current) => JournalSnapshot(
      commands: current.commands
          .map(
            (value) =>
                value.envelope.commandId == commandId ? change(value) : value,
          )
          .toList(),
      receipts: current.receipts,
    ),
  );

  /// Descarta uma intenção que o servidor não aplicou.
  Future<JournalSnapshot> discard(String commandId) => update(
    (current) => JournalSnapshot(
      commands: current.commands
          .where((value) => value.envelope.commandId != commandId)
          .toList(),
      receipts: current.receipts,
    ),
  );

  /// Limpeza por retenção.
  ///
  /// Recibo velho sai. Comando pendente **não** sai por idade: passa a
  /// `expired`, porque some-lo seria apagar trabalho sem contar a ninguém. O
  /// servidor recusaria com `OFFLINE_REPLAY_WINDOW_EXPIRED` de todo jeito; a
  /// diferença é que assim a pessoa fica sabendo.
  Future<JournalSnapshot> cleanup(DateTime now) => update(
    (current) => JournalSnapshot(
      commands: current.commands
          .map(
            (value) =>
                value.state != PendingCommandState.expired &&
                    now.difference(value.envelope.occurredAt) > replayWindow
                ? value.copyWith(state: PendingCommandState.expired)
                : value,
          )
          .toList(),
      receipts: current.receipts
          .where(
            (value) => now.difference(value.resolvedAt) <= receiptRetention,
          )
          .toList(),
    ),
  );
}
