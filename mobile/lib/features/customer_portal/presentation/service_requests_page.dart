/// Os chamados do cliente: abrir, acompanhar, responder, corrigir e cancelar.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design/orbit_primitives.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../application/portal_providers.dart';
import '../application/portal_session.dart';
import '../data/portal_contracts.dart';
import 'portal_common.dart';
import 'portal_widgets.dart';
import 'service_request_wizard.dart';

/// O tom do status do chamado.
OrbitTone serviceRequestTone(String code) => switch (code) {
  'OPEN' => OrbitTone.info,
  'IN_TRIAGE' || 'IN_PROGRESS' => OrbitTone.info,
  'WAITING_CUSTOMER' => OrbitTone.warning,
  'RESOLVED' => OrbitTone.success,
  'REJECTED' => OrbitTone.danger,
  _ => OrbitTone.neutral,
};

/// "Urgente", e não "Urgência urgente"; os demais dizem o grau.
String urgencyBadge(ServiceRequestUrgency urgency) =>
    urgency == ServiceRequestUrgency.urgent
    ? 'Urgente'
    : 'Urgência ${urgency.label.toLowerCase()}';

OrbitTone urgencyTone(ServiceRequestUrgency urgency) => switch (urgency) {
  ServiceRequestUrgency.urgent => OrbitTone.danger,
  ServiceRequestUrgency.high => OrbitTone.warning,
  _ => OrbitTone.neutral,
};

/// Abre o assistente e, criado o chamado, mostra a ficha dele.
Future<void> openNewServiceRequest(
  BuildContext context, {
  String? assetId,
}) async {
  final criado = await showServiceRequestWizard(context, assetId: assetId);
  if (criado == null || !context.mounted) return;
  ScaffoldMessenger.maybeOf(
    context,
  )?.showSnackBar(SnackBar(content: Text('Chamado ${criado.code} aberto.')));
  await showServiceRequestSheet(context, criado.id);
}

class PortalServiceRequestsPage extends ConsumerWidget {
  const PortalServiceRequestsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.orbit;
    final chamados = ref.watch(portalServiceRequestsProvider);
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(portalServiceRequestsProvider);
        await ref.read(portalServiceRequestsProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          OrbitSpacing.gutter,
          OrbitSpacing.md,
          OrbitSpacing.gutter,
          OrbitSpacing.xl,
        ),
        children: [
          FilledButton.icon(
            key: const Key('portal.request.new'),
            onPressed: () => openNewServiceRequest(context),
            icon: const Icon(Icons.add),
            label: const Text('Abrir chamado'),
          ),
          const SizedBox(height: OrbitSpacing.xs),
          Text(
            'Peça manutenção, avise sobre um problema ou tire uma dúvida. A equipe responde por aqui.',
            textAlign: TextAlign.center,
            style: OrbitType.caption.copyWith(color: palette.inkMuted),
          ),
          const SizedBox(height: OrbitSpacing.lg),
          chamados.when(
            loading: () => const SectionLoading(lines: 4),
            error: (error, _) => SectionError(
              error: error,
              onRetry: () => ref.invalidate(portalServiceRequestsProvider),
            ),
            data: (page) {
              if (page.items.isEmpty) {
                return const SectionEmpty(
                  icon: Icons.support_agent_outlined,
                  message:
                      'Nenhum chamado ainda. Quando precisar de algo, abra um chamado e acompanhe tudo por aqui.',
                );
              }
              final ativos = page.items.where((r) => r.isActive).toList();
              final encerrados = page.items.where((r) => !r.isActive).toList();
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (ativos.isNotEmpty) ...[
                    const PortalBlockTitle('Em andamento'),
                    PortalCardList(
                      children: [
                        for (final chamado in ativos)
                          ServiceRequestCard(request: chamado),
                      ],
                    ),
                  ],
                  if (encerrados.isNotEmpty) ...[
                    const PortalBlockTitle('Encerrados'),
                    PortalCardList(
                      children: [
                        for (final chamado in encerrados)
                          ServiceRequestCard(request: chamado),
                      ],
                    ),
                  ],
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class ServiceRequestCard extends StatelessWidget {
  const ServiceRequestCard({super.key, required this.request});

  final ServiceRequest request;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final esperando = request.status.code == 'WAITING_CUSTOMER';
    return PortalCard(
      onTap: () => showServiceRequestSheet(context, request.id),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PortalIconTile(
            icon: serviceRequestIcon(request.category),
            tone: serviceRequestTone(request.status.code),
          ),
          const SizedBox(width: OrbitSpacing.ms),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  request.subject,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: OrbitType.itemTitle.copyWith(color: palette.ink),
                ),
                const SizedBox(height: 2),
                Text(
                  [
                    request.code,
                    request.category.label,
                    if (request.updatedAt != null)
                      'atualizado em ${portalDate(request.updatedAt)}',
                  ].join(' · '),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: OrbitType.caption.copyWith(color: palette.inkMuted),
                ),
                const SizedBox(height: OrbitSpacing.sm),
                Wrap(
                  spacing: OrbitSpacing.sm,
                  runSpacing: OrbitSpacing.xs,
                  children: [
                    OrbitStatusBadge(
                      label: esperando
                          ? 'Aguardando sua resposta'
                          : request.status.label,
                      tone: serviceRequestTone(request.status.code),
                    ),
                    if (request.urgency == ServiceRequestUrgency.urgent ||
                        request.urgency == ServiceRequestUrgency.high)
                      OrbitStatusBadge(
                        label: urgencyBadge(request.urgency),
                        tone: urgencyTone(request.urgency),
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

Future<void> showServiceRequestSheet(BuildContext context, String id) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      useSafeArea: true,
      backgroundColor: context.orbit.background,
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.9,
          minChildSize: 0.5,
          maxChildSize: 0.95,
          builder: (context, controller) => PrimaryScrollController(
            controller: controller,
            child: _ServiceRequestSheet(id: id),
          ),
        ),
      ),
    );

class _ServiceRequestSheet extends ConsumerStatefulWidget {
  const _ServiceRequestSheet({required this.id});

  final String id;

  @override
  ConsumerState<_ServiceRequestSheet> createState() =>
      _ServiceRequestSheetState();
}

class _ServiceRequestSheetState extends ConsumerState<_ServiceRequestSheet> {
  final _resposta = TextEditingController();
  bool _enviando = false;

  @override
  void dispose() {
    _resposta.dispose();
    super.dispose();
  }

  void _recarregar() {
    ref
      ..invalidate(portalServiceRequestProvider(widget.id))
      ..invalidate(portalServiceRequestsProvider);
  }

  Future<void> _rodar(
    Future<ServiceRequest> Function() acao,
    String falha,
  ) async {
    setState(() => _enviando = true);
    try {
      await acao();
      _recarregar();
    } on Object catch (error) {
      if (mounted) {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(
          SnackBar(
            content: Text(
              OrbitException.publicCopyForAny(error, prefixo: falha),
            ),
          ),
        );
      }
      _recarregar();
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  Future<void> _responder(ServiceRequest chamado) async {
    final texto = _resposta.text.trim();
    if (texto.isEmpty) return;
    await _rodar(() async {
      final r = await ref
          .read(portalRepositoryProvider)
          .replyServiceRequest(
            chamado.id,
            texto,
            expectedVersion: chamado.version,
          );
      _resposta.clear();
      return r;
    }, 'Não foi possível enviar a mensagem.');
  }

  Future<void> _cancelar(ServiceRequest chamado) async {
    final confirmado = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancelar este chamado?'),
        content: const Text(
          'A equipe deixa de atendê-lo. O histórico continua aqui para consulta.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Voltar'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Cancelar chamado'),
          ),
        ],
      ),
    );
    if (confirmado != true) return;
    await _rodar(
      () => ref
          .read(portalRepositoryProvider)
          .cancelServiceRequest(chamado.id, expectedVersion: chamado.version),
      'Não foi possível cancelar o chamado.',
    );
  }

  Future<void> _editar(ServiceRequest chamado) async {
    final salvo = await showServiceRequestWizard(context, editing: chamado);
    if (salvo != null) _recarregar();
  }

  @override
  Widget build(BuildContext context) {
    final chamado = ref.watch(portalServiceRequestProvider(widget.id));
    return chamado.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(OrbitSpacing.lg),
        child: SectionLoading(lines: 6),
      ),
      error: (error, _) => Padding(
        padding: const EdgeInsets.all(OrbitSpacing.lg),
        child: SectionError(
          error: error,
          onRetry: () =>
              ref.invalidate(portalServiceRequestProvider(widget.id)),
        ),
      ),
      data: _corpo,
    );
  }

  Widget _corpo(ServiceRequest chamado) {
    final palette = context.orbit;
    final esperando = chamado.status.code == 'WAITING_CUSTOMER';
    return ListView(
      controller: PrimaryScrollController.of(context),
      padding: const EdgeInsets.fromLTRB(
        OrbitSpacing.gutter,
        0,
        OrbitSpacing.gutter,
        OrbitSpacing.xl,
      ),
      children: [
        PortalSheetHeader(
          icon: serviceRequestIcon(chamado.category),
          tone: serviceRequestTone(chamado.status.code),
          eyebrow: '${chamado.category.label} · ${chamado.code}',
          title: chamado.subject,
          badge: Wrap(
            spacing: OrbitSpacing.sm,
            runSpacing: OrbitSpacing.xs,
            children: [
              OrbitStatusBadge(
                label: chamado.status.label,
                tone: serviceRequestTone(chamado.status.code),
              ),
              OrbitStatusBadge(
                label: urgencyBadge(chamado.urgency),
                tone: urgencyTone(chamado.urgency),
              ),
            ],
          ),
        ),
        if (esperando) ...[
          const SizedBox(height: OrbitSpacing.md),
          const PortalNote(
            icon: Icons.reply,
            text:
                'A equipe está esperando sua resposta. Escreva abaixo para o chamado continuar.',
          ),
        ],
        const PortalBlockTitle('O que você pediu'),
        PortalCard(
          child: Text(
            chamado.description,
            style: OrbitType.body.copyWith(color: palette.ink),
          ),
        ),
        const SizedBox(height: OrbitSpacing.ms),
        PortalFactsCard(
          facts: [
            ('Equipamento', chamado.asset?.name),
            ('Situação do equipamento', chamado.equipmentCondition?.label),
            ('Onde fica', chamado.siteLocation),
            ('Melhor horário', chamado.availability),
            ('Contato', chamado.contactName),
            ('Telefone', chamado.contactPhone),
            ('Aberto em', portalDateTime(chamado.submittedAt)),
          ],
        ),
        const PortalBlockTitle('Conversa'),
        _Conversa(eventos: chamado.timeline),
        if (chamado.canReply) ...[
          const SizedBox(height: OrbitSpacing.md),
          TextField(
            key: const Key('portal.request.reply'),
            controller: _resposta,
            minLines: 2,
            maxLines: 6,
            maxLength: 4000,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              labelText: 'Escreva uma mensagem para a equipe',
              alignLabelWithHint: true,
            ),
          ),
          FilledButton.icon(
            onPressed: _enviando ? null : () => _responder(chamado),
            icon: const Icon(Icons.send),
            label: const Text('Enviar mensagem'),
          ),
        ],
        if (chamado.canEdit || chamado.canCancel) ...[
          const SizedBox(height: OrbitSpacing.lg),
          if (chamado.canEdit)
            OutlinedButton.icon(
              onPressed: _enviando ? null : () => _editar(chamado),
              icon: const Icon(Icons.edit_outlined),
              label: const Text('Editar chamado'),
            ),
          if (chamado.canCancel)
            TextButton.icon(
              onPressed: _enviando ? null : () => _cancelar(chamado),
              icon: Icon(Icons.cancel_outlined, color: palette.danger),
              label: Text(
                'Cancelar chamado',
                style: TextStyle(color: palette.danger),
              ),
            ),
          if (chamado.canEdit)
            Text(
              'Dá para editar até a equipe começar a analisar o chamado.',
              textAlign: TextAlign.center,
              style: OrbitType.caption.copyWith(color: palette.inkMuted),
            ),
        ],
      ],
    );
  }
}

/// A conversa do chamado: mensagens do cliente à direita, da equipe à
/// esquerda, e as mudanças de situação como marcos no meio.
class _Conversa extends StatelessWidget {
  const _Conversa({required this.eventos});

  final List<ServiceRequestEvent> eventos;

  static const _marcos = {
    'CREATED': 'Chamado aberto',
    'CANCELLED': 'Chamado cancelado',
    'CUSTOMER_UPDATED': 'Você atualizou o chamado',
    'ASSIGNED': 'Um responsável foi definido',
    'OPERATION_LINKED': 'Virou um atendimento agendado',
  };

  static const _situacoes = {
    'IN_TRIAGE': 'A equipe começou a analisar',
    'IN_PROGRESS': 'Em atendimento',
    'WAITING_CUSTOMER': 'Aguardando sua resposta',
    'RESOLVED': 'Chamado resolvido',
    'REJECTED': 'Chamado recusado',
    'CANCELLED': 'Chamado cancelado',
  };

  static String _marco(ServiceRequestEvent evento) =>
      _marcos[evento.type] ??
      _situacoes[evento.toStatus] ??
      'Situação atualizada';

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    if (eventos.isEmpty) {
      return const PortalNote(
        icon: Icons.chat_bubble_outline,
        text: 'Nenhuma mensagem ainda.',
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final evento in eventos)
          if (evento.message case final String texto)
            Align(
              alignment: evento.fromCustomer
                  ? Alignment.centerRight
                  : Alignment.centerLeft,
              child: Container(
                constraints: const BoxConstraints(maxWidth: 320),
                margin: const EdgeInsets.only(bottom: OrbitSpacing.sm),
                padding: const EdgeInsets.all(OrbitSpacing.ms),
                decoration: BoxDecoration(
                  color: evento.fromCustomer
                      ? palette.accentSoft
                      : palette.surface,
                  borderRadius: OrbitRadius.card,
                  boxShadow: evento.fromCustomer ? null : OrbitShadow.card,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      evento.fromCustomer ? 'Você' : evento.actorName,
                      style: OrbitType.label.copyWith(
                        color: evento.fromCustomer
                            ? palette.accentStrong
                            : palette.ink,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      texto,
                      style: OrbitType.body.copyWith(color: palette.ink),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      portalDateTime(evento.createdAt),
                      style: OrbitType.caption.copyWith(
                        color: palette.inkSubtle,
                      ),
                    ),
                  ],
                ),
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
              child: Row(
                children: [
                  Expanded(child: Divider(color: palette.border)),
                  Flexible(
                    flex: 3,
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: OrbitSpacing.sm,
                      ),
                      child: Text(
                        '${_marco(evento)} · ${portalDate(evento.createdAt)}',
                        textAlign: TextAlign.center,
                        style: OrbitType.caption.copyWith(
                          color: palette.inkSubtle,
                        ),
                      ),
                    ),
                  ),
                  Expanded(child: Divider(color: palette.border)),
                ],
              ),
            ),
      ],
    );
  }
}
