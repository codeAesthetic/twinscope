import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { decodeText } from '../engines/encoding';
import { git } from '../shared/gitCli';
import type { GitHost, HostFs, ImageHost, Raster } from '../engines/types';

/**
 * The CLI's side of the engine contract (v0.2.2).
 *
 * This file is the whole argument for `EngineCtx` existing: the engines are not
 * recompiled, reconfigured or forked for the command line — they are handed three
 * different implementations of the same three interfaces, and the diff logic never
 * learns which host it is running in.
 *
 * `HostFs` is unscoped here, unlike the engine worker's (`scopedHostFs`). That is
 * deliberate and not a weakening: containment exists because a *renderer* can name
 * a path the user never chose. A CLI's caller already has the shell — there is
 * nothing to confine them to.
 */

export const cliHostFs: HostFs = {
  readText: async (path) => decodeText(new Uint8Array(await readFile(path))).text,

  readBytes: async (path) => new Uint8Array(await readFile(path)),

  listDir: async (path) => {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      path: join(path, entry.name),
      isDirectory: entry.isDirectory(),
      isSymlink: entry.isSymbolicLink(),
    }));
  },

  stat: async (path) => {
    const info = await stat(path);
    return { size: info.size, mtimeMs: info.mtimeMs };
  },

  hashFile: (path) =>
    new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(path);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(hash.digest('hex')));
    }),
};

export const cliGitHost: GitHost = {
  run: (repo, args) => git(repo, args),
};

/**
 * D7's image adapter: **PNG only**, via `pngjs`.
 *
 * One dependency, for the format every screenshot tool and every visual-regression
 * runner writes. `jpeg-js` would be a second dependency for a format nobody
 * screenshots into, so an unsupported image says so by name instead — a clear
 * refusal beats a silent wrong answer, and beats two dependencies.
 *
 * The renderer's decoder downscales on the GPU via `createImageBitmap`; here the
 * downscale is nearest-neighbour, which is the right trade for a pixel *count*:
 * an interpolating resample invents intermediate colours and inflates the number
 * of pixels reported as different.
 */
export const cliImageHost: ImageHost = {
  decode: async (bytes, maxDimension) => {
    const png = decodePng(bytes);
    const natural: [number, number] = [png.width, png.height];
    const longest = Math.max(png.width, png.height);
    const scale = longest > maxDimension ? maxDimension / longest : 1;

    if (scale === 1) {
      return {
        width: png.width,
        height: png.height,
        data: new Uint8ClampedArray(png.data),
        natural,
      };
    }

    const width = Math.max(1, Math.round(png.width * scale));
    const height = Math.max(1, Math.round(png.height * scale));
    const data = new Uint8ClampedArray(width * height * 4);

    for (let y = 0; y < height; y += 1) {
      const sourceY = Math.min(png.height - 1, Math.floor(y / scale));
      for (let x = 0; x < width; x += 1) {
        const sourceX = Math.min(png.width - 1, Math.floor(x / scale));
        const from = (sourceY * png.width + sourceX) * 4;
        const to = (y * width + x) * 4;
        data[to] = png.data[from] as number;
        data[to + 1] = png.data[from + 1] as number;
        data[to + 2] = png.data[from + 2] as number;
        data[to + 3] = png.data[from + 3] as number;
      }
    }

    return { width, height, data, natural };
  },

  encodePng: (raster: Raster) => {
    const png = new PNG({ width: raster.width, height: raster.height });
    png.data = Buffer.from(raster.data.buffer, raster.data.byteOffset, raster.data.byteLength);
    const encoded = PNG.sync.write(png);
    return Promise.resolve(`data:image/png;base64,${encoded.toString('base64')}`);
  },
};

function decodePng(bytes: Uint8Array): PNG {
  try {
    return PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  } catch {
    throw new Error(
      'The command line can only decode PNG images. Compare other formats in the app.',
    );
  }
}
