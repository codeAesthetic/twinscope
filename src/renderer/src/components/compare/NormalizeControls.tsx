import { useState } from 'react';
import { Switch } from '../primitives';
import { useCompareStore } from '../../stores/compare';
import {
  MAX_CUSTOM_RULES,
  normalizeOptionsFrom,
  type CustomRule,
  type NormalizeOptions,
} from '../../../../engines/normalize';

/**
 * The normalisation rules, as one control panel (v0.2.6).
 *
 * Shared by every view whose engine takes them — the text diff, the structural
 * tree (JSON/YAML/XML) and the table — because the rules are the same rules. A
 * per-view copy would drift, and worse, would let two views describe the same
 * option differently.
 *
 * Every change goes through `compare.setOptions`, which **re-runs the engine**.
 * That is the whole point: normalisation changes the counts, so the counts have to
 * come back from the engine rather than be filtered here (Rule 3).
 */
export function NormalizeControls({
  suppressed,
  notes,
}: {
  suppressed: number;
  /**
   * The engine's notes, for a view with no Explain section of its own (v0.2.8).
   *
   * The suppressed line below has always ended "listed under Explain", which was
   * true in the JSON view and nowhere else. The text view needs it for more than
   * tidiness now: large-file mode's caps and its byte-exact anchoring are claims
   * about what the comparison did **not** do, and those have to be on screen.
   */
  notes?: readonly string[];
}) {
  const storeOptions = useCompareStore((state) => state.options);
  const setOptions = useCompareStore((state) => state.setOptions);
  const options = normalizeOptionsFrom(storeOptions['normalize']);

  const patch = (next: Partial<NormalizeOptions>): void => {
    void setOptions({ normalize: { ...options, ...next } });
  };

  return (
    <div className="dd-normpanel" data-testid="normalize-controls">
      <div className="dd-opthd">Ignore noise</div>

      <Rule
        title="Timestamps"
        detail="Any date or date-time, wherever it appears."
        checked={options.timestamps}
        onChange={(next) => patch({ timestamps: next })}
        testId="norm-timestamps"
      />
      <Rule
        title="UUIDs"
        detail="Regenerated identifiers."
        checked={options.uuids}
        onChange={(next) => patch({ uuids: next })}
        testId="norm-uuids"
      />
      <Rule
        title="Hashes"
        detail="Hex runs of 32 characters or more."
        checked={options.hashes}
        onChange={(next) => patch({ hashes: next })}
        testId="norm-hashes"
      />

      <div className="dd-opthd">Tolerances</div>
      <Tolerance
        label="Timestamps within"
        unit="ms"
        value={options.timestampToleranceMs}
        onChange={(next) => patch({ timestampToleranceMs: next })}
        testId="norm-timestamp-tolerance"
      />
      <Tolerance
        label="Numbers within"
        unit="±"
        value={options.numberTolerance}
        // The tolerance is the switch: a tolerance of zero means the rule is off,
        // so a separate checkbox would be one more thing to get out of step.
        onChange={(next) => patch({ numberTolerance: next, numbers: next > 0 })}
        testId="norm-number-tolerance"
      />

      <div className="dd-opthd">Custom rules</div>
      <CustomRules rules={options.custom} onChange={(next) => patch({ custom: next })} />

      {suppressed > 0 && (
        <p className="dd-normsuppressed" data-testid="normalize-suppressed">
          {suppressed} difference{suppressed === 1 ? '' : 's'} suppressed. Every rule that fired is
          listed under Explain.
        </p>
      )}

      {notes !== undefined && notes.length > 0 && (
        <>
          <div className="dd-opthd">Explain</div>
          <ul className="dd-notes" data-testid="normalize-notes">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Rule({
  title,
  detail,
  checked,
  onChange,
  testId,
}: {
  title: string;
  detail: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  testId: string;
}) {
  // Same markup as the JSON engine's own option rows, so the two panels read as
  // one panel when they sit next to each other.
  return (
    <div className="dd-optrow" data-testid={testId}>
      <div className="dd-opttxt">
        <div className="dd-optt">{title}</div>
        <div className="dd-optd">{detail}</div>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

function Tolerance({
  label,
  unit,
  value,
  onChange,
  testId,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (next: number) => void;
  testId: string;
}) {
  return (
    <label className="dd-normtol">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        step="any"
        data-testid={testId}
        value={value}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          onChange(Number.isFinite(parsed) && parsed >= 0 ? parsed : 0);
        }}
      />
      <span className="dd-normunit">{unit}</span>
    </label>
  );
}

/**
 * Custom patterns, committed on Enter or blur rather than per keystroke.
 *
 * Each commit re-runs the engine, and re-running on every character typed into a
 * regular expression would run the comparison against a dozen half-written
 * patterns — most of which do not compile.
 */
function CustomRules({
  rules,
  onChange,
}: {
  rules: readonly CustomRule[];
  onChange: (next: CustomRule[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = (): void => {
    const pattern = draft.trim();
    if (pattern === '' || rules.length >= MAX_CUSTOM_RULES) return;
    onChange([...rules, { pattern }]);
    setDraft('');
  };

  return (
    <div className="dd-normcustom">
      {rules.map((rule, index) => (
        <div key={`${rule.pattern}-${index}`} className="dd-normrule">
          <code data-testid={`norm-rule-${index}`}>{rule.pattern}</code>
          <button
            type="button"
            aria-label={`Remove rule ${rule.pattern}`}
            data-testid={`norm-remove-${index}`}
            onClick={() => onChange(rules.filter((_, at) => at !== index))}
          >
            ✕
          </button>
        </div>
      ))}

      {rules.length < MAX_CUSTOM_RULES ? (
        <input
          type="text"
          spellCheck={false}
          placeholder="regex, e.g. req_[a-z0-9]+"
          data-testid="norm-custom-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={add}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
      ) : (
        <p className="dd-optd">{MAX_CUSTOM_RULES} rules is the limit.</p>
      )}
    </div>
  );
}
