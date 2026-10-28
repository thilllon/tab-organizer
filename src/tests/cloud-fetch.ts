/**
 * A stand-in for the sync server (GitHub issue #165) in cloud tests: answers each request from a
 * list of canned responses, and records what was asked.
 */

export interface SeenRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Answer = Response | Error | ((request: SeenRequest) => Response | Error);

export interface FakeFetch {
  fetch: typeof fetch;
  requests: SeenRequest[];
}

export function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Answers the requests in order; one answer left over is reused for every later request. */
export function fakeFetch(...answers: Answer[]): FakeFetch {
  const requests: SeenRequest[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const raw = init?.body;
    const request: SeenRequest = {
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof raw === 'string' ? JSON.parse(raw) : undefined,
    };
    requests.push(request);
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next === undefined) {
      throw new Error('fakeFetch: no answer left');
    }
    const answer = typeof next === 'function' ? next(request) : next;
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  };
  return { fetch: fetchImpl, requests };
}
