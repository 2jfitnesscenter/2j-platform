import React from 'react';
import { Search, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from './icon.js';
import { IconButton } from './button.js';
import { cx } from './classnames.js';

export type SearchFieldProps = {
  /** Accessible name (the visible hint is the placeholder). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearLabel?: string;
  className?: string;
};

/** Search input with icon and a clear button once there is text. */
export function SearchField({ label, value, onChange, placeholder, clearLabel = 'Limpiar búsqueda', className }: SearchFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return <div className={cx('ui-search', className)}>
    <Icon icon={Search} size={20} className="ui-search-icon" />
    <input ref={inputRef} className="ui-search-input" type="text" inputMode="search" autoComplete="off" aria-label={label} {...(placeholder ? { placeholder } : {})} value={value} onChange={(event) => onChange(event.target.value)} />
    {value ? <IconButton className="ui-search-clear" size="sm" icon={X} label={clearLabel} onClick={() => { onChange(''); inputRef.current?.focus(); }} /> : null}
  </div>;
}

export type SegmentedOption<T extends string> = { value: T; label: React.ReactNode; disabled?: boolean; title?: string };

export type SegmentedControlProps<T extends string> = {
  label: string;
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

/** 2-4 short, mutually exclusive options (e.g. Activos / Archivados). Buttons expose aria-pressed. */
export function SegmentedControl<T extends string>({ label, options, value, onChange, className }: SegmentedControlProps<T>) {
  return <div role="group" aria-label={label} className={cx('ui-segmented', className)}>
    {options.map((option) => <button key={option.value} type="button" aria-pressed={option.value === value} disabled={option.disabled === true} {...(option.title ? { title: option.title } : {})} className={cx('ui-segment', option.value === value && 'is-selected')} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

export type EmptyStateProps = {
  icon?: LucideIcon;
  title?: React.ReactNode;
  children?: React.ReactNode;
  /** Only render an action the user is allowed to take. */
  action?: React.ReactNode;
  tone?: 'neutral' | 'danger';
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'title' | 'className'>;

/** Says what is missing (or failed) and what can be done next. Pass role="alert" for errors. */
export function EmptyState({ icon, title, children, action, tone = 'neutral', className, ...rest }: EmptyStateProps) {
  return <div className={cx('ui-empty', tone === 'danger' && 'is-danger', className)} {...rest}>
    {icon ? <span className="ui-empty-icon"><Icon icon={icon} size={24} /></span> : null}
    {title ? <strong className="ui-empty-title">{title}</strong> : null}
    {children ? <span className="ui-empty-text">{children}</span> : null}
    {action ? <div className="ui-empty-action">{action}</div> : null}
  </div>;
}
