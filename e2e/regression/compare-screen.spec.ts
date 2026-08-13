import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch';
import { seedComparison } from '../helpers/seed';

/**
 * REGRESSION — HOME-2 / HOME-3: the Compare screen's layout.
 *
 * The geometry assertions exist because this screen must stay faithful to
 * reference/devdiff-mockup.html; a stray CSS change is otherwise invisible until
 * someone compares screenshots by hand.
 */
test('compare screen: hero, drop zones, quick cards and recent list', async () => {
  const harness = await launchApp();

  try {
    await expect(harness.page.getByRole('heading', { level: 1 })).toHaveText(
      'What do you want to compare?',
    );

    // --- both zones empty, with their call to action ---
    const before = harness.page.getByTestId('drop-before');
    const after = harness.page.getByTestId('drop-after');
    await expect(before).toHaveAttribute('data-state', 'empty');
    await expect(after).toHaveAttribute('data-state', 'empty');
    await expect(before).toContainText('Drop anything');
    await expect(before).toContainText('or paste with ⌘⇧V');
    await expect(before).toHaveAttribute('aria-label', 'BEFORE input');
    await expect(after).toHaveAttribute('aria-label', 'AFTER input');
    await expect(harness.page.getByTestId('swap-control')).toBeVisible();

    // --- mockup geometry: 1fr / 42px / 1fr, 172px tall, dashed, r=12 ---
    const geometry = await harness.page.evaluate(() => {
      const grid = getComputedStyle(document.querySelector('[data-testid="drop-pair"]')!);
      const zone = getComputedStyle(document.querySelector('[data-testid="drop-before"]')!);
      const columns = grid.gridTemplateColumns.split(' ');
      return {
        columnCount: columns.length,
        swapColumn: Math.round(Number.parseFloat(columns[1] ?? '0')),
        minHeight: zone.minHeight,
        borderStyle: zone.borderTopStyle,
        radius: zone.borderTopLeftRadius,
      };
    });
    expect(geometry.columnCount).toBe(3);
    expect(geometry.swapColumn).toBe(42);
    expect(geometry.minHeight).toBe('172px');
    expect(geometry.borderStyle).toBe('dashed');
    expect(geometry.radius).toBe('12px');

    // --- quick cards ---
    await expect(harness.page.getByTestId('quick-cards').locator('.dd-qcard')).toHaveCount(4);
    await expect(harness.page.getByTestId('quick-folders')).toContainText('Recursive tree diff');
    // Every card names the action it runs, and that name comes from the shortcut
    // registry — so a card and its keyboard shortcut cannot drift apart. What each one
    // actually does is asserted in the behavioural test below.
    await expect(harness.page.getByTestId('quick-folders')).toHaveAttribute(
      'data-action',
      'open-folders',
    );
    await expect(harness.page.getByTestId('quick-clipboard')).toHaveAttribute(
      'data-action',
      'paste-compare',
    );
    const quickColumns = await harness.page.evaluate(
      () =>
        getComputedStyle(
          document.querySelector('[data-testid="quick-cards"]')!,
        ).gridTemplateColumns.split(' ').length,
    );
    expect(quickColumns).toBe(4);

    // --- recent list ---
    const recent = harness.page.getByTestId('recent-list');
    // Empty until something has been compared — and it says so rather than
    // rendering an empty box.
    await expect(harness.page.getByTestId('recent-empty')).toBeVisible();

    await seedComparison(harness, 'alpha\nshared', 'beta\nshared');
    await expect(recent.locator('.dd-ritem')).toHaveCount(1);
    await expect(recent).toContainText('clipboard-a.txt ↔ clipboard-b.txt');

    // Name and path must stack — spans are inline, and this collapsed once.
    const rows = await harness.page.evaluate(() => {
      const name = document.querySelector('.dd-ritem-name')!;
      const path = document.querySelector('.dd-ritem-path')!;
      return {
        nameDisplay: getComputedStyle(name).display,
        stacked: path.getBoundingClientRect().top >= name.getBoundingClientRect().bottom,
        ellipsis: getComputedStyle(path).textOverflow,
      };
    });
    expect(rows.nameDisplay).toBe('block');
    expect(rows.stacked).toBe(true);
    expect(rows.ellipsis).toBe('ellipsis');

    // --- chips use tokens, never inline colours ---
    const chips = await harness.page.evaluate(() => {
      const all = [...document.querySelectorAll('[data-testid="recent-list"] .dd-chip')];
      return {
        count: all.length,
        allVariants: all.every((chip) => chip.getAttribute('data-variant') !== null),
        anyInline: all.some((chip) => chip.getAttribute('style') !== null),
        addColor: getComputedStyle(
          document.querySelector('[data-testid="recent-list"] .dd-chip[data-variant="add"]')!,
        ).color,
      };
    });
    // ＋1 added and －1 removed (the two lines share no words, so they do not
    // pair), plus the text engine's own line-count extra.
    expect(chips.count).toBe(3);
    expect(chips.allVariants).toBe(true);
    expect(chips.anyInline).toBe(false);
    expect(chips.addColor).toBe('rgb(63, 185, 80)'); // the --add token

    // --- the design-system gallery still renders every primitive ---
    await harness.page.evaluate(() => {
      window.location.hash = '#gallery';
    });
    await expect(harness.page.getByTestId('gallery')).toBeVisible();
    await expect(harness.page.getByTestId('drop-before')).toHaveAttribute('data-state', 'filled');
    await expect(harness.page.getByTestId('drop-before')).toContainText('users-v2.3.json');

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});

/**
 * REGRESSION — "Load sample comparison" shows the real product.
 *
 * It used to run the `demo` engine: a two-second sleep that rendered
 * "change 1 … change 11" above the note "Demo engine — no real comparison was
 * performed". Everything here asserts the opposite of that — a genuine text
 * diff, from the genuine engine, over content chosen to show what the view can
 * do. The demo engine still exists for `job-lifecycle`, just not on a button.
 */
test('compare screen: the sample button runs a real diff, not a simulation', async () => {
  const harness = await launchApp();

  try {
    await harness.page.getByTestId('sample-button').click();

    // The real text engine, in the real view.
    await expect(harness.page.getByTestId('text-diff')).toBeVisible({ timeout: 20_000 });
    await expect(harness.page.getByTestId('workspace-toolbar')).toContainText('Text');
    await expect(harness.page.getByTestId('demo-result-view')).toHaveCount(0);
    await expect(harness.page.getByTestId('status-detail')).not.toContainText('demo');

    // Content, not a synthetic count: these lines are in the sample.
    const stage = harness.page.getByTestId('text-diff');
    await expect(stage).toContainText('loadConfig');
    await expect(stage).toContainText('DEFAULT_OPTIONS');

    // The pair was shaped to produce all three kinds of change, so a summary
    // that reports only one means the sample stopped demonstrating anything.
    const strip = harness.page.getByTestId('summary-strip');
    for (const label of ['added', 'removed', 'modified']) {
      const chip = strip.getByText(new RegExp(`\\d+ ${label}`));
      await expect(chip).toBeVisible();
      expect(await chip.textContent()).not.toMatch(/^[+~-]?0 /);
    }

    await harness.screenshot('compare-sample');
    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    await harness.close();
  }
});

test('compare screen: every quick card runs the route it describes', async () => {
  // Wired 2026-08-13. Until then only Git did anything, and the other three were
  // buttons that looked clickable, did nothing, and blamed a shipped milestone in
  // their tooltip. Each card runs the *same* action as its keyboard shortcut, so this
  // spec is also what stops one of them growing a second implementation.
  const harness = await launchApp();
  let root: string | null = null;

  try {
    root = await mkdtemp(join(tmpdir(), 'twinscope-quick-'));
    const folderA = join(root, 'before');
    const folderB = join(root, 'after');
    await mkdir(folderA, { recursive: true });
    await mkdir(folderB, { recursive: true });
    await writeFile(join(folderA, 'kept.txt'), 'same\n');
    await writeFile(join(folderB, 'kept.txt'), 'same\n');
    const fileA = join(root, 'one.txt');
    const fileB = join(root, 'two.txt');
    await writeFile(fileA, 'one\n');
    await writeFile(fileB, 'two\n');

    const stub = async (paths: string[]): Promise<void> => {
      await harness.app.evaluate(({ dialog }, queued: string[]) => {
        let call = 0;
        dialog.showOpenDialog = () =>
          Promise.resolve({
            canceled: false,
            filePaths: [queued[call++ % queued.length] as string],
          });
      }, paths);
    };

    const before = harness.page.getByTestId('drop-before');
    const after = harness.page.getByTestId('drop-after');

    // ---------- Folders: the picker, twice, into both sides ----------
    await stub([folderA, folderB]);
    await harness.page.getByTestId('quick-folders').click();
    await expect(before).toContainText('before/');
    await expect(after).toContainText('after/');
    // The engine's own label, not a guess at it: `folderEngine.meta.label`.
    await expect(harness.page.getByTestId('detected-bar')).toContainText('File tree diff');

    // ---------- Screenshots: the file picker, same shape ----------
    await stub([fileA, fileB]);
    await harness.page.getByTestId('quick-screenshots').click();
    await expect(before).toContainText('one.txt');
    await expect(after).toContainText('two.txt');

    // ---------- Clipboard: one click per side, as the card says ----------
    await harness.page.getByTestId('clear-before').click();
    await harness.page.getByTestId('clear-after').click();
    await harness.app.evaluate(({ clipboard }) => clipboard.writeText('first paste'));
    await harness.page.getByTestId('quick-clipboard').click();
    await expect(before.locator('.dd-filecard')).toBeVisible();
    await expect(after.locator('.dd-filecard')).toHaveCount(0);

    await harness.app.evaluate(({ clipboard }) => clipboard.writeText('second paste'));
    await harness.page.getByTestId('quick-clipboard').click();
    await expect(after.locator('.dd-filecard')).toBeVisible();

    // ---------- Git: still the panel, and another card closes it again ----------
    await harness.page.getByTestId('quick-git').click();
    await expect(harness.page.getByTestId('git-panel')).toBeVisible();
    await stub([folderA, folderB]);
    await harness.page.getByTestId('quick-folders').click();
    await expect(harness.page.getByTestId('git-panel')).toHaveCount(0);

    expect(harness.errors, `errors:\n${harness.errors.join('\n')}`).toEqual([]);
  } finally {
    if (root !== null) await rm(root, { recursive: true, force: true });
    await harness.close();
  }
});
