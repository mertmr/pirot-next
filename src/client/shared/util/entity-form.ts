interface Identified {
  id?: number;
}

/**
 * Whether an update form may render the record its route addresses.
 *
 * An entity slice keeps the record it last loaded and starts with `loading` false, so a form gated
 * on `loading` alone mounts from that stale record, is torn down when the request starts, and is
 * rebuilt when it lands. Anything entered in between is discarded, and a submit can carry a mixture
 * of stale and typed values — a transfer whose two accounts reverted to their stored pair is
 * rejected as an invalid payment, which reads as random server failure.
 *
 * Readiness is therefore derived from the record itself rather than from the request: the form waits
 * for the record this route names and, once that is present, stays mounted through any later
 * refetch. Navigating to a different record correctly unmounts it, because the record no longer
 * matches. A request that fails leaves the slice loading, so an unreachable record keeps showing the
 * loading notice exactly as before.
 */
export function isEntityFormReady(entity: Identified | undefined, id: string | undefined, isNew: boolean): boolean {
  return isEntityFormReadyFor(entity, 'id', id, isNew);
}

/**
 * The same readiness test for a route keyed by something other than the numeric id, such as a login.
 *
 * The hazard is identical and the fix is the same: a form that mounts before its record arrives is
 * mounted from whatever the slice last held, and any parent re-render discards what has been typed.
 */
export function isEntityFormReadyFor<T extends object>(
  entity: T | undefined,
  field: string,
  routeKey: string | undefined,
  isNew: boolean,
): boolean {
  if (isNew) return true;
  const value = (entity as Record<string, unknown> | undefined)?.[field];
  return value !== undefined && value !== null && String(value) === String(routeKey);
}
