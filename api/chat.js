// /api/chat/<action>: reading and writing chat messages (_chat.js)
import { vercel } from './_vercel.js';
import { handleChat } from './_chat.js';

export default vercel(handleChat);
