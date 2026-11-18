import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BackgroundJobQueue } from '../modules/jobs/background-job.queue';
import {
  JOB_QUEUES,
  type JobQueue,
} from '../modules/jobs/background-job.types';
import { validateReleaseEnvironment } from '../release-environment';

async function main() {
  const [action, queue, id] = process.argv.slice(2);
  const queues = Object.values(JOB_QUEUES);
  if (
    action !== 'snapshot' &&
    (!queues.includes(queue as JobQueue) ||
      (action !== 'dead' &&
        !(
          action === 'replay' &&
          /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id ?? '')
        )))
  ) {
    throw new Error('Invalid queue operation');
  }
  // Control-plane command, with the same restricted DSN. Never start consumers.
  process.env.ORBIT_PROCESS_ROLE = 'api';
  validateReleaseEnvironment(process.env);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const jobs = app.get(BackgroundJobQueue);
    if (action === 'snapshot')
      console.log(JSON.stringify(await jobs.snapshot(queues)));
    if (action === 'dead') {
      const rows = await jobs.deadLetters(queue as JobQueue);
      const known =
        /^(?:(?:DATABASE_UNAVAILABLE|DATABASE_TIMEOUT|TRANSACTION_FAILURE|CONNECTION_FAILURE|INTERNAL_ERROR)(?::[A-Z0-9_]{1,40})?|JOB_SCOPE_INVALID|JOB_LEASE_EXPIRED|PERMANENT_JOB_ERROR|UNCLASSIFIED_FAILURE)$/;
      console.log(
        JSON.stringify(
          rows.map((row) => ({
            ...row,
            lastError:
              row.lastError && known.test(row.lastError) ? row.lastError : null,
          })),
        ),
      );
    }
    if (action === 'replay') {
      const accepted = await jobs.replayDead(id!, queue as JobQueue);
      console.log(JSON.stringify({ event: 'job_replay', queue, id, accepted }));
      if (!accepted) process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

void main().catch(() => {
  console.error('Não foi possível executar a operação na fila.');
  process.exitCode = 1;
});
