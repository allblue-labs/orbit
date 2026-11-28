import { statSync } from 'node:fs';

try {
  if (Date.now() - statSync('/tmp/orbit-worker-ready').mtimeMs > 180_000) {
    process.exitCode = 1;
  }
} catch {
  process.exitCode = 1;
}
