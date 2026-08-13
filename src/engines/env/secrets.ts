/**
 * Secret masking (v0.3.7, A13) — the hard requirement of this engine.
 *
 * Two rules, and both are needed:
 *
 *  - **by key**, because `AWS_SECRET_ACCESS_KEY` announces itself;
 *  - **by value**, because `DATABASE_URL` does not, and carries a password inside it.
 *
 * Masking happens in the engine, *before* the row model exists. That is the whole
 * design: the renderer, the HTML report, the clipboard and the CLI all consume the
 * same rows, and a mask applied in the view would leak from the other three. The
 * fingerprint is a short digest of the value, which keeps the comparison answerable —
 * "these two secrets differ" is the useful half, and printing them is the half nobody
 * needs.
 *
 * The digest is **not** cryptographic and is not meant to be: it exists so that two
 * equal secrets look equal on screen. It is salted per comparison so a fingerprint
 * cannot be looked up against a rainbow table of common passwords, and truncated so it
 * cannot be brute-forced back into the value.
 */

/** Keys whose *name* says the value is a credential. */
const SECRET_KEY =
  /(secret|token|password|passwd|pwd|api[_-]?key|credential|auth|private[_-]?key|access[_-]?key|dsn|salt|signature)/i;

/** A URL with a password in its authority: `postgres://user:pw@host/db`. */
const URL_WITH_PASSWORD = /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i;

/** A JWT: three base64url runs separated by dots. */
const JWT = /^ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}$/;

const PEM = /-----BEGIN [A-Z ]*(PRIVATE KEY|CERTIFICATE)-----/;

/** A long run with no structure — the shape of a generated credential. */
const HIGH_ENTROPY = /^[A-Za-z0-9+/=_-]{24,}$/;

export type SecretReason = 'key' | 'url-password' | 'jwt' | 'pem' | 'entropy' | 'none';

/**
 * Whether this pair is a secret, and which rule said so.
 *
 * Reported rather than returned as a boolean because the view names the reason: a
 * masked value the reader cannot account for looks like a bug in the diff.
 */
export function secretReason(key: string, value: string): SecretReason {
  if (value === '') return 'none';
  if (SECRET_KEY.test(key)) return 'key';
  if (URL_WITH_PASSWORD.test(value)) return 'url-password';
  if (JWT.test(value)) return 'jwt';
  if (PEM.test(value)) return 'pem';
  // Entropy last: it is the loosest rule, and a long path or a base64 logo would
  // otherwise be reported as a credential.
  if (HIGH_ENTROPY.test(value) && !value.includes('/') && countClasses(value) >= 3) {
    return 'entropy';
  }
  return 'none';
}

/** Character classes present — a generated secret mixes at least three. */
function countClasses(value: string): number {
  let classes = 0;
  if (/[a-z]/.test(value)) classes += 1;
  if (/[A-Z]/.test(value)) classes += 1;
  if (/[0-9]/.test(value)) classes += 1;
  if (/[^A-Za-z0-9]/.test(value)) classes += 1;
  return classes;
}

/**
 * A short, salted, non-reversible fingerprint.
 *
 * FNV-1a rather than SHA-256 because there is no crypto in an engine (no host, no
 * node) and because a strong hash would imply a guarantee this does not make. What it
 * does guarantee is the only property the comparison needs: equal values produce
 * equal fingerprints, and the fingerprint carries no recoverable content.
 */
export function fingerprint(value: string, salt: string): string {
  let hash = 0x811c9dc5;
  const input = `${salt}:${value}`;
  for (let at = 0; at < input.length; at += 1) {
    hash = (hash ^ input.charCodeAt(at)) >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0').slice(0, 7);
}

export interface MaskedValue {
  /** What is safe to display, log, export and copy. */
  display: string;
  /** True when `display` is not the real value. */
  masked: boolean;
  reason: SecretReason;
}

/**
 * Masks one value, unless the caller has explicitly asked to see secrets.
 *
 * `reveal` is per-comparison and never persisted: a preference remembering "show
 * secrets" is a preference that puts a credential in the next screenshot.
 */
export function maskValue(
  key: string,
  value: string,
  options: { reveal: boolean; salt: string },
): MaskedValue {
  const reason = secretReason(key, value);
  if (reason === 'none') return { display: value, masked: false, reason };
  if (options.reveal) return { display: value, masked: false, reason };

  return {
    // The length is shown because a secret that changed length is a secret that was
    // regenerated rather than rotated to a same-format one — and the length of a
    // credential is not the credential.
    display: `••••••• ${fingerprint(value, options.salt)} (${value.length} chars)`,
    masked: true,
    reason,
  };
}

export const SECRET_REASON_LABEL: Record<SecretReason, string> = {
  key: 'the name says secret',
  'url-password': 'a password inside a URL',
  jwt: 'a JWT',
  pem: 'a PEM block',
  entropy: 'a long generated-looking value',
  none: '',
};
