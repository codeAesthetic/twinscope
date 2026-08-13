import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
} from 'react';

/**
 * Primitives matching reference/devdiff-mockup.html.
 *
 * Styling lives in styles/primitives.css and uses tokens only, so every one of
 * these works in both themes without a per-component colour.
 */

export type ChipVariant = 'default' | 'add' | 'del' | 'mod' | 'info' | 'acc';

/**
 * Extra props are forwarded to the span, so a caller can hang a `data-testid` or
 * an `aria-*` attribute on a chip. Without that, `<Chip data-testid="…">` compiled
 * and rendered fine while silently dropping the attribute — which is a spec that
 * cannot find an element it can see on screen.
 */
export function Chip({
  children,
  variant = 'default',
  ...rest
}: { children: ReactNode; variant?: ChipVariant } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className="dd-chip" data-variant={variant} {...rest}>
      {children}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost';
  size?: 'md' | 'sm';
};

export function Button({ variant = 'default', size = 'md', ...props }: ButtonProps) {
  return <button className="dd-btn" data-variant={variant} data-size={size} {...props} />;
}

export interface SegOption<T extends string> {
  value: T;
  label: string;
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly SegOption<T>[];
  value: T;
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className="dd-seg" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          type="button"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  children,
  pressed,
  onChange,
}: {
  children: ReactNode;
  pressed: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="dd-toggle"
      aria-pressed={pressed}
      onClick={() => onChange(!pressed)}
    >
      <span className="dd-toggle-box" aria-hidden="true">
        ✓
      </span>
      {children}
    </button>
  );
}

export function SearchInput({
  hint,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { hint?: string; ref?: Ref<HTMLInputElement> }) {
  return (
    <div className="dd-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M16.5 16.5L21 21" />
      </svg>
      <input type="search" ref={ref} {...props} />
      {hint !== undefined && <Kbd>{hint}</Kbd>}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="dd-kbd">{children}</span>;
}

export type FileKind = 'json' | 'code' | 'image' | 'folder' | 'md' | 'csv' | 'text' | 'web';

const FILE_LABEL: Record<FileKind, string> = {
  json: '{ }',
  code: 'TS',
  image: 'IMG',
  folder: 'DIR',
  md: 'MD',
  // v0.2.5 shipped the CSV engine and no badge for it, so every CSV comparison in
  // History and the Saved rail was labelled MD.
  csv: 'CSV',
  text: 'TXT',
  web: 'GIT',
};

export function FileTypeBadge({ kind, label }: { kind: FileKind; label?: string }) {
  return (
    <span className="dd-ftype" data-kind={kind} aria-label={`${kind} file`}>
      {label ?? FILE_LABEL[kind]}
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  /** For a setting that is a statement of fact rather than a choice. */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="dd-switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}
