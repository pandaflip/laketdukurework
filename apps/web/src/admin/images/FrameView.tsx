import type { Aspect, Rect } from '@app/shared';

/**
 * Shows one frame of a picture at the display ratio of the game, exactly as it
 * would appear: the picture is scaled and shifted so that `rect` (normalized to
 * the SOURCE picture) fills the box. Pure CSS, so it is instant and does not
 * depend on the size the box is displayed at.
 */
export function FrameView({
  src,
  rect,
  aspect,
  label,
  className = '',
}: {
  src: string;
  rect: Rect;
  aspect: Aspect;
  label: string;
  className?: string;
}) {
  return (
    <div
      // A frame with no label is decoration inside something that already has a name.
      {...(label === '' ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
      className={`relative overflow-hidden bg-surface-sunken ${className}`}
      style={{ aspectRatio: `${aspect.w} / ${aspect.h}` }}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="absolute max-w-none select-none"
        style={{
          width: `${100 / rect.w}%`,
          height: `${100 / rect.h}%`,
          left: `${-(rect.x / rect.w) * 100}%`,
          top: `${-(rect.y / rect.h) * 100}%`,
        }}
      />
    </div>
  );
}
