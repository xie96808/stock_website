let matchId = null;
let revision = -1;
let submitting = false;

export function resetMatchStore(id) {
  if (id === matchId) return;
  matchId = id;
  revision = -1;
  submitting = false;
}

/** Ignore an older snapshot. A missing revision still applies. */
export function noteRevision(id, next) {
  resetMatchStore(id);
  if (next == null) return true;
  if (Number(next) < revision) return false;
  revision = Number(next);
  return true;
}

export function setSubmitting(value) {
  submitting = value === true;
}

export function isSubmitting() {
  return submitting;
}
