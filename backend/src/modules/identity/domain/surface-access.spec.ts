/**
 * Em que superfície cada conta entra.
 *
 * O buraco que estes testes trancam: um técnico operacional — que existe para
 * o aplicativo de campo e recebe uma senha temporária do dono — entrava no
 * painel web e lia a organização inteira. Nada no backend o impedia.
 */
import {
  SurfaceNotAllowedException,
  allowsSurface,
  normalizeSurface,
  surfacesOf,
} from './surface-access';
import type { IdentityUser } from '../infrastructure/identity.repository';

type Papel = { allowedSurfaces: string[] } | null;

function usuario(options: {
  organizacao?: Papel;
  unidades?: Papel[];
  plataforma?: Papel[];
  owner?: boolean;
}): IdentityUser {
  return {
    organizationMemberships: options.organizacao
      ? [{ role: options.organizacao }]
      : [],
    businessUnitMemberships: (options.unidades ?? []).map((role) => ({ role })),
    platformRoleAssignments: (options.plataforma ?? []).map((role) => ({
      role,
    })),
    isOrganizationOwner: options.owner ?? false,
  } as unknown as IdentityUser;
}

describe('normalizeSurface', () => {
  it('reconhece as três superfícies, em qualquer caixa', () => {
    expect(normalizeSurface('mobile')).toBe('MOBILE');
    expect(normalizeSurface('API')).toBe('API');
    expect(normalizeSurface('web')).toBe('WEB');
  });

  /**
   * O desconhecido vira `WEB`, e não "qualquer uma".
   *
   * Um cliente que não declare o que é está pedindo pela porta mais exposta, e
   * é essa que precisa ser conferida. Tratar o vazio como coringa deixaria a
   * restrição inteira de fora com um campo omitido.
   */
  it('trata ausente e desconhecido como WEB', () => {
    expect(normalizeSurface(undefined)).toBe('WEB');
    expect(normalizeSurface('')).toBe('WEB');
    expect(normalizeSurface('DESKTOP')).toBe('WEB');
  });
});

describe('surfacesOf', () => {
  it('usa o papel organizacional e mantém papel de unidade somente como escopo', () => {
    const pessoa = usuario({
      organizacao: { allowedSurfaces: ['MOBILE'] },
      unidades: [{ allowedSurfaces: ['WEB'] }],
    });
    expect([...surfacesOf(pessoa)]).toEqual(['MOBILE']);
  });

  it('normaliza a caixa do que está gravado', () => {
    const pessoa = usuario({ organizacao: { allowedSurfaces: ['mobile'] } });
    expect(surfacesOf(pessoa).has('MOBILE')).toBe(true);
  });
});

describe('allowsSurface', () => {
  it('o técnico de campo entra no aplicativo', () => {
    const tecnico = usuario({ organizacao: { allowedSurfaces: ['MOBILE'] } });
    expect(allowsSurface(tecnico, 'MOBILE')).toBe(true);
  });

  it('e é recusado no painel web', () => {
    const tecnico = usuario({ organizacao: { allowedSurfaces: ['MOBILE'] } });
    expect(allowsSurface(tecnico, 'WEB')).toBe(false);
  });

  it('o dono entra nos dois', () => {
    const dono = usuario({
      organizacao: { allowedSurfaces: [] },
      owner: true,
    });
    expect(allowsSurface(dono, 'WEB')).toBe(true);
    expect(allowsSurface(dono, 'MOBILE')).toBe(true);
  });

  /**
   * O papel mais permissivo responde.
   *
   * Quem administra a matriz e também atende numa filial precisa do painel.
   * Negar porque **um** dos papéis é de campo trancaria justamente quem tem
   * mais acesso, não menos.
   */
  it('quem é administrador na matriz e técnico na filial entra na web', () => {
    const pessoa = usuario({
      organizacao: { allowedSurfaces: ['WEB', 'MOBILE'] },
      unidades: [{ allowedSurfaces: ['MOBILE'] }],
    });
    expect(allowsSurface(pessoa, 'WEB')).toBe(true);
  });

  it('quem não tem concessão explícita é recusado de forma fail-closed', () => {
    expect(allowsSurface(usuario({}), 'WEB')).toBe(false);
  });

  it('o administrador de plataforma entra pelo papel global', () => {
    const admin = usuario({ plataforma: [{ allowedSurfaces: ['WEB'] }] });
    expect(allowsSurface(admin, 'WEB')).toBe(true);
    expect(allowsSurface(admin, 'MOBILE')).toBe(false);
  });
});

describe('SurfaceNotAllowedException', () => {
  /**
   * `403`, e não `401`: a credencial está certa.
   *
   * Repetir a senha não resolve, e um `401` mandaria o cliente de volta para o
   * login — num laço, porque a próxima tentativa erra igual.
   */
  it('responde 403 e diz onde a conta funciona', () => {
    const erro = new SurfaceNotAllowedException('WEB');
    expect(erro.getStatus()).toBe(403);
    expect(JSON.stringify(erro.getResponse())).toContain('SURFACE_NOT_ALLOWED');
  });
});
