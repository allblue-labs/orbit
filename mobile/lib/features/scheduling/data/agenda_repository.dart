/// Repositório da agenda.
///
/// Endpoint real: `GET /scheduling/agenda` (`AgendaQueryDto` exige `view` e
/// `date`). Exige a capability e a permissão `scheduling.read`.
library;

import '../../../core/contracts/agenda_contracts.dart';
import '../../../core/time/civil_time.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/network/orbit_api_client.dart';
import '../../../core/storage/read_cache.dart';
import '../../operations/data/operations_repository.dart' show CachedResult;

class AgendaRepository {
  const AgendaRepository({
    required OrbitApiClient client,
    required ReadCache cache,
  }) : _client = client,
       _cache = cache;

  final OrbitApiClient _client;
  final ReadCache _cache;

  /// Agenda de um dia ou semana.
  ///
  /// A data é normalizada para o início do dia — assim a chave de cache é
  /// estável e não gera uma entrada nova a cada consulta.
  /// Agenda de um dia.
  ///
  /// `date` é **opcional de propósito**. Quando é nula, o app manda o instante
  /// atual e deixa o servidor decidir em que dia civil ele cai — no fuso da
  /// unidade, que é a autoridade. Derivar a data do relógio do aparelho abriria
  /// a porta para o caso que quebra: às 22h em Recife (UTC-3), a meia-noite
  /// "local" do aparelho já é o dia seguinte em UTC, e o servidor devolveria a
  /// agenda do dia errado.
  ///
  /// Quando o usuário navega, aí sim há uma data civil escolhida — e ela vai
  /// como meio-dia UTC, longe o bastante das bordas para não escorregar de dia
  /// em nenhum fuso do país.
  Future<CachedResult<Agenda>> load({
    required String view,
    CivilDate? date,
    String? businessUnitId,
    DateTime? now,
  }) async {
    final reference = date == null
        ? (now ?? DateTime.now()).toUtc()
        : DateTime.utc(date.year, date.month, date.day, 12);
    final key =
        'agenda.$view.${date?.toIsoString() ?? 'hoje'}.${businessUnitId ?? 'all'}';

    try {
      final data = await _client.get<Map<String, dynamic>>(
        '/scheduling/agenda',
        query: {
          'view': view,
          'date': reference.toIso8601String(),
          if (businessUnitId != null) 'businessUnitId': businessUnitId,
        },
      );
      await _cache.write(key, data);
      return CachedResult(value: Agenda.fromJson(data), cachedAt: null);
    } on OrbitException catch (error) {
      if (!error.isOffline && !error.isServer) rethrow;
      final cached = await _cache.read(key);
      if (cached == null) rethrow;
      return CachedResult(
        value: Agenda.fromJson(cached.value),
        cachedAt: cached.cachedAt,
      );
    }
  }
}
