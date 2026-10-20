/**
 * Autorização da atribuição.
 *
 * ## O que não existia
 *
 * A preferência `settings.operations.requireAssignmentAuthorization` era
 * gravada desde a PR-12 e **nenhum ponto do backend a lia**. Ligar a chave não
 * escondia nada de ninguém — o técnico continuava vendo tudo pelo aplicativo e
 * pela API. A tela dizia isso com todas as letras, porque esconder só no
 * cliente daria uma falsa sensação de controle.
 *
 * ## A leitura é tolerante porque o campo é livre
 *
 * `Organization.settings` é `Json?` sem esquema nem validação: qualquer coisa
 * pode estar lá, inclusive o que uma versão anterior gravou. Só o booleano
 * `true` liga a exigência; qualquer outra coisa é o padrão, que é desligado.
 */

export const SETTINGS_NAMESPACE = 'operations';
export const SETTINGS_KEY = 'requireAssignmentAuthorization';

export function requiresAssignmentAuthorization(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object') return false;
  const escopo = (settings as Record<string, unknown>)[SETTINGS_NAMESPACE];
  if (!escopo || typeof escopo !== 'object') return false;
  return (escopo as Record<string, unknown>)[SETTINGS_KEY] === true;
}

/**
 * Este atendimento pode chegar a quem executa?
 *
 * Quando a organização não exige autorização, tudo passa — inclusive o que
 * nunca foi autorizado, porque naquele contexto o carimbo não quer dizer nada.
 * Quando exige, só o que tem carimbo.
 */
export function visibleToField(
  exigeAutorizacao: boolean,
  authorizedAt: Date | null,
): boolean {
  return !exigeAutorizacao || authorizedAt !== null;
}

/**
 * O filtro que a fila de campo aplica.
 *
 * Devolve o pedaço de `where` a espalhar na consulta. Vazio quando a
 * organização não exige — assim a consulta de quem não usa o recurso continua
 * exatamente a mesma, sem cláusula a mais para o planejador.
 */
export function fieldVisibilityFilter(exigeAutorizacao: boolean): {
  authorizedAt?: { not: null };
} {
  return exigeAutorizacao ? { authorizedAt: { not: null } } : {};
}
