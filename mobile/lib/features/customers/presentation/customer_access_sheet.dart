/// O acesso do cliente ao app, como o owner cria e mantém.
///
/// Mesmo fluxo da web (página do cliente): o owner escolhe o nome de acesso,
/// o domínio é o da organização — o mesmo dos técnicos —, e o sistema gera a
/// senha temporária. Ela aparece **uma vez**; o owner a repassa, e o cliente
/// cria a dele no primeiro acesso.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/mobile_field_contracts.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/network/orbit_api_client.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../../customer_portal/data/portal_contracts.dart';

class CustomerAccessRepository {
  CustomerAccessRepository(this._client);

  final OrbitApiClient _client;

  String _base(String customerId) =>
      '/customers/${Uri.encodeComponent(customerId)}/portal';

  Future<CustomerAccess> load(String customerId) async =>
      CustomerAccess.fromJson(
        await _client.get<Map<String, dynamic>>('${_base(customerId)}/access'),
      );

  Future<CustomerAccessCredentials> create(
    String customerId, {
    required String localPart,
  }) async => CustomerAccessCredentials.fromJson(
    await _client.post<Map<String, dynamic>>(
      '${_base(customerId)}/access',
      body: {'localPart': localPart},
    ),
  );

  Future<CustomerAccessCredentials> resetPassword(
    String customerId,
    String identityId,
  ) async => CustomerAccessCredentials.fromJson(
    await _client.post<Map<String, dynamic>>(
      '${_base(customerId)}/identities/${Uri.encodeComponent(identityId)}/password',
    ),
  );

  Future<void> disable(
    String customerId,
    String identityId,
  ) => _client.post<dynamic>(
    '${_base(customerId)}/identities/${Uri.encodeComponent(identityId)}/disable',
  );
}

final customerAccessRepositoryProvider = Provider<CustomerAccessRepository>(
  (ref) => CustomerAccessRepository(
    ref.watch(apiClientProvider).scoped(mobileManagement: true),
  ),
);

final customerAccessProvider = FutureProvider.autoDispose
    .family<CustomerAccess, String>(
      (ref, customerId) =>
          ref.watch(customerAccessRepositoryProvider).load(customerId),
    );

Future<void> showCustomerAccessSheet(
  BuildContext context,
  MobileFieldCustomerContract customer,
) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  useSafeArea: true,
  backgroundColor: context.orbit.surface,
  builder: (_) => Padding(
    padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
    child: _AccessSheet(customer: customer),
  ),
);

class _AccessSheet extends ConsumerStatefulWidget {
  const _AccessSheet({required this.customer});

  final MobileFieldCustomerContract customer;

  @override
  ConsumerState<_AccessSheet> createState() => _AccessSheetState();
}

class _AccessSheetState extends ConsumerState<_AccessSheet> {
  final _nome = TextEditingController();
  bool _nomeSugerido = false;
  bool _enviando = false;
  String? _erro;

  /// A senha recém-gerada. Só existe nesta tela, e some quando ela fecha.
  CustomerAccessCredentials? _credenciais;

  String get _customerId => widget.customer.id;

  @override
  void dispose() {
    _nome.dispose();
    super.dispose();
  }

  Future<void> _rodar(
    Future<CustomerAccessCredentials?> Function() acao,
  ) async {
    setState(() {
      _enviando = true;
      _erro = null;
    });
    try {
      final credenciais = await acao();
      if (!mounted) return;
      setState(() => _credenciais = credenciais);
      ref.invalidate(customerAccessProvider(_customerId));
    } on Object catch (error) {
      if (mounted) {
        setState(
          () => _erro = OrbitException.publicCopyForAny(
            error,
            prefixo: 'Não foi possível concluir.',
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  Future<bool> _confirmar(String titulo, String texto, String acao) async =>
      await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(titulo),
          content: Text(texto),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(acao),
            ),
          ],
        ),
      ) ==
      true;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final acesso = ref.watch(customerAccessProvider(_customerId));

    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        OrbitSpacing.gutter,
        0,
        OrbitSpacing.gutter,
        OrbitSpacing.xl,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Acesso do cliente',
            style: OrbitType.screenTitle.copyWith(color: palette.ink),
          ),
          const SizedBox(height: OrbitSpacing.xs),
          Text(
            '${widget.customer.name} vê pelo app os próprios equipamentos, atendimentos e documentos — só leitura, e nada de outros clientes.',
            style: OrbitType.body.copyWith(color: palette.inkMuted),
          ),
          const SizedBox(height: OrbitSpacing.lg),
          if (_credenciais case final credenciais?)
            _Credenciais(credenciais: credenciais)
          else
            acesso.when(
              loading: () => const SectionLoading(lines: 3),
              error: (error, _) => SectionError(
                error: error,
                onRetry: () =>
                    ref.invalidate(customerAccessProvider(_customerId)),
              ),
              data: (dados) {
                final atual = dados.identity;
                if (atual != null && atual.isActive) {
                  return _Ativo(
                    identity: atual,
                    enviando: _enviando,
                    onNovaSenha: () async {
                      if (!await _confirmar(
                        'Gerar nova senha?',
                        'A senha atual deixa de valer e o cliente sai do app. Ele entra com a nova senha temporária e cria outra.',
                        'Gerar nova senha',
                      )) {
                        return;
                      }
                      await _rodar(
                        () => ref
                            .read(customerAccessRepositoryProvider)
                            .resetPassword(_customerId, atual.id),
                      );
                    },
                    onDesativar: () async {
                      if (!await _confirmar(
                        'Desativar o acesso?',
                        'O cliente sai do app na hora e não entra mais. Você pode criar o acesso de novo depois.',
                        'Desativar',
                      )) {
                        return;
                      }
                      await _rodar(() async {
                        await ref
                            .read(customerAccessRepositoryProvider)
                            .disable(_customerId, atual.id);
                        return null;
                      });
                    },
                  );
                }
                if (!_nomeSugerido) {
                  _nomeSugerido = true;
                  _nome.text =
                      atual?.email.split('@').first ?? dados.suggestedLocalPart;
                }
                return _Criar(
                  controller: _nome,
                  domain: dados.domain,
                  reaberto: atual != null,
                  enviando: _enviando,
                  onCriar: () => _rodar(
                    () => ref
                        .read(customerAccessRepositoryProvider)
                        .create(_customerId, localPart: _nome.text),
                  ),
                );
              },
            ),
          if (_erro != null) ...[
            const SizedBox(height: OrbitSpacing.md),
            Text(_erro!, style: TextStyle(color: palette.danger)),
          ],
        ],
      ),
    );
  }
}

class _Criar extends StatelessWidget {
  const _Criar({
    required this.controller,
    required this.domain,
    required this.reaberto,
    required this.enviando,
    required this.onCriar,
  });

  final TextEditingController controller;
  final String? domain;
  final bool reaberto;
  final bool enviando;
  final VoidCallback onCriar;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (reaberto) ...[
          Text(
            'O acesso anterior foi desativado. Criar de novo gera uma senha nova.',
            style: OrbitType.caption.copyWith(color: palette.inkMuted),
          ),
          const SizedBox(height: OrbitSpacing.sm),
        ],
        TextField(
          controller: controller,
          autocorrect: false,
          keyboardType: TextInputType.emailAddress,
          decoration: InputDecoration(
            labelText: 'Nome de acesso',
            suffixText: domain == null ? null : '@$domain',
            helperText:
                'O domínio é o da sua empresa, o mesmo que a equipe usa.',
          ),
        ),
        const SizedBox(height: OrbitSpacing.lg),
        FilledButton.icon(
          onPressed: enviando ? null : onCriar,
          icon: const Icon(Icons.person_add_alt_1_outlined),
          label: const Text('Criar acesso'),
        ),
      ],
    );
  }
}

class _Ativo extends StatelessWidget {
  const _Ativo({
    required this.identity,
    required this.enviando,
    required this.onNovaSenha,
    required this.onDesativar,
  });

  final CustomerAccessIdentity identity;
  final bool enviando;
  final VoidCallback onNovaSenha;
  final VoidCallback onDesativar;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final ultimo = identity.lastLoginAt;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'E-mail de acesso',
          style: OrbitType.caption.copyWith(color: palette.inkMuted),
        ),
        SelectableText(
          identity.email,
          style: OrbitType.itemTitle.copyWith(color: palette.ink),
        ),
        const SizedBox(height: OrbitSpacing.sm),
        Text(
          identity.mustChangePassword
              ? 'Aguardando o primeiro acesso do cliente.'
              : ultimo == null
              ? 'Senha criada pelo cliente.'
              : 'Último acesso em ${ultimo.day.toString().padLeft(2, '0')}/${ultimo.month.toString().padLeft(2, '0')}/${ultimo.year}.',
          style: OrbitType.body.copyWith(color: palette.inkMuted),
        ),
        const SizedBox(height: OrbitSpacing.lg),
        OutlinedButton.icon(
          onPressed: enviando ? null : onNovaSenha,
          icon: const Icon(Icons.key_outlined),
          label: const Text('Gerar nova senha'),
        ),
        const SizedBox(height: OrbitSpacing.sm),
        TextButton.icon(
          onPressed: enviando ? null : onDesativar,
          icon: Icon(Icons.block, color: palette.danger),
          label: Text(
            'Desativar acesso',
            style: TextStyle(color: palette.danger),
          ),
        ),
      ],
    );
  }
}

/// A senha temporária, mostrada uma vez, com as duas formas de repassá-la.
class _Credenciais extends StatelessWidget {
  const _Credenciais({required this.credenciais});

  final CustomerAccessCredentials credenciais;

  String get _mensagem =>
      'Seu acesso ao app Orbit:\n'
      'E-mail: ${credenciais.identity.email}\n'
      'Senha temporária: ${credenciais.temporaryPassword}\n\n'
      'Baixe o app, escolha "Sou cliente" e entre. No primeiro acesso você cria a sua senha.';

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.all(OrbitSpacing.md),
          decoration: BoxDecoration(
            color: palette.accentSoft,
            borderRadius: OrbitRadius.card,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'E-mail',
                style: OrbitType.caption.copyWith(color: palette.inkMuted),
              ),
              SelectableText(
                credenciais.identity.email,
                style: OrbitType.itemTitle.copyWith(color: palette.ink),
              ),
              const SizedBox(height: OrbitSpacing.sm),
              Text(
                'Senha temporária',
                style: OrbitType.caption.copyWith(color: palette.inkMuted),
              ),
              SelectableText(
                credenciais.temporaryPassword,
                style: OrbitType.metric.copyWith(
                  color: palette.ink,
                  fontSize: 22,
                  letterSpacing: 1.5,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: OrbitSpacing.sm),
        Text(
          'Esta senha aparece só agora. Repasse ao cliente — no primeiro acesso ele cria a dele.',
          style: OrbitType.caption.copyWith(color: palette.inkMuted),
        ),
        const SizedBox(height: OrbitSpacing.md),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () async {
                  await Clipboard.setData(ClipboardData(text: _mensagem));
                  if (context.mounted) {
                    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
                      const SnackBar(content: Text('Acesso copiado.')),
                    );
                  }
                },
                icon: const Icon(Icons.copy),
                label: const Text('Copiar'),
              ),
            ),
            const SizedBox(width: OrbitSpacing.sm),
            Expanded(
              child: FilledButton.icon(
                onPressed: () => SharePlus.instance.share(
                  ShareParams(text: _mensagem, subject: 'Seu acesso ao app'),
                ),
                icon: const Icon(Icons.ios_share),
                label: const Text('Enviar'),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
