import type { ComponentProps, ReactNode } from 'react';

/**
 * Shared interface components. They only use semantic design tokens
 * (see `tokens.css`), never raw colors, so themes and the future RESSA
 * identity apply everywhere at once.
 */

function cx(...parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

const CONTROL =
  'rounded-control border border-line-strong bg-surface-raised px-2.5 py-1.5 text-sm text-fg ' +
  'placeholder:text-fg-muted disabled:cursor-not-allowed disabled:opacity-50';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
  secondary: 'border border-line-strong bg-surface-raised text-fg hover:bg-surface-sunken',
  danger: 'border border-danger text-danger hover:bg-danger-soft',
  ghost: 'text-fg-soft hover:bg-surface-sunken',
};

export function Button({
  variant = 'secondary',
  className,
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={cx(
        'rounded-control px-3 py-1.5 text-sm font-medium transition-colors',
        'duration-(--motion-fast) disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cx(CONTROL, className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cx(CONTROL, 'min-h-20', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cx(CONTROL, className)} {...props} />;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-fg-soft">{label}</span>
      {children}
      {hint !== undefined && <span className="text-xs text-fg-muted">{hint}</span>}
    </label>
  );
}

export function Checkbox({
  label,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & { label: ReactNode }) {
  return (
    <label className={cx('flex items-start gap-2 text-sm', className)}>
      <input type="checkbox" className="mt-0.5 size-4 accent-(--accent)" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cx('rounded-card border border-line bg-surface-raised p-5', className)}
      {...props}
    />
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 font-display text-base font-semibold">{children}</h2>;
}

export type Tone = 'neutral' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-sunken text-fg-soft',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
};

const OUTLINE_TONES: Record<Tone, string> = {
  neutral: 'border-line-strong text-fg-soft',
  success: 'border-success text-success',
  warning: 'border-warning text-warning',
  danger: 'border-danger text-danger',
};

/**
 * `solid` badges describe the character; `outline` badges describe something
 * separate attached to it (its images), so the two never read as one status.
 */
export function Badge({
  tone = 'neutral',
  outline = false,
  children,
}: {
  tone?: Tone;
  outline?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-block whitespace-nowrap rounded-pill px-2 py-0.5 text-xs font-medium',
        outline ? cx('border bg-transparent', OUTLINE_TONES[tone]) : TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Notice({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <p
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('rounded-control px-3 py-2 text-sm', TONES[tone])}
    >
      {children}
    </p>
  );
}
