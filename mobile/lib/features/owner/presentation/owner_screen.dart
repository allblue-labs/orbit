import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../documents/application/document_sharing.dart';
import '../../documents/application/documents_providers.dart';
import '../data/owner_repository.dart';
import 'owner_controls.dart';
import 'owner_customers.dart';
import 'owner_finance.dart';
import 'owner_operations.dart';
import 'owner_records.dart';
import 'owner_recurring.dart';
import 'owner_team.dart';
import 'owner_tools.dart';

class OwnerScreen extends ConsumerWidget {
  const OwnerScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final access = ref.watch(ownerAccessProvider);
    final repository = ref.watch(ownerRepositoryProvider);
    final zone = ref.watch(userTimezoneProvider);
    return Scaffold(
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
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => Center(
          child: Padding(
            padding: ownerPadding,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(ownerError(error), textAlign: TextAlign.center),
                TextButton(
                  onPressed: () => ref.invalidate(ownerAccessProvider),
                  child: const Text('Tentar novamente'),
                ),
              ],
            ),
          ),
        ),
        data: (grants) {
          if (session == null || grants.areas.isEmpty) {
            return const Center(
              child: Padding(
                padding: ownerPadding,
                child: Text(
                  'Seu perfil não tem acesso à Área do proprietário.',
                  textAlign: TextAlign.center,
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

  @override
  Widget build(BuildContext context) {
    final tools = widget.tools;
    final areas = tools.access.areas;
    final menu = [
      if (areas.contains('operations'))
        OwnerAction('Operações de hoje', Icons.today_outlined, () async {
          await ownerOpenRecords(context, ownerOperations(tools, today: true));
          return false;
        }),
      if (areas.contains('authorization') && tools.access.requiresAuthorization)
        OwnerAction(
          'Autorização de demandas',
          Icons.fact_check_outlined,
          () => openOwnerApprovals(context, tools),
        ),
      if (areas.contains('operations'))
        _section(
          context,
          'Operações e OS',
          Icons.assignment_outlined,
          ownerOperations(tools),
        ),
      if (areas.contains('quotes'))
        OwnerAction(
          'Novo orçamento',
          Icons.request_quote_outlined,
          () => ownerQuote(context, tools),
        ),
      if (areas.contains('receipts') && tools.unitId != null)
        _section(
          context,
          'Recibos',
          Icons.receipt_long_outlined,
          ownerReceipts(tools, widget.sharing),
        ),
      if (areas.contains('finance'))
        _section(
          context,
          'Entradas e saídas',
          Icons.account_balance_wallet_outlined,
          ownerFinance(tools),
        ),
      if (areas.contains('customers'))
        _section(
          context,
          'Clientes',
          Icons.people_outline,
          ownerCustomers(tools),
        ),
      if (areas.contains('equipment'))
        _section(
          context,
          'Equipamentos',
          Icons.handyman_outlined,
          ownerEquipment(tools),
        ),
      if (areas.contains('pmoc'))
        _section(
          context,
          'Planos de PMOC',
          Icons.event_repeat_outlined,
          ownerPmoc(tools),
        ),
      if (areas.contains('rvt'))
        _section(
          context,
          'Visitas técnicas (RVT)',
          Icons.event_note_outlined,
          ownerRvt(tools),
        ),
      if (areas.contains('team'))
        _section(
          context,
          'Equipe de campo',
          Icons.manage_accounts_outlined,
          ownerTeam(tools),
        ),
    ];
    return ListView(
      padding: ownerPadding,
      children: [
        if (tools.session.businessUnit case final unit?)
          Padding(
            padding: const EdgeInsets.only(bottom: OrbitSpacing.md),
            child: Text(
              unit.name,
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
        if (menu.isEmpty)
          const Padding(
            padding: ownerPadding,
            child: Text(
              'Nenhuma ação administrativa está disponível neste momento.',
            ),
          ),
        for (final item in menu)
          Card(
            margin: const EdgeInsets.only(bottom: OrbitSpacing.sm),
            child: ListTile(
              leading: Icon(item.icon),
              title: Text(item.label),
              trailing: const Icon(Icons.chevron_right),
              onTap: _opening
                  ? null
                  : () async {
                      setState(() => _opening = true);
                      try {
                        if (await item.run() && context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Registro salvo.'),
                              duration: Duration(seconds: 2),
                            ),
                          );
                        }
                      } catch (error) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text(ownerError(error))),
                          );
                        }
                      } finally {
                        if (mounted) setState(() => _opening = false);
                      }
                    },
            ),
          ),
      ],
    );
  }

  OwnerAction _section(
    BuildContext context,
    String label,
    IconData icon,
    OwnerRecords screen,
  ) => OwnerAction(label, icon, () async {
    await ownerOpenRecords(context, screen);
    return false;
  });
}
