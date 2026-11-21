import 'package:flutter/material.dart';

import '../../../core/time/orbit_timezone.dart';
import '../../authentication/domain/session.dart';
import '../data/owner_repository.dart';
import 'owner_controls.dart';
import 'owner_records.dart';

class OwnerTools {
  const OwnerTools(this.repo, this.session, this.access, this.zone);

  final OwnerRepository repo;
  final OrbitSession session;
  final OwnerAccess access;
  final OrbitTimezone zone;

  String? get unitId => repo.unitId;
  DateTime get now => zone.at(DateTime.now());

  bool can(String area, String permission) =>
      access.areas.contains(area) &&
      (session.isOwner ||
          session.hasPermission(permission) ||
          (area != 'team' && session.roles.contains('FIELD_TECHNICIAN')));

  Future<OwnerRow?> customer(BuildContext context) async =>
      (await pickCustomer(context))?.value;

  Future<({OwnerRow? value})?> pickCustomer(
    BuildContext context, {
    String? alternative,
  }) => showModalBottomSheet<({OwnerRow? value})>(
    context: context,
    useSafeArea: true,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => FractionallySizedBox(
      heightFactor: .82,
      child: OwnerRecords(
        title: 'Selecionar cliente',
        icon: Icons.people_outline,
        badge: (_) => null,
        search: true,
        searchLabel: 'Buscar por nome, CPF ou CNPJ',
        load: (search, page, _) => repo.list(
          '/mobile/owner/customers',
          query: {'page': page, if (search.isNotEmpty) 'search': search},
        ),
        subtitle: (row) {
          final detail = ownerText(row, ['documentNumber', 'legalName']);
          return detail == ownerText(row) ? '' : detail;
        },
        open: (sheet, row) async {
          Navigator.pop<({OwnerRow? value})>(sheet, (value: row));
          return false;
        },
        createLabel: alternative ?? '',
        create: alternative == null
            ? null
            : (sheet) async {
                Navigator.pop<({OwnerRow? value})>(sheet, (value: null));
                return false;
              },
      ),
    ),
  );

  Future<List<OwnerRow>> equipment(String customerId, String search) async =>
      (await repo.options(
        '/mobile/owner/equipment',
        query: {'search': search, 'customerId': customerId},
      )).where((row) => row['businessUnitId'] == unitId).toList();

  Future<List<OwnerRow>> addresses(String customerId, String search) async =>
      (await repo.options(
            '/mobile/owner/addresses',
            query: {'customerId': customerId},
          ))
          .map(
            (row) => {
              ...row,
              'name': [
                ownerText(row, ['label']),
                [row['street'], row['number']].whereType<String>().join(', '),
              ].where((part) => part.isNotEmpty).join(' · '),
            },
          )
          .where((row) => matches(row, search))
          .toList();

  Future<List<OwnerRow>> technicians(
    String search, {
    bool responsible = false,
    bool assistant = false,
  }) async => (await repo.options(
    '/workforce/${responsible
        ? 'eligible-technical-responsibles'
        : assistant
        ? 'field-assistants'
        : 'field-technicians'}',
    query: {'businessUnitId': unitId},
  )).where((row) => matches(row, search)).toList();

  DateTime? instant(OwnerRow row, String key) {
    final date = DateTime.tryParse(ownerString(row, key) ?? '');
    return date == null ? null : zone.at(date);
  }

  Future<bool> remove(
    BuildContext context,
    String path,
    String entity, {
    String? description,
  }) async {
    if (!await ownerConfirm(
      context,
      'Remover $entity?',
      description ?? 'O registro deixará de aparecer na lista.',
      label: 'Remover',
    )) {
      return false;
    }
    await repo.remove(path);
    return true;
  }
}

bool matches(OwnerRow row, String search) =>
    ownerText(row).toLowerCase().contains(search.toLowerCase());

OwnerRow? rowOrNull(Object? data) =>
    data is OwnerRow && data.isNotEmpty ? data : null;
String? pickId(Object? value) =>
    value is OwnerRow ? present(ownerId(value)) : null;
List<String> pickIds(Object? value) => ownerRows(value).map(ownerId).toList();
String? isoInstant(OwnerRow values, String key) =>
    (values[key] as DateTime?)?.toUtc().toIso8601String();
String? isoDate(OwnerRow values, String key) =>
    values[key] is DateTime ? ownerDate(values[key] as DateTime) : null;
String? decimalText(OwnerRow values, String key) =>
    (values[key] as String?)?.replaceAll(',', '.');
