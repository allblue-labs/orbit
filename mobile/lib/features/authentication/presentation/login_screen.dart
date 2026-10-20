/// Autenticação.
///
/// Envia `client: MOBILE` para o backend, que registra a sessão com essa
/// origem. O MFA aparece apenas quando o servidor sinaliza que é necessário —
/// o app não decide isso.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/orbit_brand.dart';
import '../domain/session.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _mfaCode = TextEditingController();

  bool _obscure = true;
  bool _submitting = false;
  bool _requiresMfa = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _mfaCode.dispose();
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
          .login(
            email: _email.text,
            password: _password.text,
            mfaCode: _mfaCode.text.isEmpty ? null : _mfaCode.text,
          );
      // A navegação reage à mudança de sessão; nada a fazer aqui.
    } on OrbitException catch (error) {
      final needsMfa = error.code == 'MFA_REQUIRED';
      if (!mounted) return;
      setState(() {
        _requiresMfa = _requiresMfa || needsMfa;
        _error = needsMfa
            ? 'Informe o código do seu autenticador.'
            : error.publicMessage;
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  /// Pede o link de redefinição para o e-mail digitado.
  ///
  /// A confirmação é a mesma exista a conta ou não — o servidor responde 202
  /// nos dois casos, e a tela não pode contar o que ele esconde. Falha de rede
  /// também não vira "não existe": ela vira uma mensagem de rede.
  Future<void> _pedirRecuperacao() async {
    final email = _email.text.trim();
    if (!email.contains('@')) {
      setState(() => _error = 'Escreva seu e-mail acima para receber o link.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await ref
          .read(authControllerProvider.notifier)
          .requestPasswordReset(email);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Se houver conta com esse e-mail, o link de redefinição foi '
            'enviado.',
          ),
        ),
      );
    } on OrbitException catch (error) {
      if (!mounted) return;
      setState(() => _error = error.publicMessage);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    final motivo = auth is AuthUnauthenticated ? auth.reason : null;
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
                      const OrbitWordmark(symbolSize: 84),
                      const SizedBox(height: OrbitSpacing.xl),
                      const Text(
                        'Entrar',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: OrbitSpacing.xs),
                      const Text(
                        'Use as credenciais da sua organização.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 13,
                          color: OrbitColors.textSecondary,
                        ),
                      ),
                      const SizedBox(height: OrbitSpacing.lg),

                      TextFormField(
                        key: const Key('login.email'),
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        autocorrect: false,
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(
                          labelText: 'E-mail',
                          prefixIcon: Icon(Icons.mail_outline),
                        ),
                        validator: (value) =>
                            (value == null || !value.contains('@'))
                            ? 'Informe um e-mail válido'
                            : null,
                      ),
                      const SizedBox(height: OrbitSpacing.md),

                      TextFormField(
                        key: const Key('login.password'),
                        controller: _password,
                        obscureText: _obscure,
                        textInputAction: _requiresMfa
                            ? TextInputAction.next
                            : TextInputAction.done,
                        decoration: InputDecoration(
                          labelText: 'Senha',
                          prefixIcon: const Icon(Icons.lock_outline),
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
                        validator: (value) =>
                            (value == null || value.length < 8)
                            ? 'A senha tem no mínimo 8 caracteres'
                            : null,
                      ),

                      if (_requiresMfa) ...[
                        const SizedBox(height: OrbitSpacing.md),
                        TextFormField(
                          key: const Key('login.mfa'),
                          controller: _mfaCode,
                          keyboardType: TextInputType.number,
                          textInputAction: TextInputAction.done,
                          decoration: const InputDecoration(
                            labelText: 'Código de verificação',
                            prefixIcon: Icon(Icons.shield_outlined),
                          ),
                        ),
                      ],

                      // O motivo de ter caído aqui — sessão expirada, servidor
                      // inalcançável — só aparece enquanto ninguém digitou nada.
                      // Depois de uma tentativa, quem manda é o erro dela.
                      if (_error == null && motivo != null) ...[
                        const SizedBox(height: OrbitSpacing.md),
                        _ErrorBanner(message: motivo),
                      ],
                      if (_error != null) ...[
                        const SizedBox(height: OrbitSpacing.md),
                        _ErrorBanner(message: _error!),
                      ],

                      const SizedBox(height: OrbitSpacing.lg),
                      FilledButton(
                        key: const Key('login.submit'),
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
                            : const Text('Entrar'),
                      ),
                      const SizedBox(height: OrbitSpacing.sm),

                      /// Recuperação por e-mail.
                      ///
                      /// Existe aqui porque é onde a pessoa descobre que não
                      /// lembra a senha. Quem não usa e-mail no trabalho — boa
                      /// parte de uma equipe de campo — pede ao dono da
                      /// organização, que gera um link e repassa por mensagem.
                      TextButton(
                        key: const Key('login.forgot'),
                        onPressed: _submitting ? null : _pedirRecuperacao,
                        child: const Text('Esqueci minha senha'),
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
