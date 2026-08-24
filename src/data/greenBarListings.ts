import { C64_ASM_LINES } from './c64AsmListing';

export type GreenBarLanguageId =
  | 'c'
  | 'cpp'
  | 'gfa'
  | 'asm'
  | 'pascal'
  | 'csharp'
  | 'objc'
  | 'python';

export type GreenBarListingDef = {
  id: GreenBarLanguageId;
  label: string;
  lines: readonly string[];
  isComment: (trimmed: string) => boolean;
  formatNowPlaying: (title: string, subtitle: string) => string;
};

const C_LISTING: readonly string[] = [
  '/* retro-music-player — SID playback core */',
  '#include <stdint.h>',
  '#include <string.h>',
  '',
  'typedef struct {',
  '  uint8_t *data;',
  '  uint32_t rate;',
  '  uint16_t voice_mask;',
  '  float position;',
  '} SidTrack;',
  '',
  'static SidTrack g_track;',
  '',
  'int sid_load(const uint8_t *buf, size_t len) {',
  '  if (len < 0x7c) return -1;',
  '  g_track.data = memcpy(malloc(len), buf, len);',
  '  g_track.rate = 985248;',
  '  g_track.voice_mask = 0x07;',
  '  return 0;',
  '}',
  '',
  'void sid_play(float dt) {',
  '  g_track.position += dt;',
  '  ym_write(0, next_sample());',
  '  ym_write(1, next_sample());',
  '}',
  '',
  'void sid_set_voice_mute(int v, int mute) {',
  '  if (mute) g_track.voice_mask &= ~(1 << v);',
  '  else g_track.voice_mask |= (1 << v);',
  '}',
  '',
  '/* EOF */',
];

const CPP_LISTING: readonly string[] = [
  '// chiptune_engine.hpp — multi-format player',
  '#pragma once',
  '#include <array>',
  '#include <memory>',
  '',
  'namespace retro {',
  '',
  'enum class Platform { C64, CPC, Amiga, Atari };',
  '',
  'class AudioEngine {',
  ' public:',
  '  explicit AudioEngine(Platform p);',
  '  void load(std::span<const uint8_t> blob);',
  '  void play();',
  '  void pause();',
  '  void set_voice_mute(int ch, bool on);',
  '',
  ' private:',
  '  Platform platform_;',
  '  std::array<float, 4096> ring_{};',
  '  double position_{0};',
  '};',
  '',
  '}  // namespace retro',
];

const GFA_LISTING: readonly string[] = [
  'REM *** GFA BASIC 3.6 — demo scroll ***',
  'REM line printer listing — green bar paper',
  '',
  "TITLE 'Retro Music Player'",
  'CLEAR ',
  '',
  'DIM scroll$(200)',
  'DIM star(50, 2)',
  '',
  'FOR i = 0 TO 49',
  '  star(i, 0) = RND(1) * 320',
  '  star(i, 1) = RND(1) * 200',
  'NEXT i',
  '',
  'music$ = "KNIGHT LORE / ROB HUBBARD"',
  'scroll$ = "★★★  " + music$ + "  ★★★"',
  '',
  'REPEAT',
  '  FOR x = 0 TO LEN(scroll$)',
  '    TEXT x, 180, MID$(scroll$, x, 1)',
  '  NEXT x',
  '  VSYNC ',
  'UNTIL INKEY$ = " "',
  '',
  'END',
];

const PASCAL_LISTING: readonly string[] = [
  '{ Turbo Pascal 7.0 — MOD replay stub }',
  'program RetroPlayer;',
  '',
  'uses Crt, Dos;',
  '',
  'type',
  '  TChipVoice = record',
  '    period: Word;',
  '    volume: Byte;',
  '    waveform: Byte;',
  '  end;',
  '',
  'var',
  '  voices: array[0..3] of TChipVoice;',
  '  playing: Boolean;',
  '  tick: LongInt;',
  '',
  'procedure InitYM2149;',
  'begin',
  '  FillChar(voices, SizeOf(voices), 0);',
  '  playing := False;',
  '  tick := 0;',
  'end;',
  '',
  'procedure PlayFrame;',
  'begin',
  '  Inc(tick);',
  '  { POKEY / YM tick }',
  'end;',
  '',
  'begin',
  '  InitYM2149;',
  "  WriteLn('Press any key...');",
  '  ReadKey;',
  'end.',
];

const CSHARP_LISTING: readonly string[] = [
  '// RetroMusicPlayer — chip audio visualizer',
  'using System;',
  'using System.Numerics;',
  '',
  'namespace RetroMusic.Player;',
  '',
  'public sealed class SpectrumBar {',
  '    public float Level { get; private set; }',
  '    public float Peak { get; private set; }',
  '',
  '    public void Update(ReadOnlySpan<byte> fft) {',
  '        float sum = 0f;',
  '        foreach (var b in fft) sum += b;',
  '        Level = sum / fft.Length / 255f;',
  '        Peak = MathF.Max(Peak * 0.98f, Level);',
  '    }',
  '}',
  '',
  'public static class Program {',
  '    public static void Main() {',
  '        Console.WriteLine("HVSC / SNDH / MOD");',
  '    }',
  '}',
];

const OBJC_LISTING: readonly string[] = [
  '/* RetroMusicPlayer — AppDelegate.m */',
  '#import "AppDelegate.h"',
  '#import "ChipTuneEngine.h"',
  '',
  '@implementation AppDelegate',
  '',
  '- (BOOL)application:(UIApplication *)app',
  '    didFinishLaunchingWithOptions:(NSDictionary *)opts {',
  '  self.engine = [[ChipTuneEngine alloc] init];',
  '  [self.engine setVoiceMute:0 enabled:NO];',
  '  return YES;',
  '}',
  '',
  '- (void)playSidData:(NSData *)sid {',
  '  [self.engine loadBuffer:sid format:@"SID"];',
  '  [self.engine play];',
  '}',
  '',
  '@end',
];

const PYTHON_LISTING: readonly string[] = [
  '# retro_music_player/visualizer.py',
  '"""Green-bar listing texture + pitch helpers."""',
  '',
  'from __future__ import annotations',
  '',
  'import math',
  'from dataclasses import dataclass',
  '',
  '@dataclass',
  'class PitchHit:',
  '    midi: int',
  '    clarity: float',
  '',
  'def hz_to_midi(hz: float) -> int:',
  '    return 69 + round(12 * math.log2(hz / 440.0))',
  '',
  'def detect_voices(samples: list[float], sr: int) -> list[PitchHit]:',
  '    # YIN + autocorr for C64 mix',
  '    hits: list[PitchHit] = []',
  '    return hits',
  '',
  'if __name__ == "__main__":',
  '    print("now playing: knucklebusters.sid")',
];

function asmNowPlaying(title: string, subtitle: string): string {
  return `; NOW PLAYING: ${title.toUpperCase()} — ${subtitle.replace(/\s+/g, ' ').trim()}`;
}

function slashComment(title: string, subtitle: string, prefix = '//'): string {
  return `${prefix} NOW PLAYING: ${title.toUpperCase()} — ${subtitle.replace(/\s+/g, ' ').trim()}`;
}

export const GREEN_BAR_LISTINGS: readonly GreenBarListingDef[] = [
  {
    id: 'asm',
    label: '6502 Assembler',
    lines: C64_ASM_LINES,
    isComment: (t) => t.startsWith(';') || t.length === 0,
    formatNowPlaying: asmNowPlaying,
  },
  {
    id: 'c',
    label: 'C',
    lines: C_LISTING,
    isComment: (t) =>
      t.startsWith('/*') || t.startsWith('*') || t.startsWith('//') || t.endsWith('*/') || t.length === 0,
    formatNowPlaying: (title, sub) => slashComment(title, sub, '/*'),
  },
  {
    id: 'cpp',
    label: 'C++',
    lines: CPP_LISTING,
    isComment: (t) => t.startsWith('//') || t.length === 0,
    formatNowPlaying: (title, sub) => slashComment(title, sub),
  },
  {
    id: 'gfa',
    label: 'GFA Basic',
    lines: GFA_LISTING,
    isComment: (t) =>
      t.toUpperCase().startsWith('REM') || t.startsWith("'") || t.length === 0,
    formatNowPlaying: (title, sub) =>
      `REM NOW PLAYING: ${title.toUpperCase()} — ${sub.replace(/\s+/g, ' ').trim()}`,
  },
  {
    id: 'pascal',
    label: 'Turbo Pascal',
    lines: PASCAL_LISTING,
    isComment: (t) =>
      t.startsWith('{') || t.startsWith('(*') || t.endsWith('}') || t.endsWith('*)') || t.length === 0,
    formatNowPlaying: (title, sub) =>
      `{ NOW PLAYING: ${title.toUpperCase()} — ${sub.replace(/\s+/g, ' ').trim()} }`,
  },
  {
    id: 'csharp',
    label: 'C#',
    lines: CSHARP_LISTING,
    isComment: (t) => t.startsWith('//') || t.length === 0,
    formatNowPlaying: (title, sub) => slashComment(title, sub),
  },
  {
    id: 'objc',
    label: 'Objective-C',
    lines: OBJC_LISTING,
    isComment: (t) =>
      t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.endsWith('*/') || t.length === 0,
    formatNowPlaying: (title, sub) => slashComment(title, sub, '/*'),
  },
  {
    id: 'python',
    label: 'Python',
    lines: PYTHON_LISTING,
    isComment: (t) => t.startsWith('#') || t.startsWith('"""') || t.length === 0,
    formatNowPlaying: (title, sub) =>
      `# NOW PLAYING: ${title.toUpperCase()} — ${sub.replace(/\s+/g, ' ').trim()}`,
  },
];

export function pickRandomGreenBarListing(): GreenBarListingDef {
  const idx = Math.floor(Math.random() * GREEN_BAR_LISTINGS.length);
  return GREEN_BAR_LISTINGS[idx] ?? GREEN_BAR_LISTINGS[0]!;
}

export function buildListingLines(
  listing: GreenBarListingDef,
  title?: string | null,
  text?: string | null,
): string[] {
  const base = [...listing.lines];
  const banner =
    title && text
      ? listing.formatNowPlaying(title, text)
      : listing.formatNowPlaying('SID TUNE', 'HVSC / SNDH');

  const headerEnd = Math.min(4, base.length);
  return [...base.slice(0, headerEnd), banner, '', ...base.slice(headerEnd)];
}
