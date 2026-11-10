// GET /api/rapla/lectures/<id>/events: every event of one course, past ones included
import { respond } from '../../../_dhbw.js';

export default async function handler(req, res) {
  await respond(res, `/rapla/lectures/${req.query.id || ''}/events`);
}
