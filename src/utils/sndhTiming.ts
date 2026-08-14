export interface SndhTiming {
  rateHz: number;
  frames: number | null;
  seconds: number | null;
  looping: boolean;
  subsong: number;
}

function indexOfBytes(data: Uint8Array, tag: string, from = 0): number {
  const needle = new TextEncoder().encode(tag);
  outer: for (let i = from; i <= data.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (data[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function readU16BE(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

function readU32BE(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>>
    0
  );
}

function headerSlice(data: Uint8Array): Uint8Array {
  const start = indexOfBytes(data, 'SNDH');
  if (start < 0) return data.subarray(0, Math.min(data.length, 4096));
  const end = indexOfBytes(data, 'HDNS', start);
  return data.subarray(start, end >= 0 ? end : Math.min(data.length, start + 4096));
}

/** TIME/FRMS must be header tags, not the letters inside a title like "CRIME TIME". */
function findHeaderTag(header: Uint8Array, tag: string): number {
  let from = 0;
  while (from < header.length) {
    const at = indexOfBytes(header, tag, from);
    if (at < 0) return -1;
    const before = at === 0 ? 0 : header[at - 1];
    if (at === 0 || before === 0) return at;
    from = at + 1;
  }
  return -1;
}

function replayRateHz(header: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(header);
  const timers = [...text.matchAll(/T[ABCD](\d{2,3})\0/g), ...text.matchAll(/!V(\d{2,3})\0/g)];
  const last = timers.at(-1);
  const rate = last ? Number(last[1]) : 50;
  return rate > 0 ? rate : 50;
}

function subtuneCount(header: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(header);
  const match = text.match(/##(\d{2})/);
  const count = match ? Number(match[1]) : 1;
  return count > 0 ? count : 1;
}

function defaultSubsong(header: Uint8Array): number {
  const text = new TextDecoder('latin1').decode(header);
  const match = text.match(/#!(\d{2})/);
  const value = match ? Number(match[1]) : 1;
  return value > 0 ? value : 1;
}

export function parseSndhTiming(data: Uint8Array, subsong?: number): SndhTiming {
  const header = headerSlice(data);
  const rateHz = replayRateHz(header);
  const count = subtuneCount(header);
  const chosen = subsong ?? defaultSubsong(header);
  const index = Math.min(Math.max(chosen, 1), count) - 1;

  const frmsAt = findHeaderTag(header, 'FRMS');
  if (frmsAt >= 0) {
    const frames: number[] = [];
    let offset = frmsAt + 4;
    for (let i = 0; i < count && offset + 4 <= header.length; i += 1) {
      frames.push(readU32BE(header, offset));
      offset += 4;
    }
    const frameCount = frames[index] ?? frames[0] ?? 0;
    if (frameCount > 0) {
      return {
        rateHz,
        frames: frameCount,
        seconds: frameCount / rateHz,
        looping: false,
        subsong: chosen,
      };
    }
    return { rateHz, frames: 0, seconds: null, looping: true, subsong: chosen };
  }

  const timeAt = findHeaderTag(header, 'TIME');
  if (timeAt >= 0) {
    const secondsList: number[] = [];
    let offset = timeAt + 4;
    for (let i = 0; i < count && offset + 2 <= header.length; i += 1) {
      secondsList.push(readU16BE(header, offset));
      offset += 2;
    }
    const seconds = secondsList[index] ?? secondsList[0] ?? 0;
    if (seconds > 0) {
      return { rateHz, frames: seconds * rateHz, seconds, looping: false, subsong: chosen };
    }
    return { rateHz, frames: 0, seconds: null, looping: true, subsong: chosen };
  }

  return { rateHz, frames: null, seconds: null, looping: true, subsong: chosen };
}
