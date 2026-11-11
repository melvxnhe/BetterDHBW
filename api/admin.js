// /admin and /api/admin/<action>: the admin area (_admin.js)
import { vercel } from './_vercel.js';
import { handleAdmin } from './_admin.js';

export default vercel(handleAdmin);
