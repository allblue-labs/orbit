import { Injectable, Logger } from '@nestjs/common';
import {
  EntityNotFoundException,
  ServiceUnavailableException,
  ValidationException,
} from '../../exceptions';
import {
  isCompletePostalCode,
  isValidCnpj,
  onlyDigits,
} from './document-number';
import type {
  CompanyLookupReadModel,
  PostalAddressReadModel,
} from './lookup.read-models';

/** O único país que estes serviços conhecem. */
const BRASIL = 'Brasil';

/** Quanto esperar por um terceiro antes de desistir e deixar digitar à mão. */
const TIMEOUT_MS = 8_000;

const UF_PARA_ESTADO: Readonly<Record<string, string>> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AP: 'Amapá',
  AM: 'Amazonas',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais',
  PA: 'Pará',
  PB: 'Paraíba',
  PR: 'Paraná',
  PE: 'Pernambuco',
  PI: 'Piauí',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul',
  RO: 'Rondônia',
  RR: 'Roraima',
  SC: 'Santa Catarina',
  SP: 'São Paulo',
  SE: 'Sergipe',
  TO: 'Tocantins',
};

/**
 * Consultas públicas que poupam digitação em campo.
 *
 * ## O que este serviço não faz
 *
 * Não grava nada, não valida cadastro e não decide o que o formulário faz com
 * a resposta. É tradução: o que o provedor devolveu, no vocabulário que os
 * formulários do produto já usam.
 *
 * ## Indisponibilidade não impede cadastrar
 *
 * Os provedores são de terceiros e saem do ar. Quando isso acontece a resposta
 * é 503 com mensagem de produto — "preencha à mão" —, porque o cadastro tem de
 * continuar possível sem eles. Tratar a queda de um terceiro como erro do
 * produto travaria o técnico na casa do cliente.
 */
@Injectable()
export class LookupService {
  private readonly logger = new Logger(LookupService.name);

  /** O serviço público dos Correios. Trocá-lo é mudar só esta constante. */
  private readonly viaCep = 'https://viacep.com.br/ws';

  /** BrasilAPI, que publica o cadastro da Receita sem exigir credencial. */
  private readonly brasilApi = 'https://brasilapi.com.br/api/cnpj/v1';

  async postalCode(raw: string): Promise<PostalAddressReadModel> {
    const cep = onlyDigits(raw);
    if (!isCompletePostalCode(cep))
      throw new ValidationException(
        'Informe um CEP com oito dígitos',
        undefined,
        'INVALID_POSTAL_CODE',
      );

    const payload = await this.get<{
      cep?: string;
      logradouro?: string;
      bairro?: string;
      localidade?: string;
      uf?: string;
      erro?: boolean | string;
    }>(`${this.viaCep}/${cep}/json/`, 'postal-code');

    /* O ViaCEP responde 200 com `erro: true` para CEP inexistente — ausência
       não é falha, e precisa chegar como "confira o número". */
    if (payload.erro || !payload.localidade || !payload.uf)
      throw new EntityNotFoundException('CEP', cep);

    const uf = payload.uf.toUpperCase();
    return {
      postalCode: cep,
      street: payload.logradouro?.trim() ?? '',
      district: payload.bairro?.trim() ?? '',
      city: payload.localidade.trim(),
      state: UF_PARA_ESTADO[uf] ?? uf,
      stateCode: uf,
      country: BRASIL,
    };
  }

  async company(raw: string): Promise<CompanyLookupReadModel> {
    const cnpj = onlyDigits(raw);
    if (!isValidCnpj(cnpj))
      throw new ValidationException(
        'Informe um CNPJ válido',
        undefined,
        'INVALID_DOCUMENT_NUMBER',
      );

    const payload = await this.get<{
      razao_social?: string;
      nome_fantasia?: string;
      email?: string;
      ddd_telefone_1?: string;
      descricao_situacao_cadastral?: string;
      cep?: string;
      logradouro?: string;
      numero?: string;
      complemento?: string;
      bairro?: string;
      municipio?: string;
      uf?: string;
    }>(`${this.brasilApi}/${cnpj}`, 'company');

    /* Sem razão social não há o que preencher: o provedor respondeu algo que
       não é uma empresa. */
    const legalName = payload.razao_social?.trim();
    if (!legalName) throw new EntityNotFoundException('CNPJ', cnpj);

    const uf = payload.uf?.trim().toUpperCase() ?? '';
    return {
      documentNumber: cnpj,
      legalName,
      tradeName: this.texto(payload.nome_fantasia),
      email: this.texto(payload.email)?.toLowerCase() ?? null,
      phone: this.texto(payload.ddd_telefone_1),
      status: this.texto(payload.descricao_situacao_cadastral),
      address: {
        postalCode: onlyDigits(payload.cep ?? ''),
        street: payload.logradouro?.trim() ?? '',
        number: this.texto(payload.numero),
        complement: this.texto(payload.complemento),
        district: payload.bairro?.trim() ?? '',
        city: payload.municipio?.trim() ?? '',
        state: UF_PARA_ESTADO[uf] ?? uf,
        stateCode: uf,
        country: BRASIL,
      },
    };
  }

  /** `null` para vazio: string em branco preencheria o campo com nada. */
  private texto(value: string | undefined): string | null {
    const limpo = value?.trim();
    return limpo && limpo.length > 0 ? limpo : null;
  }

  private async get<T>(url: string, scope: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      this.logger.warn(JSON.stringify({ stage: 'lookup-unreachable', scope }));
      throw this.unavailable();
    }

    /**
     * 404 do provedor é ausência, não indisponibilidade.
     *
     * A BrasilAPI responde 404 para CNPJ não encontrado. Tratá-lo como queda
     * mandaria a pessoa "preencher à mão" quando o que ela precisa ouvir é que
     * o número está errado.
     */
    if (response.status === 404)
      throw new EntityNotFoundException('Consulta', scope);

    /**
     * Limite do provedor público.
     *
     * Distinto de "está fora do ar" porque a ação de quem leu é outra: aqui
     * esperar alguns instantes resolve, e a mensagem genérica de
     * indisponibilidade mandaria a pessoa digitar tudo à mão sem necessidade.
     * A BrasilAPI responde 429 com frequência na faixa gratuita.
     */
    if (response.status === 429) {
      this.logger.warn(JSON.stringify({ stage: 'lookup-throttled', scope }));
      throw new ServiceUnavailableException(
        'O serviço de consulta recebeu muitos pedidos agora. ' +
          'Tente em alguns instantes ou preencha os dados manualmente.',
        'LOOKUP_THROTTLED',
      );
    }
    if (!response.ok) {
      this.logger.warn(
        JSON.stringify({
          stage: 'lookup-rejected',
          scope,
          status: response.status,
        }),
      );
      throw this.unavailable();
    }

    try {
      return (await response.json()) as T;
    } catch {
      this.logger.warn(JSON.stringify({ stage: 'lookup-unparsable', scope }));
      throw this.unavailable();
    }
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException(
      'A consulta automática está indisponível. Preencha os dados manualmente.',
      'LOOKUP_UNAVAILABLE',
    );
  }
}
