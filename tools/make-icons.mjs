// Generates the PNG app icons with no image dependencies: raw pixels -> zlib -> PNG.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function mix(a, b, t) { return a + (b - a) * t; }

function icon(size, padding) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const r = size * (0.5 - padding);
  const seamR = r * 1.32;
  const seamOff = r * 1.36;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // Court-blue background with a soft top-down gradient.
      const g = y / size;
      let R = Math.round(mix(20, 10, g));
      let G = Math.round(mix(52, 26, g));
      let B = Math.round(mix(84, 44, g));
      let A = 255;

      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      if (d < r + 1) {
        const edge = Math.min(1, Math.max(0, r + 0.5 - d));
        // Lit from the upper left.
        const light = Math.max(0, 1 - Math.hypot(dx + r * 0.3, dy + r * 0.34) / (r * 1.9));
        let br = 232, bg = 255, bb = 90;
        br = Math.round(mix(br * 0.78, 255, light));
        bg = Math.round(mix(bg * 0.80, 255, light));
        bb = Math.round(mix(bb * 0.62, 190, light));

        // Two seam arcs, the usual tennis-ball curves.
        const s1 = Math.abs(Math.hypot(dx - seamOff, dy) - seamR);
        const s2 = Math.abs(Math.hypot(dx + seamOff, dy) - seamR);
        const seam = Math.min(s1, s2);
        const w = Math.max(1.2, size * 0.022);
        if (seam < w) {
          const t = 1 - seam / w;
          br = Math.round(mix(br, 252, t));
          bg = Math.round(mix(bg, 252, t));
          bb = Math.round(mix(bb, 248, t));
        }
        R = Math.round(mix(R, br, edge));
        G = Math.round(mix(G, bg, edge));
        B = Math.round(mix(B, bb, edge));
      }
      buf[i] = R; buf[i + 1] = G; buf[i + 2] = B; buf[i + 3] = A;
    }
  }
  return png(size, size, buf);
}

mkdirSync('icons', { recursive: true });
for (const [size, pad] of [[180, 0.16], [192, 0.16], [512, 0.16], [1024, 0.16]]) {
  writeFileSync(`icons/icon-${size}.png`, icon(size, pad));
}
writeFileSync('icons/icon-maskable-512.png', icon(512, 0.26));
console.log('icons written');
