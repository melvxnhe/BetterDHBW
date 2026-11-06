// npm run db:migrate: creates the tables in the database at DATABASE_URL
// (also happens by itself on the first request; this is for doing it up front).
import { migrate } from '../api/_db.js';

try { process.loadEnvFile?.('.env'); } catch { /* no .env: use the environment */ }
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL fehlt (in .env oder in der Umgebung).');
  process.exit(1);
}
await migrate(undefined, { force: true });
console.log('Tabellen sind angelegt.');
