import { useEffect, useState } from 'react';
import { fetchTrack } from '../api';
import { FX_PREVIEW_REFS } from '../data/fxPreviewTracks';
import type { Track } from '../types';
import type { MachineId } from '../utils/machines';

export type FxPreviewTracks = Partial<Record<MachineId, Track>>;

export function useFxPreviewTracks(): { tracks: FxPreviewTracks; loading: boolean } {
  const [tracks, setTracks] = useState<FxPreviewTracks>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    void Promise.all(
      FX_PREVIEW_REFS.map(async (ref) => {
        try {
          const track = await fetchTrack(ref.source, ref.id);
          return [ref.machine, track] as const;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const next: FxPreviewTracks = {};
      for (const entry of results) {
        if (!entry) continue;
        const [machine, track] = entry;
        next[machine] = track;
      }
      setTracks(next);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return { tracks, loading };
}
