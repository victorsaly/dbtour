// Starts SQL Server in Docker, runs the mssql e2e test against it, stops it. Needs Docker; nothing else.
import { execSync, spawnSync } from 'node:child_process';

const container = 'dbtour-e2e-mssql';
const password = 'DbTour!e2e-' + Math.random().toString(36).slice(2, 10);
// SQL Server takes a while to accept logins after the container starts; polled, not slept for.
const readyWaitSeconds = 90;

try {
  execSync('docker info', { stdio: 'ignore' });
} catch {
  console.error('Docker is not running. Start it, then run npm run e2e:mssql again.');
  process.exit(2);
}
spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
execSync(
  `docker run -d --name ${container} -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD='${password}' -p 14333:1433 mcr.microsoft.com/mssql/server:2022-latest`,
  { stdio: 'inherit' },
);
const connection = `Server=localhost,14333;Database=master;User Id=sa;Password=${password};TrustServerCertificate=True`;
try {
  const started = Date.now();
  for (;;) {
    const probe = spawnSync('node', ['-e', `import('mssql').then(async ({ default: sql }) => { const p = await new sql.ConnectionPool(process.env.C).connect(); await p.close(); })`], { env: { ...process.env, C: connection }, stdio: 'ignore' });
    if (probe.status === 0) break;
    if ((Date.now() - started) / 1000 > readyWaitSeconds) throw new Error(`SQL Server did not accept a login within ${readyWaitSeconds}s`);
    spawnSync('sleep', ['2']);
  }
  const result = spawnSync('node', ['--test', 'packages/source-mssql/test/e2e/mssql.e2e.ts'], { env: { ...process.env, DBTOUR_E2E_MSSQL: connection }, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  spawnSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
}
