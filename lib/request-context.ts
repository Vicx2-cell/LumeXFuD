const CORRELATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/

export interface RequestContext {
  requestId: string
  correlationId: string
}

/** Create unspoofable per-request evidence IDs and continue a safe trace ID. */
export function createRequestContext(headers: Headers): RequestContext {
  const requestId = crypto.randomUUID()
  const suppliedCorrelationId = headers.get('x-correlation-id')?.trim() ?? ''
  return {
    requestId,
    correlationId: CORRELATION_ID_RE.test(suppliedCorrelationId)
      ? suppliedCorrelationId
      : requestId,
  }
}

export function applyRequestContext<T extends Response>(response: T, context: RequestContext): T {
  response.headers.set('x-request-id', context.requestId)
  response.headers.set('x-correlation-id', context.correlationId)
  return response
}
