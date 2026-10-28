// The Vercel function: every /v1/* request is rewritten here (vercel.json) and handed to the router
// with its original url.
import { type Deps, handle } from '../src/app.js';
import { createProductionDeps } from '../src/production.js';

let deps: Deps | undefined;

// Built on first use, not at import, so a missing environment variable fails the request (500)
// instead of the whole function's cold start.
function serve(request: Request): Promise<Response> {
  deps ??= createProductionDeps();
  return handle(request, deps);
}

export const GET = serve;
export const POST = serve;
export const PUT = serve;
export const DELETE = serve;
export const OPTIONS = serve;
