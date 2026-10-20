/// O registro desta instalação no servidor.
///
/// ```text
/// POST   /mobile/devices                      registra ou rotaciona o token
/// DELETE /mobile/devices/:deviceInstanceId    desfaz no logout
/// ```
///
/// ## Por que o logout desfaz
///
/// O token é do **aparelho**; o vínculo é da pessoa. Sem revogar, quem sair
/// da conta continua recebendo no celular os avisos de trabalho de quem
/// entrou depois — inclusive nome de cliente e endereço na tela de bloqueio.
library;

import '../../../core/contracts/mobile_push_device_contracts.dart';
import '../../../core/network/orbit_api_client.dart';

class MobileDeviceRepository {
  const MobileDeviceRepository({required OrbitApiClient client})
    : _client = client;

  final OrbitApiClient _client;

  Future<void> register(RegisterMobileDeviceRequest request) =>
      _client.post<Object?>('/mobile/devices', body: request.toJson());

  Future<void> revoke(String deviceInstanceId) =>
      _client.delete<Object?>('/mobile/devices/$deviceInstanceId');
}
