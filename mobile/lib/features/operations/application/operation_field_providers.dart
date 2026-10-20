/// Providers da execução em campo.
///
/// Localização, inteligência da operação e ações de status. Cada um é
/// independente: uma falha de GPS não afeta a timeline, e o painel de IA
/// indisponível não impede concluir a operação.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/operation_contracts.dart';
import '../../../core/location/location_service.dart';
import '../data/operation_intelligence_repository.dart';
import 'operations_providers.dart';

/// Posição atual do aparelho.
///
/// `autoDispose` de propósito: a leitura de GPS só acontece enquanto a tela
/// que a pede está montada, para não consumir bateria em segundo plano.
final currentPositionProvider = FutureProvider.autoDispose<LocationResult>(
  (ref) => ref.watch(locationServiceProvider).currentPosition(),
);

/// Distância até o local do atendimento.
///
/// Depende de o backend ter gravado coordenadas em `Operation.location`, que é
/// JSON livre e sem esquema. Sem coordenadas, o resultado é
/// [OperationDistanceUnknown] — o app declara que não sabe.
sealed class OperationDistance {
  const OperationDistance();
}

class OperationDistanceKnown extends OperationDistance {
  const OperationDistanceKnown({required this.meters});

  final double meters;

  String get label => formatDistance(meters);

  /// Sempre `null` nesta PR: estimar tempo exige serviço de roteamento.
  Duration? get travelTime => null;
}

class OperationDistanceUnknown extends OperationDistance {
  const OperationDistanceUnknown(this.reason);

  final String reason;
}

final operationDistanceProvider = FutureProvider.autoDispose
    .family<OperationDistance, String>((ref, operationId) async {
      final detail = await ref.watch(
        operationDetailProvider(operationId).future,
      );
      final destination = extractGeoPoint(detail.value.location);
      if (destination == null) {
        return const OperationDistanceUnknown(
          'O atendimento não tem coordenadas registradas.',
        );
      }

      final position = await ref.watch(currentPositionProvider.future);
      return switch (position) {
        LocationAvailable(:final point) => OperationDistanceKnown(
          meters: distanceInMeters(point, destination),
        ),
        LocationUnavailable(:final message) => OperationDistanceUnknown(
          message,
        ),
      };
    });

/// Análises de IA vinculadas à operação (`GET /ai-executions?operationId=`).
final operationIntelligenceProvider = FutureProvider.autoDispose
    .family<Paginated<AiExecution>, String>(
      (ref, operationId) => ref
          .watch(operationIntelligenceRepositoryProvider)
          .forOperation(operationId),
    );

final operationIntelligenceRepositoryProvider =
    Provider<OperationIntelligenceRepository>(
      (ref) =>
          OperationIntelligenceRepository(client: ref.watch(apiClientProvider)),
    );
