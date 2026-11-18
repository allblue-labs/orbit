export function processRole() {
  const role = process.env.ORBIT_PROCESS_ROLE ?? 'combined';
  if (
    role === 'api' ||
    role === 'worker' ||
    role === 'documents' ||
    role === 'combined'
  )
    return role;
  throw new Error('ORBIT_PROCESS_ROLE inválido');
}

export function runsMaintenance() {
  const role = processRole();
  return (
    (role === 'worker' || role === 'combined') &&
    (process.env.JOBS_WORKER_ENABLED ?? 'true').trim() !== 'false'
  );
}
