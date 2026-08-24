import { gunzipSync } from 'node:zlib';

export type VgmMetadata = {
  title: string;
  game: string;
  artist: string;
  system: string;
  year?: string;
  notes?: string;
  durationSeconds?: number;
  isVgz: boolean;
};

function readU32LE(buf: Buffer, offset: number): number {
  if (offset + 4 > buf.length) return 0;
  return buf.readUInt32LE(offset);
}

function readUtf16LeString(buf: Buffer, offset: number): { text: string; next: number } {
  let i = offset;
  const chars: number[] = [];
  while (i + 1 < buf.length) {
    const code = buf.readUInt16LE(i);
    i += 2;
    if (code === 0) break;
    chars.push(code);
  }
  return { text: String.fromCharCode(...chars).trim(), next: i };
}

function titleFromFilename(name: string): string {
  const base = name.replace(/\.(vgm|vgz)$/i, '').trim();
  const cleaned = base.replace(/^\d+[\s._-]+/, '').trim();
  return cleaned || base || 'Untitled';
}

function estimateDurationSeconds(buf: Buffer): number | undefined {
  const version = readU32LE(buf, 0x08);
  if (version < 0x00000150) return undefined;
  const numSamples = readU32LE(buf, 0x18);
  let rate = readU32LE(buf, 0x24);
  if (rate <= 0) rate = 44100;
  if (numSamples <= 0) return undefined;
  const seconds = numSamples / rate;
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 10) / 10 : undefined;
}

function parseGd3(buf: Buffer, gd3Offset: number): Partial<VgmMetadata> {
  const base = gd3Offset + 0x14;
  if (base >= buf.length) return {};
  if (buf.toString('ascii', gd3Offset, gd3Offset + 4) !== 'Gd3 ') return {};

  const track = readUtf16LeString(buf, base);
  const game = readUtf16LeString(buf, track.next);
  const system = readUtf16LeString(buf, game.next);
  const artist = readUtf16LeString(buf, system.next);
  const date = readUtf16LeString(buf, artist.next);

  const yearMatch = date.text.match(/(\d{4})/);
  return {
    title: track.text,
    game: game.text,
    system: system.text,
    artist: artist.text,
    year: yearMatch?.[1],
  };
}

export function decompressVgmIfNeeded(data: Buffer): { body: Buffer; isVgz: boolean } {
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    return { body: gunzipSync(data), isVgz: true };
  }
  return { body: data, isVgz: false };
}

export function parseVgmMetadata(data: Buffer, filename = ''): VgmMetadata {
  const { body, isVgz } = decompressVgmIfNeeded(data);
  const magic = body.toString('ascii', 0, 4);
  if (magic !== 'Vgm ') {
    return {
      title: titleFromFilename(filename),
      game: '',
      artist: '',
      system: 'Arcade',
      durationSeconds: undefined,
      isVgz,
    };
  }

  const gd3Offset = readU32LE(body, 0x14);
  const gd3 = gd3Offset > 0 ? parseGd3(body, gd3Offset) : {};
  const durationSeconds = estimateDurationSeconds(body);

  const title = gd3.title || titleFromFilename(filename);
  const game = gd3.game || '';
  const artist = gd3.artist || 'Unknown';
  const system = gd3.system || 'Arcade';

  return {
    title,
    game,
    artist,
    system,
    year: gd3.year,
    durationSeconds,
    isVgz,
  };
}
