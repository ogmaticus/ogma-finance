export class BodyLimitError extends Error {
  status = 413;
}
export async function readLimitedBody(request: Request, maxBytes: number) {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) > maxBytes)
    throw new BodyLimitError("Запрос слишком большой");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new BodyLimitError("Запрос слишком большой");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
