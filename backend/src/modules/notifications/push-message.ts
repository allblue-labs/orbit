import { ValidationException } from '../../exceptions';

export interface TransactionalPushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}

/** FCM accepts string data only. Keep room below 4 KiB for server-owned routing fields. */
export function transactionalPushMessage(
  title: unknown,
  body: unknown,
  data: unknown,
): TransactionalPushMessage {
  if (
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > 120 ||
    typeof body !== 'string' ||
    !body.trim() ||
    body.length > 240 ||
    typeof data !== 'object' ||
    data === null ||
    Array.isArray(data)
  )
    throw new ValidationException(
      'Informe título, mensagem e dados válidos para a notificação.',
    );
  const reserved = new Set([
    'from',
    'gcm',
    'notificationId',
    'version',
    'organizationId',
    'tenantId',
    'eventType',
    'title',
    'body',
  ]);
  const entries = Object.entries(data);
  if (
    entries.length > 30 ||
    entries.some(
      ([key, value]) =>
        !key ||
        key.length > 64 ||
        reserved.has(key) ||
        key.startsWith('google') ||
        key.startsWith('gcm.') ||
        typeof value !== 'string',
    )
  )
    throw new ValidationException(
      'Os dados da notificação devem conter somente textos e não podem substituir campos reservados.',
    );
  const values = Object.fromEntries(entries) as Record<string, string>;
  if (values.deepLink && !/^\/field\/[A-Za-z0-9/_:.-]+$/.test(values.deepLink))
    throw new ValidationException(
      'O destino interno da notificação é inválido.',
    );
  if (values.url) {
    try {
      const url = new URL(values.url);
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error();
    } catch {
      throw new ValidationException('O link da notificação deve usar HTTPS.');
    }
  }
  const result = { title: title.trim(), body: body.trim(), data: values };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 3_000)
    throw new ValidationException(
      'O conteúdo da notificação excede o tamanho permitido.',
    );
  return result;
}
