/// O vocabulário visual da área do cliente.
///
/// Cartões, e não linhas de lista: o técnico lê uma fila de doze atendimentos
/// numa coluna de horários — o cliente abre o app de vez em quando, procura
/// "aquele relatório" ou "o ar da recepção", e precisa reconhecer cada item
/// pelo formato antes de ler. Por isso cada cartão tem um ícone do que é, a
/// data em destaque e o estado num selo.
library;

import 'package:flutter/material.dart';

import '../../../core/design/orbit_primitives.dart';
import '../../../core/theme/orbit_theme.dart';
import '../data/portal_contracts.dart';
import 'portal_common.dart';

const _meses = [
  'JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', //
  'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ',
];

/// A superfície de todo item da área do cliente.
class PortalCard extends StatelessWidget {
  const PortalCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(OrbitSpacing.md),
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return DecoratedBox(
      decoration: BoxDecoration(
        color: palette.surface,
        borderRadius: OrbitRadius.card,
        boxShadow: OrbitShadow.card,
      ),
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: OrbitRadius.card,
          onTap: onTap,
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}

/// Uma lista de cartões com o respiro certo entre eles.
class PortalCardList extends StatelessWidget {
  const PortalCardList({super.key, required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final (indice, filho) in children.indexed) ...[
        if (indice > 0) const SizedBox(height: OrbitSpacing.ms),
        filho,
      ],
    ],
  );
}

/// O quadrado com o ícone do que o item é.
class PortalIconTile extends StatelessWidget {
  const PortalIconTile({
    super.key,
    required this.icon,
    this.tone = OrbitTone.info,
  });

  final IconData icon;
  final OrbitTone tone;

  @override
  Widget build(BuildContext context) {
    final (fundo, tinta) = portalToneColors(context, tone);
    return Container(
      width: 44,
      height: 44,
      decoration: BoxDecoration(color: fundo, borderRadius: OrbitRadius.field),
      child: Icon(icon, color: tinta, size: 22),
    );
  }
}

(Color, Color) portalToneColors(BuildContext context, OrbitTone tone) {
  final p = context.orbit;
  return switch (tone) {
    OrbitTone.success => (p.successSoft, p.success),
    OrbitTone.warning => (p.warningSoft, p.warning),
    OrbitTone.danger => (p.dangerSoft, p.danger),
    OrbitTone.intelligence => (p.intelligenceSoft, p.intelligence),
    OrbitTone.info => (p.accentSoft, p.accentStrong),
    OrbitTone.neutral => (p.surfaceMuted, p.inkMuted),
  };
}

/// A data em bloco: dia grande, mês embaixo.
class PortalDateBlock extends StatelessWidget {
  const PortalDateBlock({super.key, required this.when, this.tone});

  final DateTime? when;
  final OrbitTone? tone;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final (fundo, tinta) = portalToneColors(context, tone ?? OrbitTone.neutral);
    final data = when;
    return Container(
      width: 48,
      padding: const EdgeInsets.symmetric(vertical: OrbitSpacing.sm),
      decoration: BoxDecoration(color: fundo, borderRadius: OrbitRadius.field),
      child: data == null
          ? Icon(Icons.event_busy_outlined, color: palette.inkSubtle, size: 20)
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  data.day.toString().padLeft(2, '0'),
                  style: OrbitType.sectionTitle.copyWith(
                    color: tinta,
                    height: 1.1,
                  ),
                ),
                Text(
                  _meses[data.month - 1],
                  style: OrbitType.eyebrow.copyWith(color: tinta),
                ),
              ],
            ),
    );
  }
}

/// Um atendimento: quando, o quê, quem e em que pé está.
class PortalOperationCard extends StatelessWidget {
  const PortalOperationCard({
    super.key,
    required this.operation,
    required this.onTap,
  });

  final PortalOperation operation;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final tom = operationTone(operation.status.code);
    final equipamentos = operation.assets.map((a) => a.name).join(', ');
    return PortalCard(
      onTap: onTap,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PortalDateBlock(when: operation.when, tone: tom),
          const SizedBox(width: OrbitSpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  operation.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: OrbitType.itemTitle.copyWith(color: palette.ink),
                ),
                const SizedBox(height: 2),
                Text(
                  [
                    operation.type,
                    if (operation.technician case final String t) t,
                  ].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: OrbitType.caption.copyWith(color: palette.inkMuted),
                ),
                if (equipamentos.isNotEmpty) ...[
                  const SizedBox(height: OrbitSpacing.xs),
                  _ComIcone(icon: Icons.ac_unit, text: equipamentos),
                ],
                const SizedBox(height: OrbitSpacing.sm),
                Wrap(
                  spacing: OrbitSpacing.sm,
                  runSpacing: OrbitSpacing.xs,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    OrbitStatusBadge(label: operation.status.label, tone: tom),
                    if (operation.documentId != null)
                      _Etiqueta(
                        icon: Icons.description_outlined,
                        text: 'Documento disponível',
                      ),
                  ],
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right, color: palette.inkSubtle),
        ],
      ),
    );
  }
}

/// Um equipamento: o que é, onde está e se está em ordem.
class PortalAssetCard extends StatelessWidget {
  const PortalAssetCard({super.key, required this.asset, required this.onTap});

  final PortalAsset asset;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final onde = [
      asset.location,
      asset.identifier,
    ].whereType<String>().join(' · ');
    return PortalCard(
      onTap: onTap,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const PortalIconTile(icon: Icons.ac_unit),
          const SizedBox(width: OrbitSpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  asset.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: OrbitType.itemTitle.copyWith(color: palette.ink),
                ),
                const SizedBox(height: 2),
                Text(
                  asset.makeAndModel ?? asset.category,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: OrbitType.caption.copyWith(color: palette.inkMuted),
                ),
                if (onde.isNotEmpty) ...[
                  const SizedBox(height: OrbitSpacing.xs),
                  _ComIcone(icon: Icons.place_outlined, text: onde),
                ],
                const SizedBox(height: OrbitSpacing.sm),
                OrbitStatusBadge(
                  label: asset.status.label,
                  tone: assetTone(asset.status.code),
                ),
              ],
            ),
          ),
          Icon(Icons.chevron_right, color: palette.inkSubtle),
        ],
      ),
    );
  }
}

/// O ícone e o tom de cada categoria de documento.
(IconData, OrbitTone) documentLook(PortalDocumentCategory category) =>
    switch (category) {
      PortalDocumentCategory.service => (
        Icons.assignment_turned_in_outlined,
        OrbitTone.info,
      ),
      PortalDocumentCategory.pmoc => (
        Icons.fact_check_outlined,
        OrbitTone.success,
      ),
      PortalDocumentCategory.quote => (
        Icons.request_quote_outlined,
        OrbitTone.warning,
      ),
      PortalDocumentCategory.receipt => (
        Icons.receipt_long_outlined,
        OrbitTone.intelligence,
      ),
    };

/// Um documento: o tipo pelo ícone, o título, e o envio a um toque.
class PortalDocumentCard extends StatelessWidget {
  const PortalDocumentCard({
    super.key,
    required this.document,
    required this.onOpen,
  });

  final PortalDocument document;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final (icone, tom) = documentLook(document.category);
    return PortalCard(
      onTap: onOpen,
      padding: const EdgeInsets.fromLTRB(
        OrbitSpacing.md,
        OrbitSpacing.md,
        OrbitSpacing.xs,
        OrbitSpacing.md,
      ),
      child: Row(
        children: [
          PortalIconTile(icon: icone, tone: tom),
          const SizedBox(width: OrbitSpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  document.title.isEmpty
                      ? document.categoryLabel
                      : document.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: OrbitType.itemTitle.copyWith(color: palette.ink),
                ),
                const SizedBox(height: 2),
                Text(
                  [
                    document.categoryLabel,
                    if (document.issuedAt != null)
                      'emitido em ${portalDate(document.issuedAt)}',
                  ].join(' · '),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: OrbitType.caption.copyWith(color: palette.inkMuted),
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'Abrir ou compartilhar',
            onPressed: onOpen,
            icon: Icon(Icons.ios_share, color: palette.accent),
          ),
        ],
      ),
    );
  }
}

/// Os dados de uma ficha, um por linha: rótulo em cima, valor embaixo.
///
/// Empilhado, e não em duas colunas: numa tela de 320 pixels a coluna de
/// rótulos quebrava "Fabricante e modelo" em duas linhas e espremia o valor.
class PortalFactsCard extends StatelessWidget {
  const PortalFactsCard({super.key, required this.facts});

  /// Sem valor, a linha não aparece.
  final List<(String, String?)> facts;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final linhas = facts
        .where((fato) => fato.$2 != null && fato.$2!.trim().isNotEmpty)
        .toList();
    if (linhas.isEmpty) return const SizedBox.shrink();
    return PortalCard(
      padding: const EdgeInsets.symmetric(horizontal: OrbitSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (indice, (rotulo, valor)) in linhas.indexed) ...[
            if (indice > 0) Divider(height: 1, color: palette.border),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: OrbitSpacing.ms),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    rotulo,
                    style: OrbitType.caption.copyWith(color: palette.inkMuted),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    valor!,
                    style: OrbitType.body.copyWith(color: palette.ink),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// O cabeçalho das fichas: o tipo, o nome e o estado.
class PortalSheetHeader extends StatelessWidget {
  const PortalSheetHeader({
    super.key,
    required this.icon,
    required this.tone,
    required this.eyebrow,
    required this.title,
    required this.badge,
  });

  final IconData icon;
  final OrbitTone tone;
  final String eyebrow;
  final String title;
  final Widget badge;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        PortalIconTile(icon: icon, tone: tone),
        const SizedBox(width: OrbitSpacing.ms),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                eyebrow.toUpperCase(),
                style: OrbitType.eyebrow.copyWith(color: palette.inkSubtle),
              ),
              const SizedBox(height: 2),
              Text(
                title,
                style: OrbitType.sectionTitle.copyWith(color: palette.ink),
              ),
              const SizedBox(height: OrbitSpacing.sm),
              badge,
            ],
          ),
        ),
      ],
    );
  }
}

/// A linha do tempo de um atendimento, com o fio ligando os eventos.
class PortalTimeline extends StatelessWidget {
  const PortalTimeline({super.key, required this.events});

  final List<PortalTimelineEvent> events;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return PortalCard(
      child: Column(
        children: [
          for (final (indice, evento) in events.indexed)
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  SizedBox(
                    width: 16,
                    child: Column(
                      children: [
                        const SizedBox(height: 5),
                        Container(
                          width: 10,
                          height: 10,
                          decoration: BoxDecoration(
                            color: indice == 0
                                ? palette.accent
                                : palette.borderStrong,
                            shape: BoxShape.circle,
                          ),
                        ),
                        if (indice < events.length - 1)
                          Expanded(
                            child: Container(width: 2, color: palette.border),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: OrbitSpacing.ms),
                  Expanded(
                    child: Padding(
                      padding: EdgeInsets.only(
                        bottom: indice < events.length - 1
                            ? OrbitSpacing.md
                            : 0,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            evento.description.isEmpty
                                ? evento.event
                                : evento.description,
                            style: OrbitType.body.copyWith(color: palette.ink),
                          ),
                          Text(
                            portalDateTime(evento.occurredAt),
                            style: OrbitType.caption.copyWith(
                              color: palette.inkMuted,
                            ),
                          ),
                        ],
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

/// Um aviso discreto dentro das fichas: "nada aqui ainda, e por quê".
class PortalNote extends StatelessWidget {
  const PortalNote({super.key, required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Container(
      padding: const EdgeInsets.all(OrbitSpacing.md),
      decoration: BoxDecoration(
        color: palette.surfaceMuted,
        borderRadius: OrbitRadius.card,
      ),
      child: Row(
        children: [
          Icon(icon, color: palette.inkSubtle, size: 20),
          const SizedBox(width: OrbitSpacing.ms),
          Expanded(
            child: Text(
              text,
              style: OrbitType.caption.copyWith(color: palette.inkMuted),
            ),
          ),
        ],
      ),
    );
  }
}

class _ComIcone extends StatelessWidget {
  const _ComIcone({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Row(
      children: [
        Icon(icon, size: 14, color: palette.inkSubtle),
        const SizedBox(width: OrbitSpacing.xs),
        Expanded(
          child: Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: OrbitType.caption.copyWith(color: palette.inkMuted),
          ),
        ),
      ],
    );
  }
}

class _Etiqueta extends StatelessWidget {
  const _Etiqueta({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: palette.accent),
        const SizedBox(width: 4),
        Flexible(
          child: Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: OrbitType.caption.copyWith(color: palette.accent),
          ),
        ),
      ],
    );
  }
}
