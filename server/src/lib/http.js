export function ok(res, data, status = 200) {
  const requestId = res.locals.requestId;
  if (status === 204) return res.status(204).end();
  return res.status(status).json({ data, requestId });
}

export function fail(res, status, code, message, details) {
  const requestId = res.locals.requestId;
  const error = { code, message };
  if (details) error.details = details;
  return res.status(status).json({ error, requestId });
}
