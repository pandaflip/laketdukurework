import {
  centerRect,
  clamp,
  fitSize,
  maxZoomFor,
  rectCenter,
  zoomOfRect,
  zoomRect,
  type ImageSize,
  type Point,
  type Rect,
} from '@app/shared';
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  src: string;
  image: ImageSize;
  ratio: number;
  focus: Point;
  onFocusChange: (focus: Point) => void;
  /** The frame of the selected step, when there is one. */
  rect: Rect | null;
  /** Only in advanced mode: the frame can be moved and resized. */
  frameEditable: boolean;
  onRectChange: (rect: Rect) => void;
}

const STEP = 0.01;
const BIG_STEP = 0.05;

/**
 * The source picture with the focus cross and, in advanced mode, the frame of
 * the selected step. Everything is stored normalized to the source picture, so
 * what is shown never depends on the size of this box. Click or drag to place
 * things; the keyboard does the same (arrows, plus Shift for big steps).
 */
export function SourceCanvas({
  src,
  image,
  ratio,
  focus,
  onFocusChange,
  rect,
  frameEditable,
  onRectChange,
}: Props) {
  const { t } = useTranslation('images');
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ kind: 'focus' | 'frame' | 'resize'; offset: Point } | null>(null);

  const pointOf = (event: PointerEvent): Point => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return { x: 0.5, y: 0.5 };
    return {
      x: clamp((event.clientX - box.left) / box.width, 0, 1),
      y: clamp((event.clientY - box.top) / box.height, 0, 1),
    };
  };

  const begin = (
    event: PointerEvent<HTMLElement>,
    kind: 'focus' | 'frame' | 'resize',
    offset: Point,
  ): void => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind, offset };
  };

  const move = (event: PointerEvent): void => {
    const current = drag.current;
    if (!current) return;
    const point = pointOf(event);
    if (current.kind === 'focus') onFocusChange(point);
    else if (rect && current.kind === 'frame') {
      onRectChange(
        centerRect(rect, { x: point.x - current.offset.x, y: point.y - current.offset.y }),
      );
    } else if (rect) {
      // The corner follows the pointer; the frame keeps its center and its ratio.
      const center = rectCenter(rect);
      const width = Math.max(0.0001, 2 * (point.x - center.x));
      onRectChange(zoomRect(image, ratio, rect, fitSize(image, ratio).w / (width * image.width)));
    }
  };

  const end = (): void => {
    drag.current = null;
  };

  const arrowDelta = (event: KeyboardEvent, unit: number): Point | null => {
    const size = event.shiftKey ? BIG_STEP : unit;
    switch (event.key) {
      case 'ArrowLeft':
        return { x: -size, y: 0 };
      case 'ArrowRight':
        return { x: size, y: 0 };
      case 'ArrowUp':
        return { x: 0, y: -size };
      case 'ArrowDown':
        return { x: 0, y: size };
      default:
        return null;
    }
  };

  const onFocusKey = (event: KeyboardEvent): void => {
    const delta = arrowDelta(event, STEP);
    if (!delta) return;
    event.preventDefault();
    onFocusChange({ x: clamp(focus.x + delta.x, 0, 1), y: clamp(focus.y + delta.y, 0, 1) });
  };

  const onFrameKey = (event: KeyboardEvent): void => {
    if (!rect) return;
    const delta = arrowDelta(event, STEP / 2);
    if (delta) {
      event.preventDefault();
      onRectChange(
        centerRect(rect, { x: rectCenter(rect).x + delta.x, y: rectCenter(rect).y + delta.y }),
      );
    } else if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      const zoom = zoomOfRect(image, ratio, rect);
      onRectChange(zoomRect(image, ratio, rect, event.key === '-' ? zoom / 1.1 : zoom * 1.1));
    }
  };

  return (
    <div
      ref={boxRef}
      className="relative w-full touch-none select-none overflow-hidden rounded-card border border-line bg-surface-sunken"
      style={{ aspectRatio: `${image.width} / ${image.height}` }}
      onPointerDown={(event) => {
        // Clicking the picture places the focus point.
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { kind: 'focus', offset: { x: 0, y: 0 } };
        onFocusChange(pointOf(event));
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      data-testid="source-canvas"
    >
      <img src={src} alt="" draggable={false} className="absolute inset-0 size-full max-w-none" />

      {rect && (
        <div
          role="group"
          aria-label={t('canvas.frame')}
          aria-describedby="frame-help"
          tabIndex={frameEditable ? 0 : -1}
          className={`absolute border-2 border-accent-text shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] ${
            frameEditable ? 'cursor-move' : 'pointer-events-none'
          }`}
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.w * 100}%`,
            height: `${rect.h * 100}%`,
          }}
          onPointerDown={
            frameEditable
              ? (event) => {
                  const point = pointOf(event);
                  begin(event, 'frame', {
                    x: point.x - rectCenter(rect).x,
                    y: point.y - rectCenter(rect).y,
                  });
                }
              : undefined
          }
          onKeyDown={frameEditable ? onFrameKey : undefined}
          data-testid="frame-overlay"
        >
          {frameEditable && (
            <span
              aria-hidden="true"
              className="absolute -bottom-2 -right-2 size-4 cursor-nwse-resize rounded-sm bg-accent-text"
              onPointerDown={(event) => {
                begin(event, 'resize', { x: 0, y: 0 });
              }}
              data-testid="frame-resize"
            />
          )}
        </div>
      )}

      <button
        type="button"
        aria-label={t('canvas.focus', {
          x: Math.round(focus.x * 100),
          y: Math.round(focus.y * 100),
        })}
        className="absolute z-10 size-7 -translate-x-1/2 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-white bg-transparent shadow-[0_0_0_2px_rgba(0,0,0,0.7)] before:absolute before:left-1/2 before:top-[-6px] before:h-[calc(100%+12px)] before:w-0.5 before:-translate-x-1/2 before:bg-white after:absolute after:left-[-6px] after:top-1/2 after:h-0.5 after:w-[calc(100%+12px)] after:-translate-y-1/2 after:bg-white"
        style={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%` }}
        onPointerDown={(event) => {
          begin(event, 'focus', { x: 0, y: 0 });
        }}
        onKeyDown={onFocusKey}
        data-testid="focus-cross"
      />
      <p id="frame-help" className="sr-only">
        {t('canvas.frameHelp', { max: maxZoomFor(image, ratio).toFixed(1) })}
      </p>
    </div>
  );
}
