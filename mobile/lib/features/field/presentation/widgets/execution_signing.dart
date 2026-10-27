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
import '../../../../core/routing/orbit_router.dart';
import '../../../../core/theme/orbit_theme.dart';
import '../../../../core/widgets/section_states.dart';
import '../../../signature/presentation/customer_acknowledgement_screen.dart';

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
        CustomerAcknowledgementScreen(
          key: ValueKey(operationId),
          operationId: operationId,
          embedded: true,
        ),
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
