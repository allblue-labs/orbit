/// Deslocamento até o atendimento.
///
/// Infraestrutura apenas: posição atual, coordenadas do atendimento e
/// distância em linha reta. **Sem mapa e sem navegação**, conforme o escopo.
///
/// Duas ausências são declaradas na tela, não escondidas:
///
/// - o atendimento pode não ter coordenadas — `Operation.location` é JSON
///   livre no backend, sem esquema que garanta latitude e longitude;
/// - o tempo estimado exige serviço de roteamento, que não existe hoje.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/theme/orbit_theme.dart';
import '../../../../core/widgets/section_states.dart';
import '../../application/operation_field_providers.dart';

class LocationSection extends ConsumerWidget {
  const LocationSection({super.key, required this.operationId});

  final String operationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final distance = ref.watch(operationDistanceProvider(operationId));

    return SectionBlock(
      title: 'Deslocamento',
      trailing: IconButton(
        tooltip: 'Atualizar posição',
        icon: const Icon(Icons.my_location, size: 20),
        onPressed: () {
          ref
            ..invalidate(currentPositionProvider)
            ..invalidate(operationDistanceProvider(operationId));
        },
      ),
      child: distance.when(
        loading: () => const SectionLoading(lines: 1),
        error: (error, _) => SectionError(
          error: error,
          onRetry: () => ref.invalidate(operationDistanceProvider(operationId)),
        ),
        data: (result) => switch (result) {
          OperationDistanceKnown(:final label) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  const Icon(
                    Icons.near_me_outlined,
                    size: 18,
                    color: OrbitColors.brandBright,
                  ),
                  const SizedBox(width: OrbitSpacing.sm),
                  Text(
                    label,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: OrbitSpacing.sm),
                  const Text(
                    'em linha reta',
                    style: TextStyle(
                      fontSize: 12,
                      color: OrbitColors.textSecondary,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: OrbitSpacing.xs),
              const Text(
                'Tempo estimado indisponível: depende de serviço de rotas.',
                style: TextStyle(
                  fontSize: 11,
                  color: OrbitColors.textSecondary,
                ),
              ),
            ],
          ),
          OperationDistanceUnknown(:final reason) => SectionEmpty(
            icon: Icons.location_off_outlined,
            message: reason,
          ),
        },
      ),
    );
  }
}
