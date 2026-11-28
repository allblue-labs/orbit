import { Worker } from 'node:worker_threads';
/** libheif's WASM decoder is CPU-heavy: isolate it from the NestJS event loop. */
export function decodeHeic(
  body: Buffer,
): Promise<{ width: number; height: number; data: Buffer }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
      const { parentPort, workerData } = require('node:worker_threads');
      const decoder = require(workerData.decoder);
      (async () => {
        const images = await decoder.all({ buffer: Buffer.from(workerData.bytes) });
        try {
          const image = images[0];
          if (!image || image.width * image.height > 40000000) throw new Error('Image too large');
          const decoded = await image.decode();
          parentPort.postMessage({ width: decoded.width, height: decoded.height, data: decoded.data });
        } finally { images.dispose(); }
      })().catch(() => { throw new Error('HEIC decode failed'); });
    `,
      {
        eval: true,
        workerData: { decoder: require.resolve('heic-decode'), bytes: body },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
      },
    );
    const timeout = setTimeout(() => {
      void worker.terminate();
      reject(new Error('HEIC decode timed out'));
    }, 15_000);
    worker.once(
      'message',
      (image: { width: number; height: number; data: Uint8Array }) => {
        clearTimeout(timeout);
        void worker.terminate();
        resolve({ ...image, data: Buffer.from(image.data) });
      },
    );
    worker.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once('exit', (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error('HEIC decode failed'));
    });
  });
}
