/**
 * Monta o contexto que os documentos premium imprimem.
 *
 * Fica fora dos renderers de propósito: eles são puros (mesma entrada, mesma
 * saída) e não conhecem banco. Aqui é onde as linhas do Prisma viram texto
 * pronto para impressão — CNPJ formatado, endereço em uma linha, data no fuso
 * de quem emite.
 *
 * ## Formatar é daqui, não do desenho
 *
 * Um renderer que recebesse `Date` e `documentNumber` cru precisaria saber o
 * fuso da unidade e a máscara de CNPJ. São regras do domínio brasileiro, e
 * duplicá-las em cada compositor de documento garantiria que o Recibo
 * formatasse diferente do PMOC.
 */
import { Injectable } from '@nestjs/common';
import type {
  DocumentContext,
  DocumentEquipment,
} from './renderers/pdf/kit/document-context';

type Linha = Record<string, unknown> | null | undefined;

@Injectable()
export class DocumentContextBuilder {
  build(source: {
    businessUnit?: Linha;
    customer?: Linha;
    operation?: Linha;
    logo?: { bytes: Buffer; mimeType: string };
    plan?: DocumentContext['plan'];
    maintenance?: DocumentContext['maintenance'];
    legalReference?: string;
  }): DocumentContext {
    const unidade = source.businessUnit ?? undefined;
    const timezone = this.texto(unidade?.timezone) ?? 'America/Recife';

    return {
      emitter: unidade
        ? {
            tradeName: this.texto(unidade.tradeName),
            legalName: this.texto(unidade.legalName),
            document: this.documento(
              unidade.documentType,
              unidade.documentNumber,
            ),
            address: this.endereco(unidade),
            cityState: this.cidadeUf(unidade.city, unidade.stateCode),
            phone: this.texto(unidade.phone),
            email: this.texto(unidade.email),
            website: this.texto(unidade.website),
            logo: source.logo?.bytes,
            logoMimeType: source.logo?.mimeType,
          }
        : undefined,
      customer: source.customer
        ? {
            name:
              this.texto(source.customer.tradeName) ??
              this.texto(source.customer.legalName),
            /* Só quando acrescenta: com fantasia ausente, `name` já é a razão
               social, e imprimi-la de novo logo ao lado seria repetição. */
            legalName: this.texto(source.customer.tradeName)
              ? this.texto(source.customer.legalName)
              : undefined,
            document: this.documento(
              source.customer.documentType,
              source.customer.documentNumber,
            ),
            address: this.enderecoDoAtendimento(source.operation),
            contactPhone: undefined,
          }
        : undefined,
      operation: source.operation
        ? {
            code: this.texto(source.operation.code),
            title: this.texto(source.operation.title),
            sector: this.texto(source.operation.sector),
            kind: this.texto(source.operation.kind),
            priority: this.texto(source.operation.priority),
            description: this.texto(source.operation.description),
            status: this.texto(source.operation.status),
            openedAt: this.dataHora(source.operation.createdAt, timezone),
            scheduledFor: this.dataHora(
              source.operation.scheduledStart,
              timezone,
            ),
            scheduledEnd: this.dataHora(
              source.operation.scheduledEnd,
              timezone,
            ),
            authorizedAt: this.dataHora(
              source.operation.authorizedAt,
              timezone,
            ),
            startedAt: this.dataHora(source.operation.startedAt, timezone),
            completedAt: this.dataHora(source.operation.completedAt, timezone),
            duration: this.duracao(
              source.operation.startedAt,
              source.operation.completedAt,
            ),
            fieldTechnician: this.texto(
              this.registro(source.operation.responsibleFieldTechnician)
                ?.displayName,
            ),
            startedBy: this.texto(
              this.registro(source.operation.startedBy)?.displayName,
            ),
            completedBy: this.texto(
              this.registro(source.operation.completedBy)?.displayName,
            ),
            auxiliaryTechnicians: this.auxiliares(source.operation),
          }
        : undefined,
      plan: source.plan,
      maintenance: source.maintenance,
      equipment: this.equipamentos(source.operation),
      legalReference: source.legalReference,
    };
  }

  /**
   * Os equipamentos do atendimento.
   *
   * O setor sai do atendimento e não do equipamento: um split é instalado uma
   * vez e atendido em muitos setores ao longo da vida — o que interessa no
   * documento é onde ele estava **naquele** atendimento. Quando o atendimento
   * não declara setor, o local cadastrado no equipamento responde.
   */
  /**
   * Quanto durou o atendimento, em palavras.
   *
   * Sai calculado e não como duas datas para o leitor subtrair: a duração é o
   * que entra em conversa de faturamento, e obrigar quem lê a fazer a conta é
   * onde as divergências nascem.
   */
  private duracao(inicio: unknown, fim: unknown): string | undefined {
    const de = this.paraData(inicio);
    const ate = this.paraData(fim);
    if (!de || !ate) return undefined;

    const minutos = Math.round((ate.getTime() - de.getTime()) / 60000);
    /* Conclusão antes do início é dado inconsistente; imprimir "-30 min"
       numa ordem de serviço assinada é pior que omitir. */
    if (minutos < 0) return undefined;
    if (minutos < 60) return `${minutos} min`;

    const horas = Math.floor(minutos / 60);
    const resto = minutos % 60;
    return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
  }

  private auxiliares(operation: Linha): readonly string[] | undefined {
    const lista = this.registro(operation)?.auxiliaryTechnicians;
    if (!Array.isArray(lista)) return undefined;
    const nomes = lista
      .map((item) =>
        this.texto(this.registro(this.registro(item)?.user)?.displayName),
      )
      .filter((nome): nome is string => Boolean(nome));
    return nomes.length > 0 ? nomes : undefined;
  }

  private equipamentos(operation: Linha): readonly DocumentEquipment[] {
    const vinculos = Array.isArray(operation?.assets) ? operation.assets : [];
    const setorDoAtendimento = this.texto(operation?.sector);

    return vinculos.flatMap((vinculo) => {
      const ativo = this.registro(this.registro(vinculo)?.asset);
      if (!ativo) return [];
      return [
        {
          sector: setorDoAtendimento ?? this.texto(ativo.location),
          name: this.texto(ativo.name),
          manufacturer: this.texto(ativo.manufacturer),
          model: this.texto(ativo.model),
          identifier:
            this.texto(ativo.identifier) ?? this.texto(ativo.serialNumber),
          capacity: this.capacidade(ativo.specifications),
        },
      ];
    });
  }

  /**
   * A capacidade, de dentro das especificações livres.
   *
   * `Asset.specifications` é JSON sem esquema — cada organização grava o que
   * quer. Procurar por algumas chaves conhecidas é honesto; inventar uma
   * conversão de unidade a partir de um número solto não seria.
   */
  private capacidade(specifications: unknown): string | undefined {
    const registro = this.registro(specifications);
    if (!registro) return undefined;
    for (const chave of ['capacidade', 'capacity', 'btu', 'btus', 'tr']) {
      const valor = registro[chave];
      if (typeof valor === 'string' && valor.trim()) return valor.trim();
      if (typeof valor === 'number') return String(valor);
    }
    return undefined;
  }

  private enderecoDoAtendimento(operation: Linha): string | undefined {
    const endereco = this.registro(operation?.customerAddress);
    if (!endereco) return undefined;
    const rotulo = this.texto(endereco.label);
    const logradouro = [
      this.texto(endereco.street),
      this.texto(endereco.number),
    ]
      .filter(Boolean)
      .join(', ');
    const partes = [
      rotulo,
      logradouro,
      this.texto(endereco.district),
      this.cidadeUf(endereco.city, endereco.stateCode),
    ].filter(Boolean);
    return partes.length ? partes.join(' · ') : undefined;
  }

  private endereco(unidade: Linha): string | undefined {
    const logradouro = [
      this.texto(unidade?.street),
      this.texto(unidade?.number),
    ]
      .filter(Boolean)
      .join(', ');
    const partes = [
      logradouro,
      this.texto(unidade?.district),
      this.cidadeUf(unidade?.city, unidade?.stateCode),
    ].filter(Boolean);
    return partes.length ? partes.join(' · ') : undefined;
  }

  private cidadeUf(city: unknown, stateCode: unknown): string | undefined {
    const cidade = this.texto(city);
    const uf = this.texto(stateCode);
    if (cidade && uf) return `${cidade}/${uf}`;
    return cidade ?? uf;
  }

  /**
   * CPF e CNPJ com máscara.
   *
   * Sem máscara, `21505237000102` é uma sequência que ninguém confere. Um
   * número com a quantidade errada de dígitos sai como veio: mascarar o que
   * não é CNPJ produziria um documento com aparência de válido.
   */
  private documento(tipo: unknown, numero: unknown): string | undefined {
    const digitos = this.texto(numero)?.replace(/\D/g, '');
    if (!digitos) return undefined;
    const rotulo = this.texto(tipo)?.toUpperCase();

    if (digitos.length === 14) {
      const formatado = digitos.replace(
        /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
        '$1.$2.$3/$4-$5',
      );
      return `CNPJ ${formatado}`;
    }
    if (digitos.length === 11) {
      const formatado = digitos.replace(
        /^(\d{3})(\d{3})(\d{3})(\d{2})$/,
        '$1.$2.$3-$4',
      );
      return `CPF ${formatado}`;
    }
    return rotulo ? `${rotulo} ${digitos}` : digitos;
  }

  private data(valor: unknown, timeZone: string): string | undefined {
    const data = this.paraData(valor);
    if (!data) return undefined;
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeZone,
    }).format(data);
  }

  private dataHora(valor: unknown, timeZone: string): string | undefined {
    const data = this.paraData(valor);
    if (!data) return undefined;
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone,
    }).format(data);
  }

  private paraData(valor: unknown): Date | undefined {
    if (valor instanceof Date) return valor;
    if (typeof valor === 'string') {
      const data = new Date(valor);
      return Number.isNaN(data.getTime()) ? undefined : data;
    }
    return undefined;
  }

  private texto(valor: unknown): string | undefined {
    return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;
  }

  private registro(valor: unknown): Record<string, unknown> | undefined {
    return valor && typeof valor === 'object' && !Array.isArray(valor)
      ? (valor as Record<string, unknown>)
      : undefined;
  }
}
