import { HttpStatus } from '@nestjs/common';
import {
  PUBLIC_ERROR_CATALOG,
  publicErrorDefinition,
} from './public-error.catalog';
import { PUBLIC_ERROR_CODES } from './public-error.read-models';

describe('Public error catalog', () => {
  it('has one deterministic definition for every public code', () => {
    expect(PUBLIC_ERROR_CATALOG.size).toBe(PUBLIC_ERROR_CODES.length);
    expect(new Set(PUBLIC_ERROR_CODES).size).toBe(PUBLIC_ERROR_CODES.length);
    for (const code of PUBLIC_ERROR_CODES) {
      const definition = publicErrorDefinition(code);
      expect(definition.code).toBe(code);
      expect(definition.message.trim()).not.toBe('');
      expect(definition.status).toBeGreaterThanOrEqual(400);
      expect(definition.status).toBeLessThanOrEqual(599);
    }
  });

  it('contains only product copy and no technical disclosure', () => {
    const messages = [...PUBLIC_ERROR_CATALOG.values()]
      .map(({ message }) => message)
      .join(' ');
    expect(messages).not.toMatch(
      /Prisma|P2002|SQL|constraint|stack|node_modules|postgres|RLS|capabilit|exception|repository/i,
    );
    expect(messages).not.toMatch(
      /\b(unauthorized|forbidden|not found|invalid|already|must|cannot|failed|unexpected)\b/i,
    );
  });

  it('has a safe generic fallback', () => {
    expect(publicErrorDefinition('INTERNAL_SERVER_ERROR')).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Não foi possível concluir a solicitação.',
    });
  });
});
