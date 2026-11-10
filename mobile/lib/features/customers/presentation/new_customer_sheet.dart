library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/orbit_exception.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../field/application/field_providers.dart';
import '../../walk_in/application/walk_in_providers.dart';
import '../application/customer_write_providers.dart';

Future<bool> showNewCustomerSheet(BuildContext context) async {
  final criado = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: context.orbit.background,
    builder: (context) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: const SingleChildScrollView(child: _Folha()),
    ),
  );
  return criado ?? false;
}

class _Folha extends ConsumerStatefulWidget {
  const _Folha();

  @override
  ConsumerState<_Folha> createState() => _FolhaState();
}

class _FolhaState extends ConsumerState<_Folha> {
  final _razao = TextEditingController();
  final _fantasia = TextEditingController();
  final _email = TextEditingController();
  final _telefone = TextEditingController();

  final _address = <String, TextEditingController>{
    for (final key in [
      'postalCode',
      'street',
      'number',
      'complement',
      'district',
      'city',
      'stateCode',
    ])
      key: TextEditingController(),
  };
  bool _includeAddress = false;
  bool _lookingUp = false;
  String? _postalError;
  int _lookupVersion = 0;

  Future<void> _lookupPostalCode(String value) async {
    final version = ++_lookupVersion;
    final digits = value.replaceAll(RegExp(r'\D'), '');
    setState(() {
      _postalError = null;
      _lookingUp = digits.length == 8;
    });
    if (digits.length != 8) return;
    try {
      final result = await ref
          .read(walkInRepositoryProvider)
          .postalCode(digits);
      if (!mounted || version != _lookupVersion || !_includeAddress) return;
      setState(() {
        _address['street']!.text = result.street;
        _address['district']!.text = result.district;
        _address['city']!.text = result.city;
        _address['stateCode']!.text = result.stateCode;
      });
    } on Object {
      if (mounted && version == _lookupVersion) {
        setState(
          () => _postalError =
              'Não foi possível consultar o CEP. Preencha o endereço manualmente.',
        );
      }
    } finally {
      if (mounted && version == _lookupVersion) {
        setState(() => _lookingUp = false);
      }
    }
  }

  String _tipo = 'COMPANY';
  bool _salvando = false;
  Object? _erro;

  @override
  void dispose() {
    _lookupVersion++;
    for (final controller in _address.values) {
      controller.dispose();
    }
    _razao.dispose();
    _fantasia.dispose();
    _email.dispose();
    _telefone.dispose();
    super.dispose();
  }

  bool get _valido => _razao.text.trim().length >= 2;

  Future<void> _salvar() async {
    if (!_valido || _salvando) return;
    setState(() {
      _salvando = true;
      _erro = null;
    });
    try {
      await ref
          .read(customerWriteRepositoryProvider)
          .createCustomer(
            type: _tipo,
            legalName: _razao.text,
            tradeName: _fantasia.text,
            email: _email.text,
            phone: _telefone.text,
            address: _includeAddress
                ? {
                    for (final entry in _address.entries)
                      if (entry.value.text.trim().isNotEmpty)
                        entry.key: entry.key == 'stateCode'
                            ? entry.value.text.trim().toUpperCase()
                            : entry.value.text.trim(),
                  }
                : null,
          );

      /// A carteira é derivada do trabalho da pessoa, então um cliente novo
      /// só aparece nela quando houver atendimento. Invalidar mesmo assim é
      /// barato e evita a dúvida de "sumiu?".
      ref.invalidate(fieldCustomersProvider);
      if (mounted) Navigator.of(context).pop(true);
    } on Object catch (error) {
      if (mounted) {
        setState(() {
          _erro = error;
          _salvando = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          OrbitSpacing.gutter,
          0,
          OrbitSpacing.gutter,
          OrbitSpacing.md,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Novo cliente',
              style: OrbitType.sectionTitle.copyWith(color: palette.ink),
            ),
            const SizedBox(height: OrbitSpacing.xs),
            Text(
              'Cadastre os dados básicos e, se quiser, o endereço do cliente.',
              style: OrbitType.caption.copyWith(color: palette.inkSubtle),
            ),
            const SizedBox(height: OrbitSpacing.lg),

            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'COMPANY', label: Text('Empresa')),
                ButtonSegment(value: 'INDIVIDUAL', label: Text('Pessoa')),
              ],
              selected: {_tipo},
              onSelectionChanged: (escolha) =>
                  setState(() => _tipo = escolha.first),
            ),
            const SizedBox(height: OrbitSpacing.md),

            TextField(
              controller: _razao,
              autofocus: true,
              textCapitalization: TextCapitalization.words,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: _tipo == 'COMPANY' ? 'Razão social' : 'Nome',
              ),
            ),
            const SizedBox(height: OrbitSpacing.ms),
            TextField(
              controller: _fantasia,
              textCapitalization: TextCapitalization.words,
              decoration: InputDecoration(
                labelText: _tipo == 'COMPANY'
                    ? 'Nome fantasia (opcional)'
                    : 'Como prefere ser chamado (opcional)',
              ),
            ),
            const SizedBox(height: OrbitSpacing.ms),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _email,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      labelText: 'E-mail (opcional)',
                    ),
                  ),
                ),
                const SizedBox(width: OrbitSpacing.ms),
                Expanded(
                  child: TextField(
                    controller: _telefone,
                    keyboardType: TextInputType.phone,
                    decoration: const InputDecoration(
                      labelText: 'Telefone (opcional)',
                    ),
                  ),
                ),
              ],
            ),

            const SizedBox(height: OrbitSpacing.md),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Adicionar endereço'),
              subtitle: const Text('Opcional. Pode ser preenchido depois.'),
              value: _includeAddress,
              onChanged: _salvando
                  ? null
                  : (value) => setState(() {
                      _includeAddress = value ?? false;
                      _lookupVersion++;
                      _lookingUp = false;
                      _postalError = null;
                    }),
            ),
            AnimatedSize(
              duration: const Duration(milliseconds: 220),
              alignment: Alignment.topCenter,
              child: !_includeAddress
                  ? const SizedBox.shrink()
                  : Column(
                      children: [
                        TextField(
                          controller: _address['postalCode'],
                          keyboardType: TextInputType.number,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                            LengthLimitingTextInputFormatter(8),
                          ],
                          onChanged: _lookupPostalCode,
                          decoration: InputDecoration(
                            labelText: 'CEP (opcional)',
                            helperText:
                                'A busca é automática ao informar os 8 dígitos.',
                            errorText: _postalError,
                            suffixIcon: _lookingUp
                                ? const Padding(
                                    padding: EdgeInsets.all(14),
                                    child: SizedBox(
                                      width: 20,
                                      height: 20,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                      ),
                                    ),
                                  )
                                : null,
                          ),
                        ),
                        for (final entry in const {
                          'street': 'Logradouro',
                          'number': 'Número',
                          'complement': 'Complemento',
                          'district': 'Bairro',
                          'city': 'Cidade',
                          'stateCode': 'UF',
                        }.entries) ...[
                          const SizedBox(height: OrbitSpacing.ms),
                          TextField(
                            controller: _address[entry.key],
                            maxLength: entry.key == 'stateCode' ? 2 : null,
                            textCapitalization: entry.key == 'stateCode'
                                ? TextCapitalization.characters
                                : TextCapitalization.words,
                            decoration: InputDecoration(
                              labelText: '${entry.value} (opcional)',
                              counterText: '',
                            ),
                          ),
                        ],
                      ],
                    ),
            ),
            if (_erro != null) ...[
              const SizedBox(height: OrbitSpacing.md),
              Text(
                _erro is OrbitException
                    ? (_erro! as OrbitException).publicMessage
                    : 'Não foi possível cadastrar. Tente novamente.',
                style: OrbitType.body.copyWith(color: palette.danger),
              ),
            ],

            const SizedBox(height: OrbitSpacing.lg),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _salvando
                        ? null
                        : () => Navigator.of(context).pop(false),
                    child: const Text('Cancelar'),
                  ),
                ),
                const SizedBox(width: OrbitSpacing.ms),
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    onPressed: _valido && !_salvando && !_lookingUp
                        ? _salvar
                        : null,
                    child: Text(_salvando ? 'Cadastrando…' : 'Cadastrar'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
