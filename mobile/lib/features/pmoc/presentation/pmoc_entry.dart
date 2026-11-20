/// A porta única para o atendimento de um PMOC.
///
/// ## O defeito que isto encerra
///
/// O técnico tocava, em sequência:
///
/// ```text
/// folha da fila      → "Abrir atendimento"   (só levava ao detalhe)
/// detalhe            → "Iniciar o atendimento" (para PMOC, só navegava)
/// etapa Contexto     → "Abrir atendimento"   (aqui, enfim, abria)
/// ```
///
/// Três botões grandes para um gesto só, dois deles com o mesmo nome e nenhum
/// fazendo o que dizia. Para o atendimento comum, o detalhe já iniciava e
/// entrava; para PMOC, não.
///
/// Agora todo ponto de entrada passa por aqui: iniciar **e** entrar são uma ação,
/// e a tela do atendimento abre já com a execução aberta.
///
/// ## Iniciar é idempotente
///
/// `executions/mine` devolve a execução que já existe em vez de criar outra.
/// Então "Continuar atendimento" passa pelo mesmo caminho sem risco — e quem
/// toca duas vezes por causa de rede lenta não abre duas execuções.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/contracts/mobile_field_contracts.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/routing/orbit_router.dart';
import '../application/pmoc_providers.dart';

/// Inicia (se for o caso) e entra no atendimento.
///
/// `start: false` só navega — é o caso do atendimento já concluído, em que não
/// há o que iniciar e o que se quer é ler o relatório.
///
/// Devolve `false` quando o início foi recusado; a razão já foi mostrada.
///
/// O repositório vem do contêiner do contexto, e não de um `WidgetRef`: a
/// porta é chamada também de telas que não são `Consumer` (a área do dono), e
/// exigir `ref` empurraria cada uma a virar `Consumer` só para repassá-lo.
Future<bool> enterPmocAttendance(
  BuildContext context,
  PmocAddressContract address, {
  required bool start,
}) async {
  if (!address.isComplete) return false;
  if (start) {
    try {
      await ProviderScope.containerOf(context, listen: false)
          .read(pmocRepositoryProvider)
          .startMine(
            planId: address.planId,
            cycleId: address.cycleId,
            assetId: address.assetId,
          );
    } on OrbitException catch (error) {
      /* A recusa vem do servidor com a frase que nomeia a regra — "este PMOC
         não está atribuído a você" — e é ela que a pessoa precisa ler. Entrar
         na tela mesmo assim mostraria um roteiro que não abriu. */
      if (context.mounted) {
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(
          SnackBar(content: Text(error.publicMessage)),
        );
      }
      return false;
    }
  }
  if (!context.mounted) return false;
  await context.push(
    OrbitRoutes.pmocAttendance(
      planId: address.planId,
      cycleId: address.cycleId,
      assetId: address.assetId,
    ),
  );
  return true;
}
