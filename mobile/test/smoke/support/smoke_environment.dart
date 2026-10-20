/// Onde os smokes podem criar dados.
///
/// Provisionar cenário é escrever no banco de alguém. O guard existe para que
/// isso só aconteça onde é seguro — e para **falhar** quando não houver certeza,
/// em vez de tentar e descobrir depois.
library;

import 'dart:io';

const smokeApiUrl = String.fromEnvironment(
  'ORBIT_API_URL',
  defaultValue: 'http://localhost:6001/api/v1',
);
const smokeEmail = String.fromEnvironment(
  'ORBIT_OWNER_EMAIL',
  defaultValue: 'owner@orbit.local',
);
const smokePassword = String.fromEnvironment(
  'ORBIT_OWNER_PASSWORD',
  defaultValue: 'OrbitOwner@2026',
);

/// Declaração explícita do ambiente.
///
/// É a **configuração** que autoriza, não o endereço: um túnel para produção
/// também responde em `localhost`, e deduzir ambiente pelo hostname é como se
/// escreve num banco que não era para tocar.
const smokeEnvironmentName = String.fromEnvironment(
  'ORBIT_SMOKE_ENV',
  defaultValue: 'development',
);

const _allowedEnvironments = {'development', 'test'};

/// Loopback, como segunda barreira independente.
///
/// Não substitui a declaração acima — soma-se a ela. Uma das duas errada já
/// impede a escrita.
bool _isLoopback(String url) {
  final host = Uri.tryParse(url)?.host ?? '';
  return host == 'localhost' ||
      host == '127.0.0.1' ||
      host == '::1' ||
      host == '10.0.2.2';
}

class SmokeEnvironmentDenied implements Exception {
  const SmokeEnvironmentDenied(this.reason);
  final String reason;

  @override
  String toString() => 'Provisionamento bloqueado: $reason';
}

/// Autoriza a criação de dados, ou explica por que não.
///
/// Falha fechada: qualquer dúvida bloqueia.
void assertProvisioningAllowed() {
  if (!_allowedEnvironments.contains(smokeEnvironmentName)) {
    throw SmokeEnvironmentDenied(
      'ORBIT_SMOKE_ENV="$smokeEnvironmentName" não é um ambiente de teste. '
      'Ambientes permitidos: ${_allowedEnvironments.join(', ')}.',
    );
  }
  if (!_isLoopback(smokeApiUrl)) {
    throw const SmokeEnvironmentDenied(
      'a API não está em loopback. Provisionar cenário só é permitido contra '
      'um backend local de desenvolvimento.',
    );
  }
}

/// A API está de pé?
Future<bool> smokeApiIsUp() async {
  try {
    final uri = Uri.parse(smokeApiUrl);
    final socket = await Socket.connect(
      uri.host,
      uri.port,
      timeout: const Duration(seconds: 2),
    );
    socket.destroy();
    return true;
  } on Object {
    return false;
  }
}
