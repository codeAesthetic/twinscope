import { useEffect, useMemo, useRef, useState } from 'react';
import { Kbd } from './primitives';
import { badgeKind, pathLine } from '../lib/historyView';
import { matches, SHORTCUTS, type Shortcut } from '../lib/shortcuts';
import { useAppStore } from '../stores/app';
import { useCompareStore } from '../stores/compare';
import { useHistoryStore, timeAgo } from '../stores/history';
import type { HistoryRow } from '../../../shared/channels';

/** Recents shown before filtering; enough to be useful, few enough to scan. */
const RECENT_LIMIT = 8;

interface Entry {
  id: string;
  group: 'Actions' | 'Recent';
  icon: string;
  label: string;
  detail: string;
  combo?: string;
  run: () => void;
}

/**
 * The command palette (MD §10) — every action by name, plus the recent
 * comparisons.
 *
 * Actions come from the shortcut registry rather than a second list, so a
 * binding cannot appear here with the wrong key, or be missing from one of the
 * two places it should be.
 */
export function CommandPalette({ onAction }: { onAction: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const rows = useHistoryStore((state) => state.rows);
  const refresh = useHistoryStore((state) => state.refresh);
  const reopen = useCompareStore((state) => state.reopen);

  const entries = useMemo(() => {
    const actions: Entry[] = SHORTCUTS.filter((shortcut) => shortcut.inPalette === true).map(
      (shortcut: Shortcut) => ({
        id: shortcut.id,
        group: 'Actions',
        icon: shortcut.icon ?? '›',
        label: shortcut.label,
        detail: shortcut.detail ?? '',
        combo: shortcut.combo,
        run: () => onAction(shortcut.id),
      }),
    );

    const recents: Entry[] = rows.slice(0, RECENT_LIMIT).map((row: HistoryRow) => ({
      id: `recent-${row.id}`,
      group: 'Recent',
      icon: ICON[badgeKind(row)] ?? '·',
      label: row.title,
      detail: `${timeAgo(row.openedAt)} · ${summarise(row)}`,
      run: () => void reopen(row),
    }));

    return [...actions, ...recents];
  }, [rows, reopen, onAction]);

  /** Subsequence match, so "cf" finds "Compare files…". */
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return entries;
    return entries.filter((entry) => fuzzy(`${entry.label} ${entry.detail}`.toLowerCase(), needle));
  }, [entries, query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (matches(event, '⌘K')) {
        event.preventDefault();
        setOpen((value) => !value);
        setQuery('');
        setCursor(0);
        void refresh();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [refresh]);

  // Closing on a screen change keeps the palette from hanging over the result of
  // the action it just ran. Subscribed imperatively rather than through a
  // selector: a store subscription fires outside render, where setting state is
  // an ordinary update rather than a cascading one.
  useEffect(() => {
    return useAppStore.subscribe((state, previous) => {
      if (state.view !== previous.view) setOpen(false);
    });
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  // Clamped rather than stored in range: the list changes under the cursor as
  // the query does, and a stale index would highlight nothing.
  const active = Math.min(cursor, Math.max(0, filtered.length - 1));

  const choose = (entry: Entry | undefined): void => {
    if (entry === undefined) return;
    setOpen(false);
    entry.run();
  };

  return (
    <div
      className="dd-pbackdrop"
      data-testid="command-palette"
      onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="dd-pal" role="dialog" aria-label="Command palette" aria-modal="true">
        <div className="dd-pin">
          <span aria-hidden="true">⌘</span>
          <input
            ref={inputRef}
            value={query}
            spellCheck={false}
            placeholder="Type a command or a comparison…"
            aria-label="Command"
            data-testid="palette-input"
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setCursor(Math.min(filtered.length - 1, active + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setCursor(Math.max(0, active - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(filtered[active]);
              }
            }}
          />
          <Kbd>Esc</Kbd>
        </div>

        <div className="dd-plist" role="listbox" aria-label="Commands">
          {GROUPS.map((group) => {
            const items = filtered.filter((entry) => entry.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <div className="dd-pgrp">{group}</div>
                {items.map((entry) => {
                  const index = filtered.indexOf(entry);
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      key={entry.id}
                      className="dd-pit"
                      data-current={index === active ? 'true' : 'false'}
                      data-testid={`palette-${entry.id}`}
                      onClick={() => choose(entry)}
                    >
                      <span className="dd-pic" aria-hidden="true">
                        {entry.icon}
                      </span>
                      <span className="dd-pcol">
                        <span className="dd-plabel">{entry.label}</span>
                        {entry.detail !== '' && <span className="dd-psub">{entry.detail}</span>}
                      </span>
                      {entry.combo !== undefined && (
                        <span className="dd-pkeys">
                          <Kbd>{entry.combo}</Kbd>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}

          {filtered.length === 0 && (
            <p className="dd-pempty" data-testid="palette-empty">
              Nothing matches “{query}”.
            </p>
          )}
        </div>

        <div className="dd-pft">
          <span>↑↓ navigate</span>
          <span>⏎ open</span>
          <span className="dd-spacer" />
          <span data-testid="palette-count">
            {filtered.length} of {entries.length}
          </span>
        </div>
      </div>
    </div>
  );
}

const GROUPS = ['Actions', 'Recent'] as const;

const ICON: Record<string, string> = {
  json: '{ }',
  code: 'TS',
  image: 'IMG',
  folder: 'DIR',
  md: 'MD',
  text: 'TXT',
  web: 'GIT',
};

function summarise(row: HistoryRow): string {
  const { added, removed, modified } = row.summary;
  const count = added + removed + modified;
  return `${count} change${count === 1 ? '' : 's'}`;
}

/** Characters in order, not necessarily adjacent. */
function fuzzy(haystack: string, needle: string): boolean {
  let at = 0;
  for (const character of needle) {
    if (character === ' ') continue;
    at = haystack.indexOf(character, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

export { pathLine };
