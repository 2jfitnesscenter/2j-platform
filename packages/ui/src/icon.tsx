import React from 'react';
import type { LucideIcon } from 'lucide-react';

/** Design System V2 icon sizes: 16 inline, 20 default, 24 navigation and empty states. */
export type IconSize = 16 | 20 | 24;
export const ICON_STROKE = 1.75;

export type IconProps = {
  icon: LucideIcon;
  size?: IconSize;
  className?: string;
};

/** Decorative Lucide icon (DD-04). Meaning must always be carried by adjacent text or an aria-label on the control. */
export function Icon({ icon: Glyph, size = 20, className }: IconProps) {
  return <Glyph aria-hidden="true" focusable="false" size={size} strokeWidth={ICON_STROKE} absoluteStrokeWidth {...(className ? { className } : {})} />;
}
