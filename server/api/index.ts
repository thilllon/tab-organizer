// The Vercel function: every /v1/* request is rewritten here (vercel.json) and handed to the router
// with its original url.
import { createServer } from '../src/production.js';

const serve = createServer();

export const GET = serve;
export const POST = serve;
export const PUT = serve;
export const DELETE = serve;
export const OPTIONS = serve;
