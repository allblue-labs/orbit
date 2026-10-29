/// Monitor de conexão.
///
/// A fila de uploads precisa saber quando a rede volta para acordar sozinha.
/// A abstração existe para que a fila seja testável sem plugin.
///
/// Aviso honesto: ter interface de rede não garante alcançar o servidor. O
/// sinal serve para *tentar mais cedo*, não como prova de conectividade — a
/// confirmação continua sendo a resposta do backend.
library;

import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';

abstract interface class ConnectivityMonitor {
  /// `true` quando há alguma interface de rede ativa.
  Stream<bool> get onStatusChange;
  Future<bool> isOnline();
}

class PlatformConnectivityMonitor implements ConnectivityMonitor {
  PlatformConnectivityMonitor({Connectivity? connectivity})
    : _connectivity = connectivity ?? Connectivity();

  final Connectivity _connectivity;

  static bool _hasNetwork(List<ConnectivityResult> results) =>
      results.any((result) => result != ConnectivityResult.none);

  @override
  Stream<bool> get onStatusChange => _connectivity.onConnectivityChanged
      .distinct(
        (previous, next) =>
            previous.length == next.length &&
            previous.toSet().containsAll(next),
      )
      .map(_hasNetwork);

  @override
  Future<bool> isOnline() async =>
      _hasNetwork(await _connectivity.checkConnectivity());
}
