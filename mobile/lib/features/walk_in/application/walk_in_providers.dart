/// A ligação do atendimento avulso com a árvore.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/walk_in_contracts.dart';
import '../data/walk_in_repository.dart';

final walkInRepositoryProvider = Provider<WalkInRepository>(
  (ref) => WalkInRepository(client: ref.watch(apiClientProvider)),
);

/// A carteira, filtrada pelo servidor.
///
/// `family` pela busca e `autoDispose` porque é consulta de um passo do
/// roteiro: mantê-la viva depois de o atendimento abrir guardaria a carteira
/// inteira na memória de um celular em campo.
final walkInCustomersProvider = FutureProvider.autoDispose
    .family<List<WalkInCustomerContract>, String>(
      (ref, search) =>
          ref.watch(walkInRepositoryProvider).customers(search: search),
    );

final walkInEquipmentProvider = FutureProvider.autoDispose
    .family<List<WalkInEquipmentContract>, String>(
      (ref, customerId) =>
          ref.watch(walkInRepositoryProvider).equipment(customerId),
    );
