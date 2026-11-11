// npm run admin:hash: turns the admin password into the value for
// ADMIN_PASSWORD_HASH. The password is typed here and goes nowhere else: only
// its scrypt hash is stored, so neither this repository nor the hosting ever
// holds the password itself.
//
//   npm run admin:hash              asks for the password, prints the hash
//   npm run admin:hash -- --env     writes it into .env instead (for local use)
//   echo "…" | node scripts/admin-hash.mjs    reads the password from a pipe
//
// On Vercel: Settings → Environment Variables → ADMIN_PASSWORD_HASH (mark it
// "Sensitive"), then redeploy. Without the variable there is no /admin.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { hashPassword } from '../api/_password.js';

const MIN_LENGTH = 12;

// The password without showing it: from a pipe, or typed with the echo off.
function ask(prompt) {
  if (!process.stdin.isTTY) return new Promise((resolve) => { let all = ''; process.stdin.on('data', (d) => { all += d; }).on('end', () => resolve(all.replace(/\r?\n$/, ''))); });
  return new Promise((resolve, reject) => {
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let typed = '';
    const onData = (chunk) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(typed);
        }
        if (ch === '\x03') { process.stdout.write('\n'); return reject(new Error('abgebrochen')); } // Ctrl+C
        if (ch === '\x7f' || ch === '\b') typed = typed.slice(0, -1);
        else typed += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}

const password = await ask('Admin-Passwort: ').catch(() => process.exit(1));
if ([...password].length < MIN_LENGTH) {
  console.error(`Das Passwort braucht mindestens ${MIN_LENGTH} Zeichen.`);
  process.exit(1);
}
const line = `ADMIN_PASSWORD_HASH=${await hashPassword(password)}`;

if (process.argv.includes('--env')) {
  const old = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
  const rest = old.split('\n').filter((l) => !l.startsWith('ADMIN_PASSWORD_HASH=')).join('\n').replace(/\n+$/, '');
  writeFileSync('.env', `${rest ? `${rest}\n` : ''}${line}\n`);
  console.log('In .env gespeichert (die Datei wird nicht eingecheckt). Für Vercel den Wert hinter dem = dort eintragen.');
} else {
  console.log(line);
}
