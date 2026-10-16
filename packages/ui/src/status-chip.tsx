import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { CircleAlert, CircleCheck, Info, Minus, TriangleAlert } from 'lucide-react';
import { Icon } from './icon.js';
import { cx } from './classnames.js';

/** Colour expresses urgency, not value: danger = act now, warning = soon, success = healthy, info = information, neutral = no action. */
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const toneIcon: Record<StatusTone, LucideIcon> = { success: CircleCheck, warning: TriangleAlert, danger: CircleAlert, info: Info, neutral: Minus };

export type StatusChipProps = {
  tone: StatusTone;
  children: React.ReactNode;
  /** Overrides the default tone icon. Pass `null` for text only. */
  icon?: LucideIcon | null;
  className?: string;
};

/** Compact state label. Always text plus an icon, never colour alone. */
export function StatusChip({ tone, children, icon, className }: StatusChipProps) {
  const glyph = icon === undefined ? toneIcon[tone] : icon;
  return <span className={cx('ui-chip', `ui-chip--${tone}`, className)}>{glyph ? <Icon icon={glyph} size={16} /> : null}<span>{children}</span></span>;
}
