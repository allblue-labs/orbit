/// Shell de navegação.
///
/// ## Cinco destinos, na ordem do dia
///
/// ```text
/// Início · Atendimentos · Clientes · Documentos · Perfil
/// ```
///
/// Documentos é o mais novo. A tela existia e a rota também, mas só se
/// chegava nela pelo atalho da tela inicial — e um destino que depende de
/// voltar para o início não é destino. "Cadê a OS de ontem?" é pergunta de
/// todo dia.
///
/// Agenda **não** está aqui: ela é alcançada pelo atalho da tela inicial, e
/// competir com Documentos por um dos cinco lugares custaria mais do que
/// rende — compromisso se olha uma vez pela manhã, documento se procura a
/// qualquer hora.
///
/// A aba de trabalho passou a se chamar **Atendimentos** — o que a pessoa
/// chama do que faz. "Trabalho" descrevia a estrutura de dados (a fila de itens
/// de campo), não a coisa.
///
/// Every authorized mobile profile gets the same information architecture.
library;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/sync/presentation/widgets/sync_status_bar.dart';
import '../widgets/sync_indicator.dart';
import '../design/orbit_operational.dart';
import 'orbit_router.dart';

class AppShell extends StatelessWidget {
  const AppShell({super.key, required this.location, required this.child});

  final String location;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    const destinations = orbitShellDestinations;

    /// O destino mais específico vence.
    ///
    /// `/perfil/sincronizacao` começa com `/perfil`, e um `indexWhere` simples
    /// acertaria por acaso enquanto os prefixos não colidissem. Comparar pelo
    /// comprimento da rota casada torna a escolha independente da ordem em que
    /// as abas foram declaradas.
    var index = -1;
    var casado = 0;
    for (final (posicao, destino) in destinations.indexed) {
      if (location.startsWith(destino.route) && destino.route.length > casado) {
        index = posicao;
        casado = destino.route.length;
      }
    }

    return Scaffold(
      body: child,
      bottomNavigationBar: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Estado da fila de evidências, sempre visível durante o trabalho.
          const SyncStatusBar(),
          const SyncIndicator(),
          OrbitBottomNav(
            selected: index < 0 ? 0 : index,
            onSelect: (selected) => context.go(destinations[selected].route),
            items: [
              for (final d in destinations)
                (
                  label: d.navLabel,
                  fullLabel: d.label,
                  icon: d.icon,
                  selectedIcon: d.selectedIcon,
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Um destino da barra inferior.
///
/// Público porque a captura de tela precisa das **mesmas** abas que o produto
/// usa. Enquanto elas viviam copiadas no teste, a imagem mostrava uma
/// navegação que já não existia — e foi assim que uma aba trocada passou
/// despercebida.
class ShellDestination {
  const ShellDestination({
    required this.route,
    required this.label,
    required this.icon,
    required this.selectedIcon,
    String? shortLabel,
  }) : _shortLabel = shortLabel;

  final String route;
  final String label;
  final IconData icon;
  final IconData selectedIcon;
  final String? _shortLabel;

  /// O rótulo que cabe na barra.
  ///
  /// Abreviação escrita à mão, e não reticência: "Atend." é uma palavra que
  /// se lê, "Atendim…" é um corte. Cinco abas em 390 pixels dão 78 pixels
  /// cada, e nenhum rótulo inteiro cabe.
  String get navLabel => _shortLabel ?? label;
}

/// As abas do produto. Uma fonte só, usada pelo shell e pela captura.
const orbitShellDestinations = <ShellDestination>[
  ShellDestination(
    route: OrbitRoutes.home,
    label: 'Início',
    icon: Icons.home_outlined,
    selectedIcon: Icons.home_rounded,
  ),
  ShellDestination(
    route: OrbitRoutes.workQueue,
    label: 'Atendimentos',
    shortLabel: 'Atend.',
    icon: Icons.assignment_outlined,
    selectedIcon: Icons.assignment_rounded,
  ),
  ShellDestination(
    route: OrbitRoutes.customers,
    label: 'Clientes',
    icon: Icons.groups_outlined,
    selectedIcon: Icons.groups_rounded,
  ),
  ShellDestination(
    route: OrbitRoutes.documents,
    label: 'Documentos',

    /// "Docs" é palavra que se lê; "Documen…" é corte.
    shortLabel: 'Docs',
    icon: Icons.folder_outlined,
    selectedIcon: Icons.folder_rounded,
  ),
  ShellDestination(
    route: OrbitRoutes.profile,
    label: 'Perfil',
    icon: Icons.person_outline_rounded,
    selectedIcon: Icons.person_rounded,
  ),
];
