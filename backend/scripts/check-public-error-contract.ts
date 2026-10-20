import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PUBLIC_ERROR_CATALOG } from '../src/common/public-errors';

const forbiddenPublicCopy =
  /Prisma|P2002|SQL|constraint|stack|node_modules|postgres|RLS|capabilit|exception|repository/i;

for (const definition of PUBLIC_ERROR_CATALOG.values()) {
  if (forbiddenPublicCopy.test(definition.message)) {
    throw new Error(`Technical term in public error ${definition.code}`);
  }
}

const filter = readFileSync(
  resolve('src/common/foundation-exception.filter.ts'),
  'utf8',
);
if (/exception\.message/.test(filter)) {
  throw new Error('The global filter must not serialize exception.message');
}

const webCopy = readFileSync(
  resolve('../frontend/src/lib/error-copy.ts'),
  'utf8',
);
if (
  /TRANSLATED|looksInternal|Customer document|must be an email/.test(webCopy)
) {
  throw new Error('Frontend still compensates backend messages by string');
}

const mobileLogin = readFileSync(
  resolve(
    '../mobile/lib/features/authentication/presentation/login_screen.dart',
  ),
  'utf8',
);
if (/message\.toLowerCase\(\)\.contains\(['"]mfa['"]\)/.test(mobileLogin)) {
  throw new Error('Flutter still branches on the backend message');
}

console.log(
  JSON.stringify({
    stage: 'public-error-contract-guard',
    publicCodes: PUBLIC_ERROR_CATALOG.size,
    backendMessageMatchingInWeb: 0,
    backendMessageMatchingInFlutter: 0,
  }),
);
