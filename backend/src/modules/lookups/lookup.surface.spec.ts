/**
 * As rotas de consulta precisam aceitar o aplicativo.
 *
 * ## O defeito que este teste existe para impedir
 *
 * `AuthorizationGuard` usa `['WEB','API']` quando o controlador não declara
 * superfície — por desenho, para que acesso móvel seja sempre explícito. O
 * efeito, se o decorador faltar aqui, é que a sessão do celular é recusada com
 * "Client surface is not allowed" — e o módulo todo perde a razão de existir: a
 * web já consultava CEP pelo BFF dela, e quem ficou sem busca de endereço foi
 * justamente o técnico em campo.
 *
 * É um defeito invisível: compila, passa em todo teste de serviço, e só aparece
 * com um celular na mão.
 */
import { SURFACES_KEY } from '../../decorators';
import { LookupController } from './lookup.controller';

describe('superfícies das consultas públicas', () => {
  const declaradas = Reflect.getMetadata(SURFACES_KEY, LookupController) as
    string[] | undefined;

  it('o controlador declara as superfícies', () => {
    expect(declaradas).toBeDefined();
  });

  it('aceita o aplicativo de campo', () => {
    expect(declaradas).toContain('MOBILE');
  });

  it('continua aceitando a web', () => {
    /* A web passa a poder usar a mesma rota em vez do BFF próprio: duas
       implementações da mesma consulta divergem na primeira mudança. */
    expect(declaradas).toContain('WEB');
  });
});
