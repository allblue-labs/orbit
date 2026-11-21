/// A área do cliente: três páginas e o perfil.
///
/// Nada da equipe aparece aqui — nem fila, nem agenda, nem atalhos de gestão.
/// O cliente não tem como chegar a uma rota da equipe: o roteador o mantém
/// dentro de `/cliente`, e o servidor recusa o token dele em qualquer rota
/// interna.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/theme/orbit_theme.dart';
import '../application/portal_session.dart';
import 'portal_pages.dart';
import 'portal_profile.dart';

class PortalShellScreen extends ConsumerStatefulWidget {
  const PortalShellScreen({super.key});

  @override
  ConsumerState<PortalShellScreen> createState() => _PortalShellScreenState();
}

class _PortalShellScreenState extends ConsumerState<PortalShellScreen> {
  int _pagina = 0;

  static const _titulos = ['Início', 'Equipamentos', 'Documentos'];

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final me = ref.watch(portalMeProvider);
    return Scaffold(
      backgroundColor: palette.background,
      appBar: AppBar(
        titleSpacing: OrbitSpacing.gutter,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_titulos[_pagina], style: OrbitType.sectionTitle),
            if (me != null)
              Text(
                me.customerName,
                style: OrbitType.caption.copyWith(color: palette.inkMuted),
              ),
          ],
        ),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: OrbitSpacing.sm),
            child: IconButton(
              tooltip: 'Seu perfil',
              onPressed: () => showPortalProfileSheet(context),
              icon: const PortalAvatar(),
            ),
          ),
        ],
      ),
      body: IndexedStack(
        index: _pagina,
        children: [
          PortalHomePage(onOpenTab: (tab) => setState(() => _pagina = tab)),
          const PortalEquipmentPage(),
          const PortalDocumentsPage(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _pagina,
        onDestinationSelected: (indice) => setState(() => _pagina = indice),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Início',
          ),
          NavigationDestination(
            icon: Icon(Icons.ac_unit_outlined),
            selectedIcon: Icon(Icons.ac_unit),
            label: 'Equipamentos',
          ),
          NavigationDestination(
            icon: Icon(Icons.description_outlined),
            selectedIcon: Icon(Icons.description),
            label: 'Documentos',
          ),
        ],
      ),
    );
  }
}
