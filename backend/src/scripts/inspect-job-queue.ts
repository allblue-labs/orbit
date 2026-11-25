import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BackgroundJobQueue } from '../modules/jobs/background-job.queue';
import {
  JOB_QUEUES,
  type JobQueue,
} from '../modules/jobs/background-job.types';
import { validateReleaseEnvironment } from '../release-environment';
import { processRole } from '../runtime/process-role';

async function main() {
  const [action, queue] = process.argv.slice(2);
  const queues = Object.values(JOB_QUEUES);
  if (
    action !== 'snapshot' &&
    (action !== 'dead' || !queues.includes(queue as JobQueue))
  )
    throw new Error('Invalid queue operation');
  const role = processRole();
  if (
    process.env.NODE_ENV === 'production' &&
    role !== 'worker' &&
    role !== 'documents'
  )
    throw new Error('Queue inspection requires a consumer role.');
  // The connection keeps the consumer DB role, while this context only reads.
  process.env.JOBS_WORKER_ENABLED = 'false';
  process.env.BILLING_EVENTS_WORKER_ENABLED = 'false';
  validateReleaseEnvironment(process.env);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const jobs = app.get(BackgroundJobQueue);
    if (action === 'snapshot') {
      console.log(JSON.stringify(await jobs.snapshot(queues)));
    } else {
      const rows = await jobs.deadLetters(queue as JobQueue);
      const safe =
        /^(?:(?:DATABASE_UNAVAILABLE|DATABASE_TIMEOUT|TRANSACTION_FAILURE|CONNECTION_FAILURE|INTERNAL_ERROR)(?::[A-Z0-9_]{1,40})?|JOB_SCOPE_INVALID|JOB_LEASE_EXPIRED|JOB_TIMEOUT|PERMANENT_JOB_ERROR|UNCLASSIFIED_FAILURE)$/;
      console.log(
        JSON.stringify(
          rows.map((row) => ({
            ...row,
            lastError:
              row.lastError && safe.test(row.lastError) ? row.lastError : null,
          })),
        ),
      );
    }
  } finally {
    await app.close();
  }
}

void main().catch(() => {
  console.error(
    'Inspeção indisponível. Para reprocessar, use a API administrativa.',
  );
  process.exitCode = 1;
});
