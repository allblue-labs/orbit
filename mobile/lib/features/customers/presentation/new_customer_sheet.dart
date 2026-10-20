/// Cadastrar um cliente, do celular.
///
/// ## O que este formulário deliberadamente não pede
///
/// Documento, endereço e contatos. O cadastro completo é trabalho de
/// escritório; pedi-lo inteiro numa tela de 390 pixels, com alguém de pé numa
/// casa de máquinas, é o caminho mais curto para o cliente nunca ser
/// cadastrado — e o atendimento acontecer sem registro.
///
/// O servidor exige tipo e razão social. É isso que se pede aqui; o resto se
/// completa depois, de onde é confortável completar.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/errors/orbit_exception.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../field/application/field_providers.dart';
import '../application/customer_write_providers.dart';

Future<bool> showNewCustomerSheet(BuildContext context) async {
  final criado = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    backgroundColor: context.orbit.background,
    builder: (context) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: const _Folha(),
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

  String _tipo = 'COMPANY';
  bool _salvando = false;
  Object? _erro;

  @override
  void dispose() {
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
          );

      /// A carteira é derivada do trabalho da pessoa, então um cliente novo
      /// só aparece nela quando houver atendimento. Invalidar mesmo assim é
      /// barato e evita a dúvida de "sumiu?".
      ref.invalidate(fieldCustomersProvider);
      if (mounted) Navigator.of(context).pop(true);
    } on OrbitException catch (error) {
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
              'Documento e endereço podem ser preenchidos depois.',
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
                    onPressed: _valido && !_salvando ? _salvar : null,
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
