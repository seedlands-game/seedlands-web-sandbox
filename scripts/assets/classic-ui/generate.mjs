import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const output = path.join(root, 'apps/web/public/assets/ui');

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
const crc32 = (bytes) => {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const typeBytes = Buffer.from(type, 'ascii');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length, 0);
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([header, typeBytes, data, footer]);
};

function canvas(width, height) {
  const pixels = new Uint8Array(width * height * 4);
  const paint = (x, y, color) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    pixels.set(color, offset);
  };
  const rect = (x, y, w, h, color) => {
    for (let row = y; row < y + h; row += 1)
      for (let column = x; column < x + w; column += 1) paint(column, row, color);
  };
  return { width, height, pixels, paint, rect };
}

const colors = {
  transparent: [0, 0, 0, 0],
  black: [18, 18, 18, 255],
  shadow: [49, 49, 49, 255],
  mid: [112, 112, 112, 255],
  light: [176, 176, 176, 255],
  white: [236, 236, 236, 255],
  panel: [112, 112, 112, 255],
  panelDark: [74, 74, 74, 255],
  red: [198, 66, 66, 255],
  redDark: [112, 39, 39, 255],
  steel: [176, 188, 198, 255],
  steelDark: [79, 91, 101, 255],
  water: [102, 178, 221, 255],
  waterLight: [190, 229, 242, 255],
  grass: [116, 152, 78, 255],
};

function writePng(name, image) {
  const raw = Buffer.alloc((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const row = y * (image.width * 4 + 1);
    raw[row] = 0;
    raw.set(image.pixels.subarray(y * image.width * 4, (y + 1) * image.width * 4), row + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return writeFile(
    path.join(output, name),
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

function panel() {
  const image = canvas(32, 32);
  image.rect(0, 0, 32, 32, colors.black);
  image.rect(2, 2, 28, 28, colors.shadow);
  image.rect(3, 3, 26, 26, colors.light);
  image.rect(5, 5, 22, 22, colors.panel);
  image.rect(5, 5, 22, 2, colors.mid);
  image.rect(5, 25, 22, 2, colors.panelDark);
  for (let y = 7; y < 25; y += 4) for (let x = 7; x < 25; x += 4) image.paint(x, y, colors.mid);
  return image;
}

function slot() {
  const image = canvas(24, 24);
  image.rect(0, 0, 24, 24, colors.black);
  image.rect(2, 2, 20, 20, colors.light);
  image.rect(4, 4, 16, 16, colors.shadow);
  image.rect(5, 5, 14, 14, colors.black);
  image.rect(6, 6, 12, 2, [42, 42, 42, 255]);
  return image;
}

function heart() {
  const image = canvas(16, 14);
  const rows = [
    '.xx...xx........',
    'xxxx.xxxx.......',
    'xxxxxxxxx.......',
    '.xxxxxxx........',
    '..xxxxx.........',
    '...xxx..........',
    '....x...........',
  ];
  rows.forEach((row, y) =>
    [...row].forEach((cell, x) => {
      if (cell !== 'x') return;
      image.paint(x, y, colors.redDark);
      image.paint(x + 1, y, colors.red);
      if (y > 1) image.paint(x + 1, y - 1, colors.red);
    }),
  );
  return image;
}

function armor() {
  const image = canvas(16, 16);
  image.rect(4, 1, 8, 2, colors.steel);
  image.rect(3, 3, 10, 4, colors.steel);
  image.rect(1, 5, 3, 7, colors.steelDark);
  image.rect(12, 5, 3, 7, colors.steelDark);
  image.rect(4, 6, 8, 8, colors.steel);
  image.rect(6, 11, 4, 4, colors.steelDark);
  image.rect(5, 4, 2, 2, colors.white);
  image.rect(2, 12, 12, 2, colors.black);
  return image;
}

function bubble() {
  const image = canvas(16, 16);
  image.rect(5, 1, 6, 2, colors.waterLight);
  image.rect(3, 3, 10, 8, colors.water);
  image.rect(5, 11, 6, 2, colors.water);
  image.rect(6, 13, 4, 1, colors.waterLight);
  image.rect(4, 4, 2, 4, colors.waterLight);
  image.rect(6, 5, 1, 1, colors.white);
  return image;
}

const glyphs = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
};
function crest() {
  const image = canvas(86, 16);
  const word = 'SEEDLANDS';
  image.rect(0, 0, 16, 16, colors.black);
  image.rect(2, 2, 12, 12, colors.grass);
  image.rect(2, 11, 12, 3, [100, 77, 47, 255]);
  for (let x = 3; x < 14; x += 3) image.paint(x, 3, colors.light);
  let offset = 19;
  for (const letter of word) {
    const glyph = glyphs[letter];
    glyph.forEach((row, y) =>
      [...row].forEach((cell, x) => {
        if (cell === '1') image.paint(offset + x, y + 4, colors.white);
      }),
    );
    offset += 7;
  }
  return image;
}

await mkdir(output, { recursive: true });
await Promise.all([
  writePng('classic-panel.png', panel()),
  writePng('classic-hotbar-slot.png', slot()),
  writePng('classic-heart.png', heart()),
  writePng('classic-armor.png', armor()),
  writePng('classic-bubble.png', bubble()),
  writePng('classic-crest.png', crest()),
]);
console.log(`Generated 6 classic UI pixel assets → ${path.relative(root, output)}`);
