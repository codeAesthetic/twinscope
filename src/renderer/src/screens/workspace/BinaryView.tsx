import { Chip } from '../../components/primitives';
import { formatBytes, type BinaryDiffData } from '../../../../engines/binary';
import type { EngineViewProps } from './engineViews';

/**
 * Binary comparison (MVP-11) — a verdict card, not a diff.
 *
 * There is nothing readable to show, so the view shows what was actually
 * determined: sizes, hashes, and whether the bytes match. An honest card beats
 * a page of mojibake that looks like a diff and means nothing.
 */
export default function BinaryView({ result }: EngineViewProps) {
  const data = result.data as BinaryDiffData;

  return (
    <div className="dd-binary" data-testid="binary-view">
      <div className="dd-binary-verdict" data-identical={data.identical ? 'true' : 'false'}>
        <span className="dd-binary-glyph" aria-hidden="true">
          {data.identical ? '=' : '≠'}
        </span>
        <div>
          <h2>{data.identical ? 'These files are identical' : 'These files are different'}</h2>
          <p>
            {data.identical
              ? 'Same size, and the same content hash.'
              : data.sizeDelta === 0
                ? 'The same size, but the content hashes differ.'
                : `The after side is ${formatBytes(Math.abs(data.sizeDelta))} ${
                    data.sizeDelta > 0 ? 'larger' : 'smaller'
                  }.`}
          </p>
        </div>
      </div>

      <table className="dd-binary-table">
        <thead>
          <tr>
            <th />
            <th>Before</th>
            <th>After</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Name</th>
            <td>{data.before.name}</td>
            <td>{data.after.name}</td>
          </tr>
          <tr>
            <th scope="row">Size</th>
            <td>{formatBytes(data.before.size)}</td>
            <td data-testid="binary-after-size">{formatBytes(data.after.size)}</td>
          </tr>
          <tr>
            <th scope="row">SHA-256</th>
            <td>{data.before.hash ?? <Chip>not needed</Chip>}</td>
            <td>{data.after.hash ?? <Chip>not needed</Chip>}</td>
          </tr>
        </tbody>
      </table>

      <p className="dd-binary-note">
        {/* Rule 3: say what was compared, so "different" is never a mystery. */}
        {result.normalizationNotes.join(' ')}
      </p>
    </div>
  );
}
