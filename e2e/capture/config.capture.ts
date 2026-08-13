import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { copyFixture, freshWorkDir } from './helpers/fixtures';
import { openPair, stage, still } from './helpers/stage';

/**
 * MEDIA-1 still for the config engine (v0.3.7).
 *
 * This is the one asset whose *subject* is an absence: the point of the picture is
 * that two real `.env` files are compared key by key and the credentials in them are
 * not on the screen. Masking happens in the engine, before the row model exists, so
 * the shot is only honest if the values are nowhere in the document — hence the
 * assertion against `page.content()` rather than against the view's text, which
 * would miss a value hiding in a `title` attribute.
 *
 * The values to check for are **read out of the fixtures at run time**, never
 * written here. A literal list was the first version and it was wrong twice over:
 * GitHub's push protection rejected the branch for containing a Stripe key, and a
 * spec that hard-codes a credential in order to prove credentials are hidden is
 * carrying the thing it exists to catch. Reading the fixture is also stronger — the
 * list cannot drift out of step with the file it is checking.
 */

/**
 * The keys the engine masks in these fixtures. One list drives both halves of the
 * assertion: that each row is badged as a secret, and that its value is nowhere in
 * the document.
 *
 * Not every value is a secret — `REDIS_URL` has no password in its authority and is
 * *meant* to be readable, so asserting the absence of every value in the file fails
 * on the values the picture is supposed to show.
 */
const SECRET_KEYS = [
  'DATABASE_URL',
  'STRIPE_SECRET_KEY',
  'JWT_SIGNING_SECRET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
] as const;

/**
 * The masked values, read from the fixtures at run time.
 *
 * Resolved here rather than importing the helper's private `FIXTURES_DIR`, and not
 * importing the engine's own `secretReason` either: `tsconfig.e2e.json` includes
 * `src/shared` but deliberately not `src/engines`, and a capture spec is not a
 * reason to widen that boundary.
 */
function maskedValues(...files: string[]): string[] {
  const dir = resolve(__dirname, 'fixtures', 'config');
  const values = files.flatMap((file) =>
    readFileSync(join(dir, `${file}.txt`), 'utf8')
      .split('\n')
      .map((line) => /^([A-Z0-9_]+)=(.+)$/.exec(line.trim()))
      .filter((m): m is RegExpExecArray => m !== null)
      .filter((m) => (SECRET_KEYS as readonly string[]).includes(m[1]!))
      .map((m) => m[2]!),
  );
  expect(values.length, 'the fixtures should carry a value for every secret key').toBe(
    SECRET_KEYS.length * files.length,
  );
  return values;
}

const credentials = maskedValues('staging.env', 'production.env');

test('stills: config diff with every credential masked by the engine', async () => {
  const harness = await stage();
  const dir = freshWorkDir('config');

  try {
    await openPair(harness, {
      before: copyFixture('config/staging.env', dir),
      after: copyFixture('config/production.env', dir),
    });
    await expect(harness.page.getByTestId('detected-bar')).toContainText('Config diff');
    await harness.page.getByTestId('compare-button').click();

    const view = harness.page.getByTestId('env-view');
    await expect(view).toBeVisible();
    await expect(view).toHaveAttribute('data-kind', 'env');

    // ---------- the masks are on screen, and they are labelled ----------
    for (const key of SECRET_KEYS) {
      await expect(harness.page.getByTestId(`env-secret-${key}`)).toBeVisible();
    }
    await expect(view).toContainText('•••••••');
    // The mask still answers the question: these two secrets differ.
    await expect(view.locator('[data-envkey="DATABASE_URL"]')).toHaveAttribute(
      'data-state',
      'changed',
    );
    // Non-secret keys are shown in full, so the shot shows both halves of the rule.
    await expect(view.locator('[data-envkey="LOG_LEVEL"]')).toContainText('debug');
    await expect(view.locator('[data-envkey="SMTP_HOST"]')).toHaveAttribute(
      'data-state',
      'removed',
    );

    // ---------- and no credential is anywhere in the document ----------
    const html = await harness.page.content();
    for (const credential of credentials) {
      expect(html, `a credential reached the DOM: ${credential}`).not.toContain(credential);
    }

    await still(harness, 'config-masked', { statusBar: false });

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});
