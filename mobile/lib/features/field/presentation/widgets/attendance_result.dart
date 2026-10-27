import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/presentation/orbit_format.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../../../core/widgets/section_states.dart';
import '../../../signature/application/signature_providers.dart';

/// O atendimento e a emissão do PDF têm estados distintos: o check depende da conclusão real.
class AttendanceResult extends StatelessWidget {
  const AttendanceResult({
    super.key,
    required this.completed,
    required this.finishing,
    required this.child,
    this.error,
    this.onRetry,
  });
  final bool completed;
  final bool finishing;
  final Object? error;
  final VoidCallback? onRetry;
  final Widget child;
  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      SectionBlock(
        title: completed ? 'Atendimento concluído' : 'Finalizando atendimento',
        child: Semantics(
          liveRegion: true,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (completed)
                const Icon(
                  Icons.check_circle_rounded,
                  size: 40,
                  color: OrbitColors.success,
                )
              else if (finishing || error == null)
                const SizedBox(
                  width: 32,
                  height: 32,
                  child: CircularProgressIndicator(strokeWidth: 3),
                )
              else
                const Icon(
                  Icons.error_outline,
                  color: OrbitColors.danger,
                  size: 32,
                ),
              const SizedBox(width: OrbitSpacing.md),
              Expanded(
                child: Text(
                  completed
                      ? 'Os registros e a confirmação do cliente foram salvos. O relatório será disponibilizado abaixo.'
                      : finishing
                      ? 'Estamos salvando a conclusão do atendimento…'
                      : error == null
                      ? 'A conclusão está aguardando sincronização. O relatório ficará disponível após a confirmação do servidor.'
                      : 'A confirmação do cliente foi salva. Falta concluir o atendimento no servidor.',
                ),
              ),
            ],
          ),
        ),
      ),
      if (error != null)
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: OrbitSpacing.gutter),
          child: Column(
            children: [
              SectionError(error: error!),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.replay),
                label: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      child,
    ],
  );
}

class AttendanceTechnicalSummary extends ConsumerWidget {
  const AttendanceTechnicalSummary({
    super.key,
    required this.operationId,
    this.code,
    this.technician,
    this.completedAt,
  });
  final String operationId;
  final String? code;
  final String? technician;
  final DateTime? completedAt;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final summary = ref.watch(acknowledgementPreparationProvider(operationId));
    return SectionBlock(
      title: 'Resumo técnico',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (code != null)
            Text(code!, style: const TextStyle(fontWeight: FontWeight.w600)),
          if (technician != null) Text('Técnico: $technician'),
          if (completedAt != null)
            Text('Concluído em ${OrbitFormat.dateHourOf(completedAt)}'),
          const SizedBox(height: OrbitSpacing.sm),
          summary.when(
            loading: () => const SectionLoading(lines: 3),
            error: (error, _) => SectionError(error: error),
            data: (value) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (value.customerName != null)
                  Text('Cliente: ${value.customerName}'),
                for (final equipment in value.equipment)
                  Text('${equipment.name} · ${equipment.code}'),
                const SizedBox(height: OrbitSpacing.sm),
                Text(value.serviceSummary, style: const TextStyle(height: 1.5)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
