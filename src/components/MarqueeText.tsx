import { useEffect, useRef, useState, type CSSProperties } from 'react';

interface MarqueeTextProps {
  text: string;
  className?: string;
}

/** Scrolls horizontally when the label does not fit; otherwise stays still. */
export function MarqueeText({ text, className = '' }: MarqueeTextProps) {
  const viewportRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    const measure = measureRef.current;
    if (!viewport || !measure) return;

    const update = () => {
      const next = Math.max(0, Math.ceil(measure.scrollWidth - viewport.clientWidth));
      setDistance((prev) => (prev === next ? prev : next));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [text]);

  const overflow = distance > 0;
  const durationSec = Math.max(4, distance / 28);
  const style: CSSProperties | undefined = overflow
    ? ({
        '--marquee-distance': `${distance}px`,
        '--marquee-duration': `${durationSec}s`,
      } as CSSProperties)
    : undefined;

  return (
    <span
      ref={viewportRef}
      className={`marquee${overflow ? ' is-overflow' : ''}${className ? ` ${className}` : ''}`}
      title={text}
    >
      <span ref={measureRef} className="marquee-text" style={style}>
        {text}
      </span>
    </span>
  );
}
