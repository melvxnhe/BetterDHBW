// /api/account/<action>: sign-up, login, settings and notes (_account.js)
import { vercel } from './_vercel.js';
import { handleAccount } from './_account.js';

export default vercel(handleAccount);
