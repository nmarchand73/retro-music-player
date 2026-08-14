interface BookmarkButtonProps {
  title: string;
  bookmarked: boolean;
  onToggle: () => void;
}

export function BookmarkButton({ title, bookmarked, onToggle }: BookmarkButtonProps) {
  return (
    <button
      type="button"
      className={`bookmark-toggle${bookmarked ? ' on' : ''}`}
      aria-label={bookmarked ? `Remove bookmark ${title}` : `Bookmark ${title}`}
      aria-pressed={bookmarked}
      onClick={onToggle}
    >
      <BookmarkIcon filled={bookmarked} />
    </button>
  );
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg className="bookmark-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {filled ? (
        <path fill="currentColor" d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-3.4L5 21V4.5a1 1 0 0 1 1-1z" />
      ) : (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          d="M6.4 4.2h11.2c.5 0 .9.4.9.9V20l-6.5-3.2L5.5 20V5.1c0-.5.4-.9.9-.9z"
        />
      )}
    </svg>
  );
}
