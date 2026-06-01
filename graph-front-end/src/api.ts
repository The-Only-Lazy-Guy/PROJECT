import type { GraphSummary, HealthResponse, RunRequest, RunResponse, RunStreamEvent } from './types';

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { detail: text };
    }
  }
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'detail' in payload
      ? (payload as { detail: unknown }).detail
      : payload;
    const message = typeof detail === 'string'
      ? detail
      : detail && typeof detail === 'object' && 'message' in detail
        ? String((detail as { message: unknown }).message)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function getHealth(): Promise<HealthResponse> {
  return parseResponse<HealthResponse>(await fetch('/api/health'));
}

export async function getGraphs(): Promise<GraphSummary[]> {
  const payload = await parseResponse<{ graphs: GraphSummary[] }>(await fetch('/api/graphs'));
  return payload.graphs;
}

export async function runGraphAgent(request: RunRequest): Promise<RunResponse> {
  return parseResponse<RunResponse>(
    await fetch('/api/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
}

function parseSseBlock(block: string): RunStreamEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  try {
    return {
      event: event as RunStreamEvent['event'],
      data: JSON.parse(dataLines.join('\n')) as Record<string, unknown>,
    };
  } catch {
    return {
      event: event as RunStreamEvent['event'],
      data: { raw: dataLines.join('\n') },
    };
  }
}

export async function runGraphAgentV4(request: RunRequest): Promise<RunResponse> {
  return parseResponse<RunResponse>(
    await fetch('/api/runs/v4', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    }),
  );
}

export async function streamGraphAgent(
  request: RunRequest,
  onEvent: (event: RunStreamEvent) => void,
): Promise<RunResponse> {
  const response = await fetch('/api/runs/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok || !response.body) {
    return parseResponse<RunResponse>(response);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalRun: RunResponse | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseSseBlock(block);
      if (event) {
        onEvent(event);
        if (event.event === 'final') {
          finalRun = event.data as unknown as RunResponse;
        }
        if (event.event === 'error') {
          throw new Error(String(event.data.message ?? 'Streaming run failed'));
        }
      }
      boundary = buffer.indexOf('\n\n');
    }
  }

  const tail = buffer.trim();
  if (tail) {
    const event = parseSseBlock(tail);
    if (event) {
      onEvent(event);
      if (event.event === 'final') {
        finalRun = event.data as unknown as RunResponse;
      }
      if (event.event === 'error') {
        throw new Error(String(event.data.message ?? 'Streaming run failed'));
      }
    }
  }

  if (!finalRun) {
    throw new Error('Stream ended before final run payload arrived');
  }
  return finalRun;
}
