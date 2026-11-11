// Passwords: scrypt (N=2^15, r=8, p=1) with a random salt, compared in
// constant time, and refused when they are too short or known from a breach.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;
const MIN_LENGTH = 10;
const MAX_LENGTH = 200;

// "scrypt$15$8$1$<salt>$<key>": the parameters travel with the hash, so they can change later
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, SCRYPT);
  return `scrypt$15$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function checkPassword(password, stored) {
  const [alg, logN, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length,
    { N: 2 ** Number(logN), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// a real hash to compare against when the address is unknown, so both cases take as long
let dummy = null;
const dummyHash = async () => (dummy ??= await hashPassword(randomBytes(32).toString('base64url')));

// A login attempt: `stored` is the account's hash, or null when there is no
// such account. Both cases spend the same time.
export async function checkLogin(password, stored) {
  const ok = await checkPassword(password, stored ?? (await dummyHash()));
  return !!stored && ok;
}

// Is the password in a known data breach? Have I Been Pwned's range API only
// ever sees the first 5 characters of the SHA-1. If it can't be reached, the
// check is skipped rather than blocking sign-ups. Five seconds: with 2.5 s the
// check timed out whenever the machine was busy (the test suite starts three
// servers at once), and a sign-up that skips it is weaker than one that waits.
async function breached(password) {
  try {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const res = await fetch(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, {
      headers: { 'Add-Padding': 'true', 'User-Agent': 'dhbw-mannheim-stundenplan' }, signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const suffix = sha1.slice(5);
    return (await res.text()).split('\n').some((line) => line.startsWith(suffix) && Number(line.split(':')[1]) > 0);
  } catch {
    return false;
  }
}

// What is wrong with a new password, as a sentence for the person, or null.
export async function passwordProblem(password, email) {
  if (typeof password !== 'string') return 'Bitte ein Passwort eingeben.';
  const length = [...password].length;
  if (length < MIN_LENGTH) return `Das Passwort braucht mindestens ${MIN_LENGTH} Zeichen.`;
  if (length > MAX_LENGTH) return `Das Passwort darf höchstens ${MAX_LENGTH} Zeichen haben.`;
  if (email && password.trim().toLowerCase() === email) return 'Das Passwort darf nicht deine E-Mail-Adresse sein.';
  if (await breached(password)) return 'Dieses Passwort taucht in bekannten Datenlecks auf. Bitte nimm ein anderes.';
  return null;
}
