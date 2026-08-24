import { useState } from 'react';
import type { Track } from '../types';
import { downloadTrack } from '../utils/downloadTrack';

interface DownloadButtonProps {
  track: Track;
}

export function DownloadButton({ track }: DownloadButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await downloadTrack(track);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      window.alert(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={`download-toggle${busy ? ' is-busy' : ''}`}
      aria-label={busy ? `Downloading ${track.title}` : `Download ${track.title}`}
      aria-busy={busy}
      disabled={busy}
      onClick={() => void handleClick()}
    >
      <DownloadIcon />
    </button>
  );
}

function DownloadIcon() {
  return (
    <svg className="download-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4.5v10.2m0 0 3.6-3.6M12 14.7 8.4 11.1M5.5 18.5h13"
      />
    </svg>
  );
}
