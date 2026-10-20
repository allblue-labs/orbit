/// O cliente, sem sair da carteira.
///
/// Mostra o que a pessoa precisa para decidir — quanto há em aberto, quando
/// foi a última visita, quando é a próxima — e oferece os dois caminhos:
/// começar um atendimento ou olhar o histórico.
///
/// ## Documentos por papel
///
/// Quem opera em campo vê ordem de serviço e relatório de visita técnica:
/// são os documentos do trabalho dela. Recibo e orçamento são financeiros, e
/// só aparecem para quem tem `financial.read` — a permissão é do servidor, e
/// esta tela apenas obedece. Esconder um botão não protege nada sozinho; o
/// endpoint continua sendo a autoridade.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/mobile_field_contracts.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/routing/orbit_router.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../field/application/field_providers.dart';
import 'new_quote_sheet.dart';

/// Os tipos de documento que cada papel enxerga.
///
/// Lista explícita, e não "tudo menos": um tipo novo de documento financeiro
/// apareceria para todo mundo se a regra fosse por exclusão.
const documentosDeCampo = <String>{'SERVICE_ORDER', 'RVT', 'PMOC'};
const documentosFinanceiros = <String>{'RECEIPT', 'QUOTE'};

Future<void> showCustomerSheet(
  BuildContext context,
  MobileFieldCustomerContract cliente,
) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: context.orbit.background,
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.58,
      minChildSize: 0.4,
      maxChildSize: 0.92,
      builder: (context, scrollController) =>
          _Folha(cliente: cliente, scrollController: scrollController),
    ),
  );
}

class _Folha extends ConsumerWidget {
  const _Folha({required this.cliente, required this.scrollController});

  final MobileFieldCustomerContract cliente;
  final ScrollController scrollController;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.orbit;
    final session = ref.watch(sessionProvider);
    final veFinanceiro = session?.hasPermission('financial.read') ?? false;

    return Column(
      children: [
        Expanded(
          child: ListView(
            controller: scrollController,
            padding: const EdgeInsets.fromLTRB(
              OrbitSpacing.gutter,
              0,
              OrbitSpacing.gutter,
              OrbitSpacing.md,
            ),
            children: [
              Text(
                cliente.name,
                style: OrbitType.heroTitle.copyWith(
                  color: palette.ink,
                  fontSize: 21,
                ),
              ),
              const SizedBox(height: OrbitSpacing.lg),

              OrbitCard(
                padding: EdgeInsets.zero,
                child: Column(
                  children: [
                    _Dado(
                      rotulo: 'Em aberto',
                      valor: cliente.openCount == 0
                          ? 'Nenhum atendimento'
                          : '${cliente.openCount} atendimento'
                                '${cliente.openCount == 1 ? "" : "s"}',
                      destaque: cliente.openCount > 0,
                    ),
                    const OrbitRowDivider(),
                    _Dado(
                      rotulo: 'Concluídos',
                      valor: '${cliente.completedCount}',
                    ),
                    if (cliente.nextServiceAt case final proximo?) ...[
                      const OrbitRowDivider(),
                      _Dado(
                        rotulo: 'Próximo',
                        valor: OrbitFormat.dateHourOf(proximo),
                      ),
                    ],
                    if (cliente.lastServiceAt case final ultimo?) ...[
                      const OrbitRowDivider(),
                      _Dado(
                        rotulo: 'Última visita',
                        valor: OrbitFormat.dateHourOf(ultimo),
                      ),
                    ],
                  ],
                ),
              ),

              const SizedBox(height: OrbitSpacing.lg),
              Text(
                'Documentos',
                style: OrbitType.sectionTitle.copyWith(color: palette.ink),
              ),
              const SizedBox(height: OrbitSpacing.xs),
              Text(
                veFinanceiro
                    ? 'Ordens, relatórios, recibos e orçamentos deste cliente.'
                    : 'Ordens de serviço e relatórios de visita deste cliente.',
                style: OrbitType.caption.copyWith(color: palette.inkSubtle),
              ),
              const SizedBox(height: OrbitSpacing.ms),
              OutlinedButton.icon(
                onPressed: () {
                  Navigator.of(context).pop();
                  context.go(OrbitRoutes.documents);
                },
                icon: const Icon(Icons.folder_outlined, size: 18),
                label: const Text('Ver documentos'),
              ),

              /// Orçamento é ação de gestão: só aparece com `quotes.manage`.
              if (session?.hasPermission('quotes.manage') ?? false) ...[
                const SizedBox(height: OrbitSpacing.lg),
                Text(
                  'Comercial',
                  style: OrbitType.sectionTitle.copyWith(color: palette.ink),
                ),
                const SizedBox(height: OrbitSpacing.ms),
                OutlinedButton.icon(
                  onPressed: () async {
                    final criado = await showNewQuoteSheet(context, cliente);
                    if (criado && context.mounted) {
                      Navigator.of(context).pop();
                    }
                  },
                  icon: const Icon(Icons.request_quote_outlined, size: 18),
                  label: const Text('Abrir orçamento'),
                ),
              ],
            ],
          ),
        ),

        Container(
          padding: const EdgeInsets.fromLTRB(
            OrbitSpacing.gutter,
            OrbitSpacing.ms,
            OrbitSpacing.gutter,
            OrbitSpacing.ms,
          ),
          decoration: BoxDecoration(
            color: palette.surface,
            boxShadow: OrbitShadow.raised,
          ),
          child: SafeArea(
            top: false,
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () {
                      Navigator.of(context).pop();
                      _abrirHistorico(context, ref);
                    },
                    child: const Text('Histórico'),
                  ),
                ),
                const SizedBox(width: OrbitSpacing.ms),
                Expanded(
                  flex: 2,
                  child: FilledButton.icon(
                    onPressed: cliente.openCount == 0
                        ? null
                        : () {
                            Navigator.of(context).pop();
                            _abrirHistorico(context, ref);
                          },
                    icon: const Icon(Icons.play_arrow_rounded, size: 19),
                    label: Text(
                      cliente.openCount == 0
                          ? 'Nada em aberto'
                          : 'Ir para os atendimentos',
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// Leva à fila **já filtrada** por este cliente.
  ///
  /// É o histórico e a lista de trabalho ao mesmo tempo: a tela de
  /// Atendimentos tem os recortes, e duplicar a lista aqui seria manter duas
  /// implementações do mesmo filtro.
  void _abrirHistorico(BuildContext context, WidgetRef ref) {
    ref.read(workQueueFilterProvider.notifier).state = WorkQueueFilter(
      customerId: cliente.id,
      customerName: cliente.name,
    );
    context.go(OrbitRoutes.workQueue);
  }
}

class _Dado extends StatelessWidget {
  const _Dado({
    required this.rotulo,
    required this.valor,
    this.destaque = false,
  });

  final String rotulo;
  final String valor;
  final bool destaque;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: OrbitSpacing.ml,
        vertical: OrbitSpacing.ms,
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              rotulo,
              style: OrbitType.caption.copyWith(color: palette.inkSubtle),
            ),
          ),
          Text(
            valor,
            style: OrbitType.body.copyWith(
              color: destaque ? palette.accentStrong : palette.ink,
              fontWeight: destaque ? FontWeight.w600 : FontWeight.w400,
            ),
          ),
        ],
      ),
    );
  }
}
