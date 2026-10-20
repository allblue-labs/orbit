/// Senha temporária, contra o backend real.
///
/// O dono cadastra um técnico e entrega uma senha provisória. Enquanto ela
/// valer, o aplicativo tem de prender a pessoa na troca: o dono ainda conhece
/// essa senha, e nada do trabalho de campo — atendimento, evidência,
/// assinatura — pode acontecer em nome de alguém cuja credencial outra pessoa
/// sabe.
///
/// O relato que originou este teste é que o aplicativo **entrou direto**. O
/// teste reproduz o caminho inteiro pelo repositório real, sem duplo: criar o
/// técnico, entrar com a senha provisória e conferir o que a sessão carrega.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/storage/token_storage.dart';
import 'package:orbit_operator/features/authentication/data/auth_repository.dart';

const _baseUrl = String.fromEnvironment(
  'ORBIT_API_URL',
  defaultValue: 'http://localhost:6001/api/v1',
);
const _email = String.fromEnvironment(
  'ORBIT_OWNER_EMAIL',
  defaultValue: 'owner@orbit.local',
);
const _password = String.fromEnvironment(
  'ORBIT_OWNER_PASSWORD',
  defaultValue: 'OrbitOwner@2026',
);

class _MemoryTokenStorage implements TokenStorage {
  TokenPair? _pair;
  @override
  Future<void> clear() async => _pair = null;
  @override
  Future<TokenPair?> read() async => _pair;
  @override
  Future<void> write(TokenPair pair) async => _pair = pair;
}

Future<bool> _apiIsUp() async {
  try {
    final uri = Uri.parse(_baseUrl);
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

void main() {
  late bool available;

  setUpAll(() async {
    available = await _apiIsUp();
  });

  OrbitApiClient novoCliente(TokenStorage storage) => OrbitApiClient.create(
    environment: OrbitEnvironment(
      apiBaseUrl: _baseUrl,
      flavor: OrbitFlavor.development,
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 20),
    ),
    storage: storage,
    logger: const OrbitLogger(isProduction: false),
  );

  test(
    'a senha temporária chega ao aplicativo como troca obrigatória',
    () async {
      if (!available) {
        markTestSkipped('API indisponível em $_baseUrl');
        return;
      }

      /* O dono, para cadastrar o técnico. */
      final donoStorage = _MemoryTokenStorage();
      final dono = novoCliente(donoStorage);
      final entrada = await dono.post<Map<String, dynamic>>(
        '/identity/login',
        body: {'email': _email, 'password': _password},
        isPublic: true,
      );
      await donoStorage.write(TokenPair.fromJson(entrada));

      /* O envelope já vem desembrulhado pelo cliente: `data` é a lista. */
      final papeis = await dono.get<List<dynamic>>(
        '/organizations/current/roles',
      );
      final lista = papeis.cast<Map<String, dynamic>>();
      final tecnico = lista.firstWhere((p) => p['key'] == 'FIELD_TECHNICIAN');

      final sufixo = DateTime.now().microsecondsSinceEpoch.toString();
      final emailTecnico = 'smoke.senha.$sufixo@orbit.local';
      final criado = await dono.post<Map<String, dynamic>>(
        '/organizations/current/team/members',
        body: {
          'firstName': 'Smoke',
          'lastName': 'Senha',
          'email': emailTecnico,
          'roleId': tecnico['id'],
        },
      );
      final temporaria = criado['temporaryPassword'] as String?;
      expect(
        temporaria,
        isNotNull,
        reason: 'o cadastro precisa devolver a senha provisória uma vez',
      );

      /* O técnico, pelo repositório que o aplicativo usa de verdade. */
      final tecnicoStorage = _MemoryTokenStorage();
      final repositorio = AuthRepository(
        client: novoCliente(tecnicoStorage),
        storage: tecnicoStorage,
      );
      await repositorio.login(email: emailTecnico, password: temporaria!);

      final perfil = await repositorio.loadProfile();
      expect(
        perfil.mustChangePassword,
        isTrue,
        reason:
            'o roteador prende na troca por este campo; falso aqui significa '
            'que o técnico entra direto com a senha que o dono escolheu',
      );
    },
  );
}
