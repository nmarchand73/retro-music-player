import { useEffect, useState } from 'react';
import type { Track } from '../types';

interface TrackCoverProps {
  track: Track;
  className?: string;
  /** When false, render nothing if there is no usable cover image. */
  showPlaceholder?: boolean;
}

export function TrackCover({
  track,
  className = 'track-cover',
  showPlaceholder = true,
}: TrackCoverProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [track.coverUrl, track.id]);

  const hasImage = Boolean(track.coverUrl) && !failed;

  if (hasImage && track.coverUrl) {
    const label = track.game ? `${track.game} box` : `${track.title} cover`;
    return (
      <img
        className={className}
        src={track.coverUrl}
        alt={label}
        onError={() => setFailed(true)}
      />
    );
  }

  if (!showPlaceholder) return null;

  const mark =
    track.platform === 'amiga'
      ? 'AM'
      : track.platform === 'cpc'
        ? 'CPC'
        : track.platform === 'c64'
          ? 'C64'
          : 'ST';
  return (
    <span className={`${className} is-placeholder`} data-platform={track.platform} aria-hidden="true">
      {mark}
    </span>
  );
}
