/// O que o aplicativo diz quando algo dá errado.
///
/// ## Um lugar só, e por quê
///
/// Toda frase pública de falha de transporte mora aqui. Não é organização por
/// gosto: é o que torna a auditoria possível. Um guard automatizado consegue
/// ler este arquivo e provar que nenhuma frase contém endereço, porta, nome de
/// biblioteca ou vocabulário de infraestrutura — coisa impossível de garantir
/// se as frases estiverem espalhadas por dezenas de telas.
///
/// ## O tom
///
/// Curto, em português, orientado à ação, sem culpar quem lê e sem drama. Quem
/// está numa casa de máquinas às sete da manhã não precisa de "Ops!" nem de
/// "Falha crítica!" — precisa saber se espera, se tenta de novo ou se o
/// problema é a internet do prédio.
///
/// ## O que nunca aparece
///
/// Endereço, porta, URL, status HTTP, nome de exceção, nome de biblioteca,
/// certificado, stack. Nada disso ajuda quem lê, e tudo isso descreve a
/// infraestrutura para quem estiver olhando por cima do ombro.
library;

abstract final class OrbitPublicCopy {
  /// Sem rede, ou servidor inalcançável.
  ///
  /// Fala de conexão, e não de servidor: do lado de quem lê, os dois casos se
  /// resolvem do mesmo jeito — conferir a internet e tentar de novo.
  static const offline =
      'Sem conexão. Verifique sua conexão com a internet e tente novamente.';

  /// A conexão abriu e a resposta não veio a tempo.
  ///
  /// "Demorando mais que o esperado" descreve o que houve sem prometer que vai
  /// terminar, e sem acusar a rede de quem lê.
  static const timeout =
      'O serviço está demorando mais que o esperado. '
      'Tente novamente em alguns instantes.';

  /// O servidor respondeu, mas não como deveria — ou não respondeu.
  static const serverUnavailable =
      'Não foi possível acessar o Orbit agora. '
      'Tente novamente em alguns instantes.';

  /// A conexão segura não pôde ser estabelecida.
  ///
  /// Nada de certificado, TLS ou handshake: quem entende esses termos não
  /// precisa que a tela os repita, e quem não entende fica sem saber o que
  /// fazer com eles.
  static const secureConnectionFailed =
      'Não foi possível estabelecer uma conexão segura. '
      'Tente novamente mais tarde.';

  /// O próprio aplicativo cancelou.
  ///
  /// Normalmente ninguém vê esta frase — a tela que cancelou já saiu. Ela
  /// existe para o caso de alguém insistir em mostrar o erro mesmo assim.
  static const cancelled = 'A ação foi interrompida.';

  /// O que não se soube classificar.
  static const unknown =
      'Não foi possível concluir esta ação. Tente novamente.';

  /// A leitura que não pôde ser feita.
  static const loadFailed =
      'Não foi possível carregar os dados. Tente novamente.';

  /// A atualização que falhou **sobre dados que já estão na tela**.
  ///
  /// Diferente de [loadFailed] de propósito: aqui existe conteúdo visível, e a
  /// mensagem informa sem apagar o que a pessoa já tinha.
  static const refreshFailed = 'Não foi possível atualizar os dados.';

  /// O resultado que o aplicativo não conseguiu confirmar.
  ///
  /// É o caso mais delicado do produto: a requisição saiu, o servidor pode ter
  /// processado, e a resposta não voltou. Dizer "falhou" seria mentir metade
  /// das vezes — e levar alguém a repetir uma conclusão de atendimento que já
  /// aconteceu. A frase pede reconciliação antes de nova tentativa.
  static const resultUnknown =
      'Não foi possível confirmar o resultado desta ação. '
      'Atualize os dados antes de tentar novamente.';

  /// A ação que precisa de rede para acontecer.
  static const requiresConnection =
      'Esta ação precisa de conexão com a internet.';
}
