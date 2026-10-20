/// Identidade do aparelho.
///
/// O envelope offline carrega `deviceInstanceId` para que o servidor saiba de
/// onde a intenção veio. É um identificador **do app**, gerado aleatoriamente
/// na primeira execução — não IMEI, não serial, não identificador de anúncio.
/// Esses são identificadores do aparelho e da pessoa que o carrega; para
/// distinguir instalações, um número aleatório serve igual e não vaza nada.
///
/// ## Reinstalar gera outro
///
/// O valor mora no armazenamento comum do app, então desinstalar e instalar de
/// novo produz um `deviceInstanceId` diferente. Isso é aceitável porque a
/// identidade do comando é o `commandId`: o device serve para diagnóstico e
/// telemetria, e a idempotência não depende dele. Uma fila pendente não
/// sobrevive à desinstalação de qualquer forma.
library;

import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

const _key = 'orbit.device.instance';

/// Lê ou cria o identificador desta instalação.
Future<String> deviceInstanceId(SharedPreferences preferences) async {
  final existing = preferences.getString(_key);
  if (existing != null && existing.isNotEmpty) return existing;

  final random = Random.secure();
  final value = List<int>.generate(
    16,
    (_) => random.nextInt(256),
  ).map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
  await preferences.setString(_key, value);
  return value;
}
