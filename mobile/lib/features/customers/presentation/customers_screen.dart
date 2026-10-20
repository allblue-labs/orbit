/// A carteira de clientes.
///
/// ## De onde a lista vem
///
/// De `/mobile/field/customers`, que projeta o **próprio trabalho** da pessoa
/// — não do CRM. A role "Técnico de Campo" não tem `customers.read`, e esta
/// aba fica sempre visível na barra inferior: montá-la sobre o cadastro
/// completo daria erro de permissão para a maioria dos usuários.
///
/// O efeito colateral é honesto: aparece quem a pessoa atende. Um cliente sem
/// nenhum atendimento dela não está aqui, e não deveria estar.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/contracts/mobile_field_contracts.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/design/orbit_screen_header.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../../field/application/field_providers.dart';
import '../../../app/providers.dart';
import 'customer_sheet.dart';
import 'new_customer_sheet.dart';

class CustomersScreen extends ConsumerStatefulWidget {
  const CustomersScreen({super.key});

  @override
  ConsumerState<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends ConsumerState<CustomersScreen> {
  final _busca = TextEditingController();
  Timer? _debounce;
  String _termo = '';

  @override
  void dispose() {
    _debounce?.cancel();
    _busca.dispose();
    super.dispose();
  }

  /// A busca vai ao **servidor**.
  ///
  /// A primeira versão filtrava no aparelho, o que exigia trazer a base
  /// inteira — e, como ela vinha derivada do trabalho da pessoa, mostrava 65
  /// de 498 clientes. Com a base paginada, procurar localmente encontraria
  /// só o que já tinha sido rolado.
  void _aoDigitar(String valor) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (mounted) {
        ref.read(customerSearchProvider.notifier).state = valor.trim();
        setState(() => _termo = valor.trim());
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final carteira = ref.watch(fieldCustomersProvider);
    final pagina = carteira.valueOrNull?.value;
    final visiveis = pagina?.data ?? const <MobileFieldCustomerContract>[];
    final dados = pagina?.data;

    /// O botão só existe para quem pode. Esconder não protege nada — o
    /// servidor recusa de qualquer jeito —, mas oferecer uma ação que sempre
    /// falha é pior que não oferecer.
    final podeCadastrar =
        ref.watch(sessionProvider)?.hasPermission('customers.create') ?? false;

    return Scaffold(
      backgroundColor: palette.background,
      floatingActionButton: podeCadastrar
          ? FloatingActionButton.extended(
              onPressed: () async {
                final criado = await showNewCustomerSheet(context);
                if (criado && context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('Cliente cadastrado.')),
                  );
                }
              },
              icon: const Icon(Icons.person_add_alt_1_rounded),
              label: const Text('Novo cliente'),
            )
          : null,
      body: Column(
        children: [
          _Cabecalho(
            controller: _busca,
            onChanged: _aoDigitar,
            total: visiveis.length,
            onLimpar: () {
              _busca.clear();
              _aoDigitar('');
            },
          ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async => ref.invalidate(fieldCustomersProvider),
              child: switch ((dados, carteira.hasError)) {
                (final List<MobileFieldCustomerContract> _, _)
                    when visiveis.isNotEmpty =>
                  ListView.separated(
                    padding: const EdgeInsets.fromLTRB(
                      OrbitSpacing.gutter,
                      OrbitSpacing.md,
                      OrbitSpacing.gutter,
                      OrbitSpacing.xl,
                    ),
                    itemCount: visiveis.length,
                    separatorBuilder: (_, _) =>
                        const SizedBox(height: OrbitSpacing.ms),
                    itemBuilder: (context, indice) => _LinhaDeCliente(
                      cliente: visiveis[indice],
                      onTap: () => showCustomerSheet(context, visiveis[indice]),
                    ),
                  ),
                (final List<MobileFieldCustomerContract> _, _) => ListView(
                  padding: const EdgeInsets.all(OrbitSpacing.gutter),
                  children: [
                    OrbitEmptyState(
                      icon: Icons.groups_outlined,
                      title: _termo.isEmpty
                          ? 'Nenhum cliente na sua carteira'
                          : 'Nenhum cliente encontrado',
                      description: _termo.isEmpty
                          ? 'Os clientes que você atende aparecem aqui.'
                          : 'Nenhum nome contém "$_termo".',
                    ),
                  ],
                ),
                (_, true) => ListView(
                  padding: const EdgeInsets.all(OrbitSpacing.gutter),
                  children: [
                    SectionError(
                      error: carteira.error!,
                      onRetry: () => ref.invalidate(fieldCustomersProvider),
                    ),
                  ],
                ),
                _ => const Padding(
                  padding: EdgeInsets.all(OrbitSpacing.gutter),
                  child: SectionLoading(lines: 6),
                ),
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _Cabecalho extends StatelessWidget {
  const _Cabecalho({
    required this.controller,
    required this.onChanged,
    required this.total,
    required this.onLimpar,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final int total;
  final VoidCallback onLimpar;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Container(
      decoration: BoxDecoration(
        color: palette.surface,
        boxShadow: OrbitShadow.card,
      ),
      child: SafeArea(
        bottom: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                OrbitSpacing.gutter,
                OrbitSpacing.sm,
                OrbitSpacing.gutter,
                OrbitSpacing.ms,
              ),
              child: OrbitScreenHeading(
                title: 'Clientes',
                count: total == 1 ? '1 cliente' : '$total clientes',
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                OrbitSpacing.gutter,
                0,
                OrbitSpacing.gutter,
                OrbitSpacing.md,
              ),
              child: TextField(
                controller: controller,
                onChanged: onChanged,
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  hintText: 'Buscar cliente',
                  prefixIcon: const Icon(Icons.search_rounded, size: 20),
                  suffixIcon: controller.text.isEmpty
                      ? null
                      : IconButton(
                          icon: const Icon(Icons.close_rounded, size: 18),
                          tooltip: 'Limpar busca',
                          onPressed: onLimpar,
                        ),
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: OrbitSpacing.md,
                    vertical: OrbitSpacing.ms,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Um retângulo de largura cheia, com a seta à direita.
class _LinhaDeCliente extends StatelessWidget {
  const _LinhaDeCliente({required this.cliente, required this.onTap});

  final MobileFieldCustomerContract cliente;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;

    /// O resumo é o que decide o toque: quanto há em aberto e quanto já foi
    /// feito. Sem nada disso, a linha seria só um nome.
    final resumo = [
      if (cliente.openCount > 0)
        '${cliente.openCount} em aberto'
      else
        'Nada em aberto',
      if (cliente.completedCount > 0)
        '${cliente.completedCount} concluído'
            '${cliente.completedCount == 1 ? "" : "s"}',
    ].join(' · ');

    return Semantics(
      button: true,
      label: '${cliente.name}, $resumo',
      excludeSemantics: true,
      child: OrbitCard(
        onTap: onTap,
        padding: const EdgeInsets.symmetric(
          horizontal: OrbitSpacing.ml,
          vertical: OrbitSpacing.md,
        ),
        child: Row(
          children: [
            _Medalhao(nome: cliente.name, ativo: cliente.openCount > 0),
            const SizedBox(width: OrbitSpacing.ms),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    cliente.name,
                    style: OrbitType.itemTitle.copyWith(color: palette.ink),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 3),
                  Text(
                    resumo,
                    style: OrbitType.caption.copyWith(
                      color: cliente.openCount > 0
                          ? palette.accentStrong
                          : palette.inkSubtle,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const SizedBox(width: OrbitSpacing.sm),
            Icon(
              Icons.chevron_right_rounded,
              size: 22,
              color: palette.inkDisabled,
            ),
          ],
        ),
      ),
    );
  }
}

class _Medalhao extends StatelessWidget {
  const _Medalhao({required this.nome, required this.ativo});

  final String nome;
  final bool ativo;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final partes = nome
        .trim()
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .toList();
    final iniciais = partes.isEmpty
        ? '?'
        : partes.length == 1
        ? partes.first.characters.first.toUpperCase()
        : (partes.first.characters.first + partes[1].characters.first)
              .toUpperCase();

    return Container(
      width: 42,
      height: 42,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: ativo ? palette.accentSoft : palette.surfaceMuted,
        borderRadius: OrbitRadius.chip,
      ),
      child: Text(
        iniciais,
        style: OrbitType.label.copyWith(
          fontSize: 14,
          color: ativo ? palette.accentStrong : palette.inkSubtle,
        ),
      ),
    );
  }
}
