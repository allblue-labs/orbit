/// Troca obrigatória de senha.
///
/// ## Quando aparece
///
/// Quando o dono da organização cadastrou a pessoa e entregou uma senha
/// temporária. Enquanto `mustChangePassword` for verdadeiro, o roteador prende
/// o aplicativo aqui: não há aba, não há voltar, e sair é logout.
///
/// A razão não é burocrática. Quem escolheu aquela senha foi outra pessoa, e
/// enquanto ela valer o dono consegue entrar como o técnico — assinar como ele,
/// fechar atendimento como ele. A troca é o que encerra isso, e por isso ela
/// vem antes de qualquer trabalho.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/orbit_brand.dart';

/// O mínimo que o backend aceita em `ChangePasswordDto`.
const int _tamanhoMinimo = 12;

class ChangePasswordScreen extends ConsumerStatefulWidget {
  const ChangePasswordScreen({super.key});

  @override
  ConsumerState<ChangePasswordScreen> createState() =>
      _ChangePasswordScreenState();
}

class _ChangePasswordScreenState extends ConsumerState<ChangePasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _atual = TextEditingController();
  final _nova = TextEditingController();
  final _confirmacao = TextEditingController();

  bool _obscure = true;
  bool _submitting = false;
  String? _error;

  @override
  void dispose() {
    _atual.dispose();
    _nova.dispose();
    _confirmacao.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _submitting = true;
      _error = null;
    });

    try {
      await ref
          .read(authControllerProvider.notifier)
          .changePassword(
            currentPassword: _atual.text,
            newPassword: _nova.text,
          );
      // O perfil recarregado derruba `mustChangePassword`, e o roteador leva
      // daqui para o início sozinho.
    } on OrbitException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.publicMessage);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: OrbitBackground(
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(OrbitSpacing.lg),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 420),
                child: Form(
                  key: _formKey,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const OrbitWordmark(symbolSize: 72),
                      const SizedBox(height: OrbitSpacing.xl),
                      const Text(
                        'Crie sua senha',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: OrbitSpacing.xs),
                      // Curto de propósito: a 2.0× de escala de texto, um
                      // parágrafo a mais empurrava os três campos para fora da
                      // primeira tela — e quem precisa rolar para achar o
                      // formulário acha primeiro o botão de sair.
                      const Text(
                        'A que você recebeu é temporária e outra pessoa a '
                        'conhece.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 13,
                          color: OrbitColors.textSecondary,
                        ),
                      ),
                      const SizedBox(height: OrbitSpacing.lg),

                      TextFormField(
                        key: const Key('change-password.current'),
                        controller: _atual,
                        obscureText: _obscure,
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(
                          labelText: 'Senha temporária',
                          prefixIcon: Icon(Icons.key_outlined),
                        ),
                        validator: (value) => (value == null || value.isEmpty)
                            ? 'Informe a senha que você recebeu'
                            : null,
                      ),
                      const SizedBox(height: OrbitSpacing.md),

                      TextFormField(
                        key: const Key('change-password.new'),
                        controller: _nova,
                        obscureText: _obscure,
                        textInputAction: TextInputAction.next,
                        decoration: InputDecoration(
                          labelText: 'Nova senha',
                          prefixIcon: const Icon(Icons.lock_outline),
                          helperText: 'No mínimo $_tamanhoMinimo caracteres',
                          suffixIcon: IconButton(
                            onPressed: () =>
                                setState(() => _obscure = !_obscure),
                            icon: Icon(
                              _obscure
                                  ? Icons.visibility_outlined
                                  : Icons.visibility_off_outlined,
                            ),
                            tooltip: _obscure
                                ? 'Mostrar senha'
                                : 'Ocultar senha',
                          ),
                        ),
                        validator: (value) {
                          if (value == null || value.length < _tamanhoMinimo) {
                            return 'A senha tem no mínimo $_tamanhoMinimo caracteres';
                          }
                          if (value == _atual.text) {
                            return 'A nova senha precisa ser diferente da temporária';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: OrbitSpacing.md),

                      TextFormField(
                        key: const Key('change-password.confirm'),
                        controller: _confirmacao,
                        obscureText: _obscure,
                        textInputAction: TextInputAction.done,
                        decoration: const InputDecoration(
                          labelText: 'Repita a nova senha',
                          prefixIcon: Icon(Icons.lock_reset_outlined),
                        ),
                        validator: (value) => value != _nova.text
                            ? 'As duas senhas precisam ser iguais'
                            : null,
                      ),

                      if (_error != null) ...[
                        const SizedBox(height: OrbitSpacing.md),
                        _ErrorBanner(message: _error!),
                      ],

                      const SizedBox(height: OrbitSpacing.lg),
                      FilledButton(
                        key: const Key('change-password.submit'),
                        onPressed: _submitting ? null : _submit,
                        child: _submitting
                            ? const SizedBox(
                                width: 22,
                                height: 22,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.2,
                                  color: Colors.white,
                                ),
                              )
                            : const Text('Salvar e continuar'),
                      ),
                      const SizedBox(height: OrbitSpacing.sm),

                      /// Sair é a única saída daqui, e é honesto oferecê-la:
                      /// quem entrou com a conta errada não fica preso.
                      TextButton(
                        key: const Key('change-password.logout'),
                        onPressed: _submitting
                            ? null
                            : () => ref
                                  .read(authControllerProvider.notifier)
                                  .logout(),
                        child: const Text('Sair'),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(OrbitSpacing.gutter),
      decoration: BoxDecoration(
        color: OrbitColors.danger.withValues(alpha: 0.12),
        borderRadius: OrbitRadius.field,
        border: Border.all(color: OrbitColors.danger.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: OrbitColors.danger, size: 20),
          const SizedBox(width: OrbitSpacing.sm),
          Expanded(
            child: Text(
              message,
              style: const TextStyle(fontSize: 13, color: OrbitColors.danger),
            ),
          ),
        ],
      ),
    );
  }
}
