import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../../documents/application/document_sharing.dart';
import '../../documents/application/documents_providers.dart';
import '../data/owner_repository.dart';
import 'owner_controls.dart';
import 'owner_customers.dart';
import 'owner_finance.dart';
import 'owner_operations.dart';
import 'owner_records.dart';
import 'owner_recurring.dart';
import 'owner_sales.dart';
import 'owner_style.dart';
import 'owner_team.dart';
import 'owner_tools.dart';

/// A Área do proprietário: o que o owner e o administrador resolvem do
/// celular, agrupado pelo assunto — o dia, os atendimentos, o dinheiro, os
/// cadastros e a equipe. Cada área só aparece quando o servidor a libera.
class OwnerScreen extends ConsumerWidget {
  const OwnerScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final access = ref.watch(ownerAccessProvider);
    final repository = ref.watch(ownerRepositoryProvider);
    final zone = ref.watch(userTimezoneProvider);
    return Scaffold(
      backgroundColor: context.orbit.background,
      appBar: AppBar(
        title: const Text('Área do proprietário'),
        actions: [
          IconButton(
            onPressed: () => ref.invalidate(ownerAccessProvider),
            icon: const Icon(Icons.refresh),
            tooltip: 'Atualizar acesso',
          ),
        ],
      ),
      body: access.when(
        skipLoadingOnRefresh: false,
        loading: () => const Padding(
          padding: ownerPadding,
          child: SectionLoading(lines: 6),
        ),
        error: (error, _) => Center(
          child: SingleChildScrollView(
            child: OrbitEmptyState(
              icon: Icons.cloud_off_outlined,
              title: ownerError(error),
              action: OutlinedButton.icon(
                onPressed: () => ref.invalidate(ownerAccessProvider),
                icon: const Icon(Icons.refresh),
                label: const Text('Tentar novamente'),
              ),
            ),
          ),
        ),
        data: (grants) {
          if (session == null || grants.areas.isEmpty) {
            return const Center(
              child: SingleChildScrollView(
                child: OrbitEmptyState(
                  icon: Icons.lock_outline,
                  title: 'Sem acesso à Área do proprietário',
                  description:
                      'Ela é do proprietário e de quem administra a empresa.',
                ),
              ),
            );
          }
          return _OwnerMenu(
            sharing: ref.watch(documentSharingProvider),
            tools: OwnerTools(repository, session, grants, zone),
          );
        },
      ),
    );
  }
}

class _OwnerMenu extends StatefulWidget {
  const _OwnerMenu({required this.tools, required this.sharing});
  final DocumentSharing sharing;
  final OwnerTools tools;

  @override
  State<_OwnerMenu> createState() => _OwnerMenuState();
}

class _OwnerMenuState extends State<_OwnerMenu> {
  bool _opening = false;

  Future<void> _run(OwnerAction item) async {
    if (_opening) return;
    setState(() => _opening = true);
    try {
      if (await item.run() && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Registro salvo.'),
            duration: Duration(seconds: 2),
          ),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(ownerError(error))));
      }
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final tools = widget.tools;
    final areas = tools.access.areas;
    final groups = <(String, List<OwnerAction>)>[
      (
        'Hoje',
        [
          if (areas.contains('operations'))
            OwnerAction(
              'Operações de hoje',
              Icons.today_outlined,
              description: 'O que está agendado para hoje',
              () async {
                await ownerOpenRecords(
                  context,
                  ownerOperations(tools, today: true),
                );
                return false;
              },
            ),
          if (areas.contains('authorization') &&
              tools.access.requiresAuthorization)
            OwnerAction(
              'Autorização de demandas',
              Icons.fact_check_outlined,
              description: 'Liberar ou bloquear o trabalho da equipe',
              () => openOwnerApprovals(context, tools),
            ),
        ],
      ),
      (
        'Atendimentos',
        [
          if (areas.contains('operations'))
            _section(
              context,
              'Operações e OS',
              Icons.assignment_outlined,
              'Criar, reagendar e atribuir',
              ownerOperations(tools),
            ),
          if (areas.contains('pmoc'))
            _section(
              context,
              'Planos de PMOC',
              Icons.event_repeat_outlined,
              'Planos, ciclos e execuções',
              ownerPmoc(tools),
            ),
          if (areas.contains('rvt'))
            _section(
              context,
              'Visitas técnicas (RVT)',
              Icons.event_note_outlined,
              'Contratos de visita e agenda',
              ownerRvt(tools),
            ),
        ],
      ),
      (
        'Comercial e financeiro',
        [
          if (areas.contains('quotes'))
            OwnerAction(
              'Novo orçamento',
              Icons.request_quote_outlined,
              description: 'Montar e enviar ao cliente',
              () => ownerQuote(context, tools),
            ),
          if (areas.contains('sales') && tools.unitId != null)
            _section(
              context,
              'Vendas',
              Icons.point_of_sale_outlined,
              'Venda de balcão com recibo',
              ownerSales(tools, widget.sharing),
            ),
          if (areas.contains('receipts') && tools.unitId != null)
            _section(
              context,
              'Recibos',
              Icons.receipt_long_outlined,
              'Emitir e compartilhar recibos',
              ownerReceipts(tools, widget.sharing),
            ),
          if (areas.contains('finance'))
            _section(
              context,
              'Entradas e saídas',
              Icons.account_balance_wallet_outlined,
              'Lançamentos da unidade',
              ownerFinance(tools),
            ),
        ],
      ),
      (
        'Cadastros',
        [
          if (areas.contains('customers'))
            _section(
              context,
              'Clientes',
              Icons.people_outline,
              'Dados, endereços e equipamentos',
              ownerCustomers(tools),
            ),
          if (areas.contains('equipment'))
            _section(
              context,
              'Equipamentos',
              Icons.handyman_outlined,
              'O parque de cada cliente',
              ownerEquipment(tools),
            ),
        ],
      ),
      (
        'Equipe',
        [
          if (areas.contains('team'))
            _section(
              context,
              'Equipe de campo',
              Icons.manage_accounts_outlined,
              'Técnicos, acessos e permissões',
              ownerTeam(tools),
            ),
        ],
      ),
    ].where((group) => group.$2.isNotEmpty).toList();

    final unit = tools.session.businessUnit;
    return ListView(
      padding: ownerPadding,
      children: [
        OwnerSurface(
          child: Row(
            children: [
              const OwnerIconTile(
                icon: Icons.admin_panel_settings_outlined,
                size: 48,
              ),
              const SizedBox(width: OrbitSpacing.ms),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      (tools.session.isOwner ? 'Proprietário' : 'Administração')
                          .toUpperCase(),
                      style: OrbitType.eyebrow.copyWith(
                        color: palette.inkSubtle,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      unit?.name ??
                          tools.session.organization?.displayName ??
                          'Sua empresa',
                      style: OrbitType.sectionTitle.copyWith(
                        color: palette.ink,
                      ),
                    ),
                    if (unit == null)
                      Text(
                        'Escolha uma unidade para vender e emitir recibos.',
                        style: OrbitType.caption.copyWith(
                          color: palette.inkMuted,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (groups.isEmpty) ...[
          const SizedBox(height: OrbitSpacing.lg),
          const OwnerNote(
            icon: Icons.lock_outline,
            text: 'Nenhuma ação administrativa está disponível neste momento.',
          ),
        ],
        for (final (titulo, itens) in groups) ...[
          const SizedBox(height: OrbitSpacing.lg),
          OwnerGroupLabel(titulo),
          OwnerTileGroup(
            children: [
              for (final item in itens)
                OwnerTile(
                  icon: item.icon,
                  label: item.label,
                  description: item.description,
                  onTap: _opening ? null : () => _run(item),
                ),
            ],
          ),
        ],
        const SizedBox(height: OrbitSpacing.lg),
      ],
    );
  }

  OwnerAction _section(
    BuildContext context,
    String label,
    IconData icon,
    String description,
    OwnerRecords screen,
  ) => OwnerAction(label, icon, description: description, () async {
    await ownerOpenRecords(context, screen);
    return false;
  });
}
