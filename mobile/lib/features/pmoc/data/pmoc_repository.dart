/// O atendimento de um equipamento de PMOC.
///
/// ```text
/// GET  /pmoc/plans?status=ACTIVE
/// GET  /pmoc/plans/:planId
/// GET  /pmoc/plans/:planId/cycles/:cycleId/equipment-executions
/// GET  /pmoc/plans/:planId/cycles/:cycleId/equipment/:assetId/execution-preparation
/// POST /pmoc/plans/:planId/cycles/:cycleId/equipment/:assetId/executions/mine
/// POST /pmoc/plans/:planId/cycles/:cycleId/equipment-executions/:id/complete/mine
/// POST /pmoc/equipment-executions/:id/artifact/generate/mine
/// GET  /artifact-executions/:id/manifests
/// GET  /artifact-manifests/:id/download
/// ```
///
/// ## Por que o documento vem de outras duas rotas
///
/// O PMOC não produz um artefato de campo: produz uma **execução de artefato**,
/// com o modelo premium e as revisões dele. O fluxo documental do aplicativo
/// (`/mobile/field/artifacts/...`) recusa preparar PMOC de propósito — o
/// snapshot é do módulo de PMOC, e duplicá-lo aqui faria dois documentos
/// divergentes para a mesma manutenção.
///
/// O arquivo, então, se busca onde ele mora: a revisão emitida da execução, e a
/// URL assinada dela. Duas rotas que o papel de campo já pode ler
/// (`artifact_manifests.read`).
///
/// ## Por que as três escritas terminam em `mine`
///
/// São duas autoridades sobre as mesmas escritas. As portas sem `mine` exigem
/// `pmoc.manage` — gerenciar o contrato — e aceitam escalar quem o chamador
/// quiser: é o dono organizando o trabalho pela web. As portas `mine` exigem
/// `pmoc.execute`, agem sobre o **próprio** ator e só onde a execução é dele: é
/// o técnico que chegou ao local.
///
/// O aplicativo de campo usa as segundas. Usar as primeiras daria 403 para todo
/// técnico, porque o papel de campo não tem — nem deve ter — `pmoc.manage`. O
/// dono passa pelas duas, porque a permissão dele é curto-circuito.
///
/// ## Sem journal, por ora
///
/// A execução de atendimento avulso passa pelo journal de comandos e funciona
/// sem rede. O PMOC **não**: o vocabulário offline é todo de operação
/// (`OPERATION_START`, `OPERATION_COMPLETE`…) e o servidor recusa o que não
/// conhece. Reaproveitar `OPERATION_COMPLETE` não serve — a execução de PMOC tem
/// uma ordem de serviço 1:1, mas concluir a ordem **não** conclui a execução,
/// que rola o ciclo, abre o seguinte e atualiza o vencimento do plano; os dois
/// ficariam em estados divergentes.
///
/// Então aqui é rede direta, e a tela diz quando falta conexão em vez de
/// prometer que guardou. Levar o PMOC ao protocolo offline é peça própria.
library;

import '../../../core/contracts/mobile_field_artifact_contracts.dart';
import '../../../core/contracts/pmoc_contracts.dart';
import '../../../core/network/orbit_api_client.dart';

class PmocRepository {
  const PmocRepository({required OrbitApiClient client}) : _client = client;

  final OrbitApiClient _client;

  String _plan(String planId) => '/pmoc/plans/${Uri.encodeComponent(planId)}';

  String _cycle(String planId, String cycleId) =>
      '${_plan(planId)}/cycles/${Uri.encodeComponent(cycleId)}';

  /// Os planos configurados, para quem vai escolher o que atender.
  ///
  /// Só os ativos: plano em rascunho, suspenso ou encerrado não se atende, e
  /// oferecê-lo na lista seria convidar para uma recusa.
  Future<List<PmocPlanSummaryContract>> plans({
    int page = 1,
    int limit = 20,
    String? search,
  }) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/pmoc/plans',
      query: {
        'status': 'ACTIVE',
        'page': page,
        'limit': limit,
        if (search != null && search.trim().isNotEmpty) 'search': search.trim(),
      },
    );
    final rows = data['data'] as List<dynamic>? ?? const [];
    return rows
        .whereType<PmocJson>()
        .map(PmocPlanSummaryContract.fromJson)
        .toList(growable: false);
  }

  /// O plano, com o ciclo aberto dentro.
  ///
  /// Uma requisição, e não plano + lista de ciclos: `currentExecution` já é o
  /// ciclo em aberto, e é dele que o atendimento parte. Aqui também vem a
  /// atribuição do plano — o que decide se este técnico pode atender.
  Future<PmocPlanDetailContract> plan(String planId) async {
    final data = await _client.get<Map<String, dynamic>>(_plan(planId));
    return PmocPlanDetailContract.fromJson(data);
  }

  /// Os equipamentos do ciclo, com o que cada um permite agora.
  ///
  /// `eligibility` vem do servidor por equipamento — é a **mesma** função que a
  /// preparação usa. Sem ela, escolher o que atender exigiria pedir a preparação
  /// de cada aparelho: vinte requisições para desenhar vinte linhas.
  Future<List<PmocCycleEquipmentContract>> cycleEquipment({
    required String planId,
    required String cycleId,
  }) async {
    final data = await _client.get<List<dynamic>>(
      '${_cycle(planId, cycleId)}/equipment-executions',
    );
    return data
        .whereType<PmocJson>()
        .map(PmocCycleEquipmentContract.fromJson)
        .toList(growable: false);
  }

  /// O contexto do atendimento.
  ///
  /// **Leitura pura.** Abrir não inicia nada: é um `GET`, e é dele que saem
  /// `eligibility` e `allowedActions` — as duas respostas que decidem o que a
  /// tela oferece.
  Future<PmocExecutionPreparationContract> preparation({
    required String planId,
    required String cycleId,
    required String assetId,
  }) async {
    final data = await _client.get<Map<String, dynamic>>(
      '${_cycle(planId, cycleId)}/equipment/${Uri.encodeComponent(assetId)}'
      '/execution-preparation',
    );
    return PmocExecutionPreparationContract.fromJson(data);
  }

  /// Abre o atendimento **deste** técnico.
  ///
  /// O servidor escala o próprio ator e recusa quando o plano não lhe foi
  /// atribuído. Não há corpo: quem atende é quem pede.
  Future<PmocEquipmentExecutionContract> startMine({
    required String planId,
    required String cycleId,
    required String assetId,
  }) async {
    final data = await _client.post<Map<String, dynamic>>(
      '${_cycle(planId, cycleId)}/equipment/${Uri.encodeComponent(assetId)}'
      '/executions/mine',
    );
    return PmocEquipmentExecutionContract.fromJson(
      data['execution'] as Map<String, dynamic>? ?? data,
    );
  }

  /// Conclui o atendimento deste equipamento.
  ///
  /// O ciclo fecha sozinho quando todos os equipamentos dele estiverem
  /// resolvidos — não há passo separado para isso, e `cycleCompleted` diz se
  /// aconteceu agora.
  ///
  /// `performedAt` ausente vale **agora**, pelo relógio do servidor: a hora da
  /// manutenção é registro legal, e o relógio do aparelho pode estar errado.
  Future<PmocCompletionContract> complete({
    required String planId,
    required String cycleId,
    required String executionId,
    DateTime? performedAt,
    String? notes,
  }) async {
    final data = await _client.post<Map<String, dynamic>>(
      '${_cycle(planId, cycleId)}'
      '/equipment-executions/${Uri.encodeComponent(executionId)}/complete/mine',
      body: <String, Object?>{
        if (performedAt != null)
          'performedAt': performedAt.toUtc().toIso8601String(),
        if (notes != null && notes.trim().isNotEmpty) 'notes': notes.trim(),
      },
    );
    return PmocCompletionContract.fromJson(data);
  }

  /// As revisões emitidas do documento desta execução de artefato.
  ///
  /// A emissão é assíncrona: o `POST` de gerar pede a renderização e volta na
  /// hora, com o arquivo ainda por vir. A lista vazia — ou sem revisão emitida —
  /// é o estado normal dos primeiros segundos, não uma falha.
  Future<List<PmocDocumentRevisionContract>> documentRevisions(
    String artifactExecutionId,
  ) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/artifact-executions/${Uri.encodeComponent(artifactExecutionId)}'
      '/manifests',
    );
    final rows = data['data'] as List<dynamic>? ?? const [];
    return rows
        .whereType<PmocJson>()
        .map(PmocDocumentRevisionContract.fromJson)
        .toList(growable: false);
  }

  /// Um acesso temporário ao arquivo de uma revisão.
  ///
  /// Devolve o mesmo registro de transporte que o documento de campo usa — uma
  /// URL assinada e os cabeçalhos que a assinatura exige — para que o download, a
  /// verificação dos bytes e a gravação continuem sendo os mesmos. O que muda é
  /// quem assina a URL, não o que se faz com ela.
  Future<FieldArtifactAccess> documentAccess(
    String manifestId, {
    bool preview = false,
  }) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/artifact-manifests/${Uri.encodeComponent(manifestId)}/download',
      query: {'operation': preview ? 'preview' : 'download'},
    );
    return FieldArtifactAccess(
      artifactId: manifestId,
      operation: preview ? 'preview' : 'download',
      url: Uri.parse(data['url'] as String? ?? ''),
      expiresAt:
          DateTime.tryParse(data['expiresAt'] as String? ?? '') ??
          DateTime.now().toUtc(),
      requiredHeaders:
          (data['requiredHeaders'] as Map<Object?, Object?>? ?? const {}).map(
            (key, value) => MapEntry(key! as String, '$value'),
          ),
    );
  }

  /// Emite o relatório de execução deste equipamento.
  ///
  /// Só depois de concluído: o documento afirma o que foi conferido, e um
  /// relatório de manutenção em andamento seria declaração sobre o futuro.
  Future<PmocGeneratedArtifactContract> generateArtifact(
    String executionId,
  ) async {
    final data = await _client.post<Map<String, dynamic>>(
      '/pmoc/equipment-executions/${Uri.encodeComponent(executionId)}'
      '/artifact/generate/mine',
      body: const <String, Object?>{},
    );
    return PmocGeneratedArtifactContract.fromJson(data);
  }
}
