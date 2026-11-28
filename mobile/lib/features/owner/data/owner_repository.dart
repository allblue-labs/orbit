import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/network/orbit_api_client.dart';

typedef OwnerRow = Map<String, dynamic>;

final ownerRepositoryProvider = Provider.autoDispose<OwnerRepository>((ref) {
  final session = ref.watch(sessionProvider);
  final client = ref.watch(apiClientProvider).scoped(mobileManagement: true);
  ref.onDispose(client.closeScope);
  return OwnerRepository(client, session?.businessUnitId);
});

final ownerAccessProvider = FutureProvider.autoDispose<OwnerAccess>((
  ref,
) async {
  if (ref.watch(sessionProvider)?.organizationId == null) {
    return const OwnerAccess({}, false);
  }
  final repository = ref.watch(ownerRepositoryProvider);
  final payload = await repository.read('/mobile/owner/access');
  return OwnerAccess(
    ownerValues(payload['areas']).toSet(),
    payload['requiresAuthorization'] == true,
  );
});

class OwnerAccess {
  const OwnerAccess(this.areas, this.requiresAuthorization);

  final Set<String> areas;
  final bool requiresAuthorization;
}

OwnerRow ownerRow(Object? value) => value is OwnerRow ? value : {};
List<OwnerRow> ownerRows(Object? value) =>
    value is List ? value.whereType<OwnerRow>().toList() : [];
List<String> ownerValues(Object? value) =>
    value is List ? value.whereType<String>().toList() : [];

class OwnerPage {
  const OwnerPage(this.rows, {this.nextCursor, this.hasMore = false});

  final List<OwnerRow> rows;
  final String? nextCursor;
  final bool hasMore;
}

class OwnerRepository {
  const OwnerRepository(this._client, this.unitId);

  final OrbitApiClient _client;
  final String? unitId;

  Future<OwnerRow> read(String path) => _client.get<OwnerRow>(path);

  Future<OwnerPage> list(String path, {OwnerRow? query}) async {
    final response = await _client.get<Object?>(path, query: query);
    if (response is List) return OwnerPage(ownerRows(response));
    final payload = ownerRow(response);
    final meta = ownerRow(payload['meta'] ?? payload['pagination']);
    final rows = ownerRows(payload['data']);
    final cursor = payload['nextCursor'] as String?;
    return OwnerPage(
      rows,
      nextCursor: cursor,
      hasMore:
          payload['hasNextPage'] == true ||
          meta['hasNextPage'] == true ||
          (meta['page'] is num &&
              meta['totalPages'] is num &&
              (meta['page'] as num) < (meta['totalPages'] as num)),
    );
  }

  Future<List<OwnerRow>> options(String path, {OwnerRow? query}) async =>
      (await list(path, query: query)).rows;

  Future<OwnerRow> create(String path, OwnerRow input) =>
      _client.post<OwnerRow>(path, body: input);

  Future<List<OwnerRow>> commandList(String path, OwnerRow input) async =>
      ownerRows(await _client.post<Object?>(path, body: input));

  Future<void> post(String path, [OwnerRow input = const {}]) async {
    await _client.post<Object?>(path, body: input);
  }

  Future<void> update(String path, OwnerRow input) async {
    await _client.patch<Object?>(path, body: input);
  }

  Future<void> remove(String path) async {
    await _client.delete<Object?>(path);
  }
}
