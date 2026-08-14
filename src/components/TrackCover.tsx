import type { Track } from '../types';

interface TrackCoverProps {
  track: Track;
  className?: string;
}

export function TrackCover({ track, className = 'track-cover' }: TrackCoverProps) {
  if (track.coverUrl) {
    const label = track.game ? `${track.game} box` : `${track.title} cover`;
    return <img className={className} src={track.coverUrl} alt={label} />;
  }

  const mark = track.platform === 'amiga' ? 'AM' : 'ST';
  return (
    <span className={`${className} is-placeholder`} data-platform={track.platform} aria-hidden="true">
      {mark}
    </span>
  );
}
