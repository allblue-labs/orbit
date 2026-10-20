/// Provedores de escrita de cliente e orçamento.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/customer_write_repository.dart';

final customerWriteRepositoryProvider = Provider<CustomerWriteRepository>(
  (ref) => CustomerWriteRepository(client: ref.watch(apiClientProvider)),
);
