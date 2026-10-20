/// Quando tentar sincronizar.
///
/// Três gatilhos, e nenhum deles promete nada: voltar ao primeiro plano, a
/// rede reaparecer, e o toque manual. Não há sincronização contínua em
/// segundo plano — iOS e Android decidem quando um app suspenso executa, e
/// prometer isso na interface seria prometer o que o sistema operacional não
/// garante.
///
/// Ter rede **não** é ter internet: o callback de conectividade serve como
/// convite a tentar, e quem diz se dá para falar com o servidor é a resposta
/// da API.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../evidence/application/evidence_providers.dart';
import '../application/sync_providers.dart';

class SyncTriggers extends ConsumerStatefulWidget {
  const SyncTriggers({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<SyncTriggers> createState() => _SyncTriggersState();
}

class _SyncTriggersState extends ConsumerState<SyncTriggers>
    with WidgetsBindingObserver {
  StreamSubscription<bool>? _connectivity;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);

    /// A volta da rede é um convite a tentar. O orquestrador tem mutex e
    /// backoff próprios, então uma tempestade de eventos de conectividade
    /// coalesce numa sincronização só em vez de virar dez.
    _connectivity = ref.read(connectivityProvider).onStatusChange.listen((
      online,
    ) {
      if (online) unawaited(_sync());
    });

    WidgetsBinding.instance.addPostFrameCallback((_) => unawaited(_sync()));
  }

  @override
  void dispose() {
    _connectivity?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) unawaited(_sync());
  }

  /// Os dois orquestradores, no mesmo gatilho.
  ///
  /// Uma segunda engine de conectividade duplicaria o problema sem resolver
  /// nada: quem decide se dá para falar com o servidor é a resposta da API,
  /// e cada orquestrador já tem mutex e backoff próprios.
  Future<void> _sync() async {
    if (ref.read(commandScopeProvider) == null) return;
    await ref.read(syncControllerProvider.notifier).sync();
    await ref.read(mediaUploadControllerProvider.notifier).process();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
