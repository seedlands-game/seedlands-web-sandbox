export async function prepare() {}

export async function write(item, context) {
  const response = await fetch(`${context.config.endpoint}/${encodeURIComponent(item.id)}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': context.idempotencyKey,
    },
    body: JSON.stringify(item),
    signal: context.signal,
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.code = response.status >= 500 ? 'TRANSIENT' : 'PERMANENT';
    throw error;
  }
  if (item.simulateUnknown) {
    const error = new Error('result unknown after remote commit');
    error.code = 'OUTCOME_UNKNOWN';
    throw error;
  }
}

export async function read(item, context) {
  const response = await fetch(`${context.config.endpoint}/${encodeURIComponent(item.id)}`, {
    signal: context.signal,
  });
  return response.json();
}

export async function verify(item, remote) {
  return remote.value === item.value;
}
