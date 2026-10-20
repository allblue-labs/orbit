/// Resolução da etiqueta de um equipamento.
///
/// ```text
/// GET /assets/qr/:token → o contexto de campo do equipamento
/// ```
///
/// **O token é chave de busca, nunca autorização.** Quem lê a etiqueta
/// continua sendo quem está logado: o servidor resolve o equipamento e devolve
/// `allowedActions` com base nas permissões da sessão, não na posse do papel
/// colado na máquina.
library;

import '../../../core/contracts/equipment_qr_contracts.dart';
import '../../../core/network/orbit_api_client.dart';

/// O token dentro do que a câmera leu.
///
/// A etiqueta carrega uma URL (`https://…/q/<token>`), mas nada impede que uma
/// etiqueta antiga, um teclado ou um leitor bluetooth entreguem o token puro.
/// Os dois casos chegam aqui, e o servidor só aceita 43 caracteres base64url —
/// então é isso que se procura, em vez de confiar no formato.
///
/// Devolve `null` quando o que foi lido não contém token nenhum: um QR de
/// outra coisa qualquer não deve virar uma requisição.
String? equipmentQrToken(String scanned) {
  final texto = scanned.trim();
  final padrao = RegExp(r'[A-Za-z0-9_-]{43}');

  /// Do fim para o começo: numa URL o token é o último segmento, e um host
  /// longo o bastante poderia casar antes dele.
  final candidatos = padrao.allMatches(texto).toList();
  if (candidatos.isEmpty) return null;
  final ultimo = candidatos.last.group(0)!;

  /// Um trecho de 43 caracteres recortado de um texto de 60 não é o token —
  /// é o meio de outra coisa. Só vale quando é o segmento inteiro.
  final limiteEsquerda = candidatos.last.start;
  final limiteDireita = candidatos.last.end;
  final antes = limiteEsquerda == 0 ? '' : texto[limiteEsquerda - 1];
  final depois = limiteDireita == texto.length ? '' : texto[limiteDireita];
  final delimitador = RegExp(r'^[/?#]?$');
  if (!delimitador.hasMatch(antes) || !delimitador.hasMatch(depois)) {
    return null;
  }
  return ultimo;
}

class EquipmentQrRepository {
  const EquipmentQrRepository({required OrbitApiClient client})
    : _client = client;

  final OrbitApiClient _client;

  Future<EquipmentQrResolvedContract> resolve(String token) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/assets/qr/${Uri.encodeComponent(token)}',
    );
    return EquipmentQrResolvedContract.fromJson(data);
  }
}
