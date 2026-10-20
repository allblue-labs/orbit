/// Estado da leitura de etiqueta.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/equipment_qr_contracts.dart';
import '../data/equipment_qr_repository.dart';

final equipmentQrRepositoryProvider = Provider<EquipmentQrRepository>(
  (ref) => EquipmentQrRepository(client: ref.watch(apiClientProvider)),
);

/// O equipamento de um token.
///
/// `family` pelo token e `autoDispose`: sair da tela esquece o que foi lido, e
/// ler a mesma etiqueta de novo pergunta de novo — a manutenção de ontem pode
/// ter mudado o que o servidor responde hoje.
final equipmentByQrProvider = FutureProvider.autoDispose
    .family<EquipmentQrResolvedContract, String>(
      (ref, token) => ref.watch(equipmentQrRepositoryProvider).resolve(token),
    );
