/// O atendimento, sem sair da lista.
///
/// ## Por que folha e não tela
///
/// Quem percorre a lista está **decidindo** qual atendimento abrir, e essa
/// decisão pede duas ou três informações a mais que a linha cabe. Empurrar uma
/// tela inteira para cada espiada custa a ida, a volta e a perda da posição na
/// rolagem — três vezes seguidas e a pessoa para de conferir.
///
/// A folha mostra o que a decisão precisa e oferece **uma** saída conforme o
/// estado: continuar o trabalho quando há trabalho, ou pegar o documento
/// quando já terminou.
library;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/contracts/mobile_field_contracts.dart';
import '../../../../core/design/orbit_primitives.dart';
import '../../../../core/presentation/field_registry.dart';
import '../../../../core/routing/orbit_router.dart';
import '../../../../core/theme/orbit_theme.dart';
import 'work_item_row.dart'
    show dueToneOf, equipmentText, locationText, scheduleText;

Future<void> showWorkItemSheet(
  BuildContext context,
  MobileWorkItemContract item, {
  String? currentUserId,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: context.orbit.background,
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.6,
      minChildSize: 0.4,
      maxChildSize: 0.92,
      builder: (context, scrollController) => _Folha(
        item: item,
        currentUserId: currentUserId,
        scrollController: scrollController,
      ),
    ),
  );
}

class _Folha extends StatelessWidget {
  const _Folha({
    required this.item,
    required this.scrollController,
    this.currentUserId,
  });

  final MobileWorkItemContract item;
  final ScrollController scrollController;
  final String? currentUserId;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final selo = dueStateLabel(item.dueState);

    /// Documentos prontos para levar. Só os que o servidor liberou: um botão
    /// que baixa nada é pior que botão nenhum.
    final documentos = item.artifacts
        .where((artefato) => artefato.downloadAvailable)
        .toList();

    final concluido = documentos.isNotEmpty && item.allowedActions.length <= 1;

    return ListView(
      controller: scrollController,
      padding: const EdgeInsets.fromLTRB(
        OrbitSpacing.gutter,
        0,
        OrbitSpacing.gutter,
        OrbitSpacing.xl,
      ),
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                item.customer?.name ?? item.title,
                style: OrbitType.heroTitle.copyWith(
                  color: palette.ink,
                  fontSize: 21,
                ),
              ),
            ),
            if (selo.isNotEmpty) ...[
              const SizedBox(width: OrbitSpacing.sm),
              OrbitStatusBadge(label: selo, tone: dueToneOf(item.dueState)),
            ],
          ],
        ),
        if (item.customer != null) ...[
          const SizedBox(height: OrbitSpacing.xs),
          Text(
            item.title,
            style: OrbitType.body.copyWith(color: palette.inkMuted),
          ),
        ],
        const SizedBox(height: OrbitSpacing.lg),

        OrbitCard(
          padding: EdgeInsets.zero,
          child: Column(
            children: [
              _Dado(rotulo: 'Quando', valor: scheduleText(item)),
              const OrbitRowDivider(),
              _Dado(rotulo: 'Natureza', valor: workItemKindLabel(item.kind)),
              if (locationText(item) case final local?
                  when local.isNotEmpty) ...[
                const OrbitRowDivider(),
                _Dado(rotulo: 'Local', valor: local),
              ],
              if (item.equipmentSummary.isNotEmpty) ...[
                const OrbitRowDivider(),
                _Dado(
                  rotulo: 'Equipamento',
                  valor: equipmentText(item.equipmentSummary),
                ),
              ],
              const OrbitRowDivider(),
              _Dado(rotulo: 'Organização', valor: item.businessUnit.name),
              if (item.responsibleFieldTechnician case final tecnico?) ...[
                const OrbitRowDivider(),
                _Dado(rotulo: 'Responsável', valor: tecnico.name),
              ],
              if (item.auxiliaryTechnicians.isNotEmpty) ...[
                const OrbitRowDivider(),
                _Dado(
                  rotulo: 'auxiliares técnico',
                  valor: item.auxiliaryTechnicians
                      .map((pessoa) => pessoa.name)
                      .join(', '),
                ),
              ],
            ],
          ),
        ),

        if (documentos.isNotEmpty) ...[
          const SizedBox(height: OrbitSpacing.lg),
          Text(
            'Documentos',
            style: OrbitType.sectionTitle.copyWith(color: palette.ink),
          ),
          const SizedBox(height: OrbitSpacing.ms),
          OrbitCard(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (final (indice, artefato) in documentos.indexed) ...[
                  if (indice > 0) const OrbitRowDivider(),
                  OrbitListRow(
                    /// Sem tradução, o tipo não aparece: um "SERVICE_ORDER"
                    /// na tela é o mesmo vazamento de código que a agenda
                    /// tinha.
                    title:
                        artifactDocumentTypeLabel(artefato.type) ?? 'Documento',
                    subtitle: 'Pronto para baixar',
                    trailing: Icon(
                      Icons.download_rounded,
                      size: 20,
                      color: palette.accent,
                    ),
                    onTap: () {
                      Navigator.of(context).pop();
                      context.go(OrbitRoutes.documents);
                    },
                  ),
                ],
              ],
            ),
          ),
        ],

        const SizedBox(height: OrbitSpacing.lg),

        /// Uma saída, conforme o estado. Quem terminou quer o documento; quem
        /// não terminou quer continuar — oferecer os dois com o mesmo peso
        /// obriga a pessoa a escolher onde não há escolha.
        FilledButton.icon(
          onPressed: () {
            Navigator.of(context).pop();
            context.push(OrbitRoutes.workItemDetail(item.id));
          },
          icon: Icon(
            concluido ? Icons.visibility_outlined : Icons.play_arrow_rounded,
            size: 19,
          ),
          label: Text(concluido ? 'Ver atendimento' : 'Abrir atendimento'),
        ),
      ],
    );
  }
}

class _Dado extends StatelessWidget {
  const _Dado({required this.rotulo, required this.valor});

  final String rotulo;
  final String valor;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: OrbitSpacing.ml,
        vertical: OrbitSpacing.ms,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 116,
            child: Text(
              rotulo,
              style: OrbitType.caption.copyWith(color: palette.inkSubtle),
            ),
          ),
          const SizedBox(width: OrbitSpacing.sm),
          Expanded(
            child: Text(
              valor,
              style: OrbitType.body.copyWith(color: palette.ink),
            ),
          ),
        ],
      ),
    );
  }
}
