/// Provedores de escrita de cliente e orçamento.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/customer_write_repository.dart';
import '../data/mobile_quote_repository.dart';

final mobileQuoteRepositoryProvider = Provider<MobileQuoteRepository>(
  (ref) => MobileQuoteRepository(
    client: ref.watch(apiClientProvider),
    apiBaseUrl: ref.watch(environmentProvider).apiBaseUrl,
  ),
);

final mobileQuoteOptionsProvider = FutureProvider.autoDispose
    .family<Map<String, dynamic>, String>((ref, customerId) {
      final session = ref.watch(sessionProvider);
      return ref
          .watch(mobileQuoteRepositoryProvider)
          .options(customerId, businessUnitId: session?.businessUnitId);
    });
final mobileQuoteCatalogProvider = FutureProvider.autoDispose
    .family<List<Map<String, dynamic>>, String>((ref, search) {
      final session = ref.watch(sessionProvider);
      return ref
          .watch(mobileQuoteRepositoryProvider)
          .catalog(search, businessUnitId: session?.businessUnitId);
    });

final customerWriteRepositoryProvider = Provider<CustomerWriteRepository>(
  (ref) => CustomerWriteRepository(client: ref.watch(apiClientProvider)),
);
