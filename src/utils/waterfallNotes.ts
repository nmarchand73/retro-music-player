/** Falling-note blocks for live pitch / waterfall piano roll (Magenta-style). */

export type WaterfallBlock = {
  midi: number;
  /** Wall time when the note appeared at the top of the roll. */
  spawnMs: number;
  releaseMs: number | null;
  energy: number;
};

export type WaterfallLayout = {
  /** Bottom edge of the roll — same y as the keyboard top. */
  playheadY: number;
  rollH: number;
  fallMs: number;
  pxPerMs: number;
  rowH: number;
};

export function layoutWaterfall(rollH: number): WaterfallLayout {
  const fallMs = Math.max(520, Math.min(1600, rollH * 2.8));
  return {
    playheadY: rollH,
    rollH,
    fallMs,
    pxPerMs: rollH / fallMs,
    rowH: rollH / 33,
  };
}

/**
 * Bottom edge of the block: 0 at spawn, reaches playheadY (keyboard) after fallMs,
 * then stays docked on the keyboard while the note is held.
 */
export function blockBottomY(block: WaterfallBlock, nowMs: number, layout: WaterfallLayout): number {
  const elapsed = nowMs - block.spawnMs;
  if (elapsed < layout.fallMs) {
    return elapsed * layout.pxPerMs;
  }
  return layout.playheadY;
}

export function blockPhase(
  block: WaterfallBlock,
  nowMs: number,
  layout: WaterfallLayout,
): 'falling' | 'live' | 'past' {
  const elapsed = nowMs - block.spawnMs;
  if (elapsed < layout.fallMs) return 'falling';
  if (block.releaseMs == null || nowMs <= block.releaseMs + layout.fallMs * 0.12) return 'live';
  return 'past';
}

export function pruneWaterfallBlocks(blocks: WaterfallBlock[], nowMs: number, layout: WaterfallLayout): void {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i]!;
    const bottom = blockBottomY(block, nowMs, layout);
    const released = block.releaseMs != null && nowMs - block.releaseMs > layout.fallMs * 0.5;
    if (released && bottom >= layout.playheadY + layout.rowH * 4) {
      blocks.splice(i, 1);
    }
  }
}
