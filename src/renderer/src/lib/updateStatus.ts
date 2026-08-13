import type { UpdateState } from '../../../shared/channels';

/**
 * One sentence describing the update check (v0.2.13), for the Settings row and
 * the launch notice.
 *
 * `now` is a parameter rather than a `Date.now()` call so the sentence is a pure
 * function of its inputs — the same reason the capture harness pins the clock.
 */
export function describeUpdate(state: UpdateState, now: number): string {
  switch (state.status) {
    case 'off':
      return 'No check has been made. TwinScope makes no network calls while this is off.';
    case 'checking':
      return 'Checking…';
    case 'available':
      return `${state.latest ?? 'A newer version'} is available. You have ${state.current}.`;
    case 'current':
      return `Up to date — ${state.current}${suffix(state.checkedAt, now)}.`;
    case 'error':
      return `Could not check${suffix(state.checkedAt, now)}: ${state.message ?? 'the update check failed'}.`;
  }
}

/** `, checked 5 minutes ago` — empty when nothing has completed yet. */
function suffix(checkedAt: string | undefined, now: number): string {
  if (checkedAt === undefined) return '';
  const at = Date.parse(checkedAt);
  if (Number.isNaN(at)) return '';

  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return ', checked just now';
  if (minutes === 1) return ', checked a minute ago';
  if (minutes < 60) return `, checked ${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return ', checked an hour ago';
  if (hours < 24) return `, checked ${hours} hours ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? ', checked yesterday' : `, checked ${days} days ago`;
}
