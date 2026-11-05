// PWA P1 (owner-approved, 2026-11-05): the maskable icons. Android crops a maskable icon to its own shape
// (circle, squircle, rounded square); only the central circle of 80% of the width is guaranteed to show.
// The old manifest reused icon-512.png as maskable, whose brass tile reaches 14% from each edge, so its
// corners were cut off. These icons keep every non-ink pixel inside that circle and fill the rest with ink.
import { it, expect } from "vitest";
import fs from "fs";
import path from "path";
import zlib from "zlib";

const INK = [0x0b, 0x1f, 0x1e];

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG to RGBA rows. Enough for the icons this repo commits. */
function decodePng(file: string) {
  const buf = fs.readFileSync(file);
  let pos = 8;
  let width = 0, height = 0, colorType = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error("only 8-bit non-interlaced PNGs");
      colorType = data[9];
    } else if (type === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bpp) throw new Error("only RGB or RGBA PNGs");
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = (line[i] + add) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = line[x * bpp]; out[o + 1] = line[x * bpp + 1]; out[o + 2] = line[x * bpp + 2];
      out[o + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
    }
    prev = line;
  }
  return { width, height, px: (x: number, y: number) => Array.from(out.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)) };
}

const isInk = ([r, g, b, a]: number[]) => a === 255 && Math.abs(r - INK[0]) <= 3 && Math.abs(g - INK[1]) <= 3 && Math.abs(b - INK[2]) <= 3;

for (const size of [192, 512]) {
  const file = path.join(process.cwd(), "public", `icon-maskable-${size}.png`);

  it(`icon-maskable-${size}.png is ${size}x${size}, ink to the edges`, () => {
    const img = decodePng(file);
    expect([img.width, img.height]).toEqual([size, size]);
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1], [size >> 1, 0], [0, size >> 1]]) {
      expect(isInk(img.px(x, y))).toBe(true);
    }
  });

  it(`icon-maskable-${size}.png keeps everything but ink inside the central 80% circle`, () => {
    const img = decodePng(file);
    const c = (size - 1) / 2, r = size * 0.4;
    let outside = 0, brass = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (isInk(img.px(x, y))) continue;
      brass++;
      if (Math.hypot(x - c, y - c) > r) outside++;
    }
    expect(brass).toBeGreaterThan(size * size * 0.15); // the tile is really there, not an empty square
    expect(outside).toBe(0);
  });
}
