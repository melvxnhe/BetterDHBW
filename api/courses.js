// GET /api/courses: every course in Rapla
import { respond } from './_dhbw.js';

export default async function handler(req, res) {
  await respond(res, '/courses');
}
