/// Painel de assistência operacional.
///
/// Origem: `GET /ai-executions?operationId=`. Nada é gerado no aplicativo — o
/// que aparece é o que o agente registrou.
///
/// `AiExecution.output` é JSON livre e o backend não publica esquema. Lemos as
/// seções conhecidas quando existem e, quando a saída tem outro formato,
/// dizemos isso em vez de assumir uma estrutura que o contrato não garante.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/contracts/operation_contracts.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../../../core/widgets/section_states.dart';
import '../../application/operation_field_providers.dart';

class IntelligenceSection extends ConsumerWidget {
  const IntelligenceSection({super.key, required this.operationId});

  final String operationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final intelligence = ref.watch(operationIntelligenceProvider(operationId));

    return SectionBlock(
      title: 'Assistência operacional',
      subtitle: 'Análises registradas para esta operação',
      child: intelligence.when(
        loading: () => const SectionLoading(lines: 2),
        error: (error, _) => SectionError(
          error: error,
          onRetry: () =>
              ref.invalidate(operationIntelligenceProvider(operationId)),
        ),
        data: (page) => page.isEmpty
            ? const SectionEmpty(
                icon: Icons.auto_awesome_outlined,
                message: 'Nenhuma análise disponível para esta operação.',
              )
            : Column(
                children: [
                  for (final execution in page.data)
                    _ExecutionBlock(execution: execution),
                ],
              ),
      ),
    );
  }
}

class _ExecutionBlock extends StatelessWidget {
  const _ExecutionBlock({required this.execution});

  final AiExecution execution;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: OrbitSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.auto_awesome,
                size: 16,
                color: OrbitColors.brandBright,
              ),
              const SizedBox(width: OrbitSpacing.sm),
              Expanded(
                child: Text(
                  execution.purpose,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Text(
                execution.status,
                style: const TextStyle(
                  fontSize: 11,
                  color: OrbitColors.textSecondary,
                ),
              ),
            ],
          ),
          const SizedBox(height: OrbitSpacing.sm),

          if (execution.summary != null)
            Text(
              execution.summary!,
              style: const TextStyle(fontSize: 13, height: 1.45),
            ),

          _Findings(
            title: 'Inconsistências',
            items: execution.inconsistencies,
            color: OrbitColors.warning,
          ),
          _Findings(
            title: 'Riscos',
            items: execution.risks,
            color: OrbitColors.warning,
          ),
          _Findings(
            title: 'Alertas',
            items: execution.alerts,
            color: OrbitColors.danger,
          ),
          _Findings(
            title: 'Recomendações',
            items: execution.recommendations,
            color: OrbitColors.brandBright,
          ),
          _Findings(
            title: 'Histórico relacionado',
            items: execution.insights,
            color: OrbitColors.textSecondary,
          ),

          if (!execution.hasReadableOutput)
            Text(
              execution.hasError
                  ? 'A análise registrou uma falha no servidor.'
                  : 'Saída em formato não reconhecido por esta versão do aplicativo.',
              style: const TextStyle(
                fontSize: 12,
                color: OrbitColors.textSecondary,
              ),
            ),
        ],
      ),
    );
  }
}

class _Findings extends StatelessWidget {
  const _Findings({
    required this.title,
    required this.items,
    required this.color,
  });

  final String title;
  final List<String> items;
  final Color color;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: OrbitSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title.toUpperCase(),
            style: TextStyle(
              fontSize: 10,
              letterSpacing: 1.1,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
          const SizedBox(height: 4),
          for (final item in items)
            Padding(
              padding: const EdgeInsets.only(bottom: 3),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.only(top: 6, right: 8),
                    child: Container(
                      width: 5,
                      height: 5,
                      decoration: BoxDecoration(
                        color: color,
                        shape: BoxShape.circle,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      item,
                      style: const TextStyle(
                        fontSize: 12,
                        height: 1.4,
                        color: OrbitColors.textSecondary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
