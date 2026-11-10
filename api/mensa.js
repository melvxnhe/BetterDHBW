// GET /api/mensa: this week's dishes at the Mensaria Metropol and greenes²
import { respond } from './_dhbw.js';

export default async function handler(req, res) {
  await respond(res, '/mensa');
}
