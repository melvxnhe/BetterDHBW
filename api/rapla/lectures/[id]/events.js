// GET /api/rapla/lectures/<id>/events: every event of one course, past ones included
import { respond, COURSE_ID, HEADERS, eventsPath } from '../../../_dhbw.js';

export default async function handler(req, res) {
  const id = String(req.query.id || '');
  if (!COURSE_ID.test(id)) {
    for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
    res.status(400).send('{"error":"invalid course id"}');
    return;
  }
  await respond(res, eventsPath(id));
}
