/**
 * As consultas públicas de apoio ao cadastro.
 *
 * ## O que se garante aqui
 *
 * Que a resposta de um terceiro chega como **vocabulário do produto**, e que as
 * três situações diferentes não se confundem:
 *
 * ```text
 * número malformado  → recusa com mensagem (não gasta consulta)
 * não encontrado     → "confira o número"
 * provedor fora      → "preencha à mão" (503, e o cadastro continua possível)
 * ```
 *
 * Confundir as duas últimas é o defeito que importa: dizer "preencha à mão"
 * para um CEP errado faz a pessoa digitar um endereço que não existe; dizer
 * "não encontrado" para o ViaCEP fora faz a pessoa duvidar do próprio CEP.
 */
import { LookupService } from './lookup.service';
import {
  EntityNotFoundException,
  ServiceUnavailableException,
  ValidationException,
} from '../../exceptions';

/** Um CNPJ com dígitos verificadores válidos. */
const CNPJ = '19131243000197';

function responderCom(
  status: number,
  body: unknown,
  { invalidJson = false } = {},
) {
  globalThis.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () =>
      invalidJson ? Promise.reject(new Error('json')) : Promise.resolve(body),
  }) as never;
}

function falharRede() {
  globalThis.fetch = jest.fn().mockRejectedValue(new Error('offline')) as never;
}

describe('consulta de CEP', () => {
  const service = new LookupService();
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it('traduz a resposta para os campos do formulário', async () => {
    responderCom(200, {
      cep: '50030-230',
      logradouro: 'Avenida Rio Branco',
      bairro: 'Recife',
      localidade: 'Recife',
      uf: 'PE',
    });

    await expect(service.postalCode('50030-230')).resolves.toEqual({
      postalCode: '50030230',
      street: 'Avenida Rio Branco',
      district: 'Recife',
      city: 'Recife',
      state: 'Pernambuco',
      stateCode: 'PE',
      country: 'Brasil',
    });
  });

  /**
   * O país não vem do provedor — é consequência de a consulta ter dado certo.
   *
   * Sem ele, o formulário preenchia rua, bairro, cidade e estado e abandonava o
   * campo de país logo abaixo. Preenchido pela metade parece defeito, e é.
   */
  it('preenche o país, que o provedor não informa', async () => {
    responderCom(200, { localidade: 'Olinda', uf: 'PE' });

    const address = await service.postalCode('53000000');

    expect(address.country).toBe('Brasil');
  });

  /** Número malformado é erro de digitação: não vale gastar uma consulta. */
  it('recusa CEP incompleto sem consultar', async () => {
    const chamada = jest.fn();
    globalThis.fetch = chamada as never;

    await expect(service.postalCode('5003')).rejects.toBeInstanceOf(
      ValidationException,
    );
    expect(chamada).not.toHaveBeenCalled();
  });

  /**
   * O ViaCEP responde **200 com `erro: true`** para CEP inexistente.
   *
   * Tratar isso como sucesso devolveria um endereço vazio, e o formulário
   * apagaria o que a pessoa já havia digitado.
   */
  it('entende o 200 com erro como não encontrado', async () => {
    responderCom(200, { erro: true });

    await expect(service.postalCode('99999999')).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
  });

  /**
   * A flag `erro` manda, mesmo que venha dado junto.
   *
   * É a única afirmação explícita do provedor sobre existência. Ignorá-la e
   * decidir pelos campos faria o produto devolver um endereço que o próprio
   * provedor disse não existir.
   */
  it('a flag de erro vence o resto do corpo', async () => {
    responderCom(200, {
      erro: 'true',
      localidade: 'Cidade Inexistente',
      uf: 'PE',
      logradouro: 'Rua Nenhuma',
    });

    await expect(service.postalCode('99999999')).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
  });

  it('provedor fora do ar vira indisponibilidade, não ausência', async () => {
    falharRede();

    await expect(service.postalCode('50030230')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('resposta ilegível também é indisponibilidade', async () => {
    responderCom(200, null, { invalidJson: true });

    await expect(service.postalCode('50030230')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('consulta de CNPJ', () => {
  const service = new LookupService();
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it('traduz razão social, contato e endereço', async () => {
    responderCom(200, {
      razao_social: 'CLIMA NORTE LTDA',
      nome_fantasia: 'Clima Norte',
      email: 'CONTATO@CLIMANORTE.COM',
      ddd_telefone_1: '8132223333',
      descricao_situacao_cadastral: 'ATIVA',
      cep: '50030-230',
      logradouro: 'Avenida Rio Branco',
      numero: '120',
      complemento: 'Sala 4',
      bairro: 'Recife',
      municipio: 'Recife',
      uf: 'PE',
    });

    await expect(service.company(CNPJ)).resolves.toEqual({
      documentNumber: CNPJ,
      legalName: 'CLIMA NORTE LTDA',
      tradeName: 'Clima Norte',
      /* Minúsculo: é o que o cadastro guarda, e o provedor devolve em caixa alta. */
      email: 'contato@climanorte.com',
      phone: '8132223333',
      status: 'ATIVA',
      address: {
        postalCode: '50030230',
        street: 'Avenida Rio Branco',
        number: '120',
        complement: 'Sala 4',
        district: 'Recife',
        city: 'Recife',
        state: 'Pernambuco',
        stateCode: 'PE',
        country: 'Brasil',
      },
    });
  });

  /**
   * Campo em branco vira `null`, e não string vazia.
   *
   * O formulário usa a ausência para decidir se preenche: com `''` ele
   * sobrescreveria o que a pessoa já tinha digitado por nada.
   */
  it('campo vazio do provedor chega como ausente', async () => {
    responderCom(200, {
      razao_social: 'CLIMA NORTE LTDA',
      nome_fantasia: '   ',
      email: '',
      uf: 'PE',
    });

    const empresa = await service.company(CNPJ);

    expect(empresa.tradeName).toBeNull();
    expect(empresa.email).toBeNull();
    expect(empresa.phone).toBeNull();
  });

  /** Dígitos verificadores errados são erro de digitação, não ausência. */
  it('recusa CNPJ inválido sem consultar', async () => {
    const chamada = jest.fn();
    globalThis.fetch = chamada as never;

    await expect(service.company('11111111111111')).rejects.toBeInstanceOf(
      ValidationException,
    );
    expect(chamada).not.toHaveBeenCalled();
  });

  /**
   * 404 do provedor é ausência, não queda.
   *
   * Tratá-lo como indisponibilidade mandaria a pessoa "preencher à mão" quando
   * o que ela precisa ouvir é que o número está errado.
   */
  it('404 do provedor é não encontrado', async () => {
    responderCom(404, {});

    await expect(service.company(CNPJ)).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
  });

  it('sem razão social, não há empresa', async () => {
    responderCom(200, { uf: 'PE' });

    await expect(service.company(CNPJ)).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
  });

  it('500 do provedor é indisponibilidade', async () => {
    responderCom(503, {});

    await expect(service.company(CNPJ)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  /**
   * Limite do provedor é caso próprio.
   *
   * A BrasilAPI responde 429 com frequência na faixa gratuita — reproduzi isso
   * consultando de dentro do container. A mensagem genérica de
   * indisponibilidade mandaria a pessoa digitar tudo à mão; esperar alguns
   * instantes resolve, e é isso que ela precisa ouvir.
   */
  it('429 do provedor diz para tentar em instantes', async () => {
    responderCom(429, {});

    await expect(service.company(CNPJ)).rejects.toMatchObject({
      code: 'LOOKUP_THROTTLED',
    });
  });
});
