import { Injectable } from '@nestjs/common';
import type { IssuedDocumentQueryDto } from './issued-document.dto';
import { IssuedDocumentRepository } from './issued-document.repository';
import type { IssuedDocumentReadModel } from './issued-document.read-models';

export interface IssuedDocumentListReadModel {
  data: readonly IssuedDocumentReadModel[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

/**
 * A central de documentos emitidos.
 *
 * Fina de propósito: a pergunta é de leitura, a união é do banco, e não há regra
 * de domínio a aplicar depois — o envelope de paginação é a única coisa que falta
 * à linha crua, e é o mesmo das outras listas para a tela não mudar de formato ao
 * ganhar uma origem.
 */
@Injectable()
export class IssuedDocumentService {
  constructor(private readonly repository: IssuedDocumentRepository) {}

  async list(
    organizationId: string,
    query: IssuedDocumentQueryDto,
  ): Promise<IssuedDocumentListReadModel> {
    const { data, total } = await this.repository.page(organizationId, query);
    /* `ceil` já devolve 0 para total 0 — um caso especial aqui seria um ramo que
       nenhum teste consegue distinguir do geral. */
    const totalPages = Math.ceil(total / query.limit);
    return {
      data,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1,
      },
    };
  }
}
