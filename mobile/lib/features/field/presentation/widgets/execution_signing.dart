/// Assinatura e aceite — **duas** coisas, dois cartões.
///
/// Juntá-las num único bloco chamado "Assinaturas" seria a forma mais rápida de
/// apagar a distinção que o domínio mantém:
///
/// ```text
/// assinatura profissional → do usuário, vale em qualquer documento que assine
/// aceite do cliente       → deste atendimento, registra quem recebeu
/// ```
///
/// Concluir o atendimento não é nenhuma das duas.
///
/// ## O documento saiu daqui
///
/// Ele mora na etapa de finalização, e não nesta. A política dele é
/// `eligibleAfterCompletion`: antes de concluir, a emissão é recusada pelo
/// servidor. Oferecê-la aqui — uma etapa antes — convidava a tentar emitir cedo e
/// ler um bloqueio que a própria ordem das etapas já evitava.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/contracts/field_operation_contracts.dart';
import '../../../../core/presentation/field_registry.dart';
import '../../../../core/presentation/orbit_format.dart';
import '../../../../core/routing/orbit_router.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../../../core/widgets/section_states.dart';
import '../../../signature/application/signature_providers.dart';

class ExecutionSigningSections extends ConsumerWidget {
  const ExecutionSigningSections({
    super.key,
    required this.operationId,
    required this.preparation,
  });

  final String operationId;
  final FieldOperationExecutionPreparationContract preparation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      children: [
        _ProfessionalSignature(
          available: preparation.professionalSignatureAvailable,
        ),
        _Acknowledgement(operationId: operationId),
      ],
    );
  }
}

/// A assinatura do profissional que executa.
class _ProfessionalSignature extends StatelessWidget {
  const _ProfessionalSignature({required this.available});

  final bool available;

  @override
  Widget build(BuildContext context) => SectionBlock(
    title: 'Sua assinatura profissional',
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          available
              ? 'Cadastrada. Será usada nos documentos que você assinar.'
              : 'Ainda não cadastrada.',
          style: TextStyle(
            fontSize: 13,
            color: available ? OrbitColors.textPrimary : OrbitColors.warning,
          ),
        ),
        if (!available) ...[
          const SizedBox(height: OrbitSpacing.sm),

          /// Só um atalho: se este atendimento exige assinatura, quem diz é o
          /// servidor, em `executionEligibility`.
          OutlinedButton(
            onPressed: () => context.push(OrbitRoutes.mySignature),
            style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
            child: const Text('Cadastrar minha assinatura'),
          ),
        ],
      ],
    ),
  );
}

/// A ciência de quem recebeu o serviço.
class _Acknowledgement extends ConsumerWidget {
  const _Acknowledgement({required this.operationId});

  final String operationId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final preparation = ref.watch(
      acknowledgementPreparationProvider(operationId),
    );

    return SectionBlock(
      title: 'Aceite do cliente',
      child: preparation.when(
        loading: () => const SectionLoading(lines: 2),

        /// Nem todo atendimento aceita ciência agora; a recusa do servidor é
        /// a resposta, e o app não a contorna.
        error: (_, _) => Text(
          acknowledgementLabels['unavailable']!.description!,
          style: const TextStyle(
            fontSize: 13,
            color: OrbitColors.textSecondary,
          ),
        ),
        data: (value) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (value.existingAcknowledgement case final existing?) ...[
              Text(
                '${existing.signerName} — '
                '${OrbitFormat.dateHourOf(existing.acknowledgedAt)}',
                style: const TextStyle(
                  fontSize: 13,
                  color: OrbitColors.textPrimary,
                ),
              ),
              const SizedBox(height: 4),
              const Text(
                'Se o atendimento mudou depois disso, colete novamente.',
                style: TextStyle(
                  fontSize: 12,
                  color: OrbitColors.textSecondary,
                ),
              ),
            ] else
              Text(
                acknowledgementLabels['pending']!.description!,
                style: const TextStyle(
                  fontSize: 13,
                  color: OrbitColors.textSecondary,
                ),
              ),
            const SizedBox(height: OrbitSpacing.sm),
            OutlinedButton(
              onPressed: () => context.push(
                OrbitRoutes.customerAcknowledgement(operationId),
              ),
              style: OutlinedButton.styleFrom(minimumSize: const Size(0, 48)),
              child: Text(
                value.existingAcknowledgement == null
                    ? 'Coletar ciência do cliente'
                    : 'Coletar novamente',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// O documento — que ainda não é gerado aqui.
