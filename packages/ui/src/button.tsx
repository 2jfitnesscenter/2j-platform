import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { LoaderCircle } from 'lucide-react';
import { Icon } from './icon.js';
import { cx } from './classnames.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';
export type ButtonSize = 'md' | 'sm';

type BaseProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Lucide icon rendered before the label. */
  icon?: LucideIcon;
  /** Shows a spinner, keeps the label and width stable, and blocks activation. */
  loading?: boolean;
  children: React.ReactNode;
};
type NativeButtonProps = BaseProps & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseProps> & { href?: undefined };
type AnchorProps = BaseProps & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof BaseProps> & { href: string };
export type ButtonProps = NativeButtonProps | AnchorProps;

/**
 * One shared button. Primary is the single strong action of a zone (brand fill, dark text: white on #73b52e fails contrast).
 * With `href` it renders a link with the same look, so navigation actions never need a second component.
 */
export const Button = React.forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(function Button(props, ref) {
  const { variant = 'secondary', size = 'md', icon, loading = false, children, className, ...rest } = props;
  const classes = cx('ui-button', `ui-button--${variant}`, size === 'sm' && 'ui-button--sm', loading && 'is-loading', className);
  const content = <>
    {loading ? <Icon icon={LoaderCircle} size={16} className="ui-spin" /> : icon ? <Icon icon={icon} size={16} /> : null}
    <span className="ui-button-label">{children}</span>
  </>;
  if (typeof rest.href === 'string') {
    const { href, ...anchor } = rest as Omit<AnchorProps, keyof BaseProps>;
    return <a ref={ref as React.Ref<HTMLAnchorElement>} className={classes} href={href} {...anchor}>{content}</a>;
  }
  const { type = 'button', disabled, ...button } = rest as Omit<NativeButtonProps, keyof BaseProps>;
  const blocked = Boolean(disabled) || loading;
  return <button ref={ref as React.Ref<HTMLButtonElement>} type={type} className={classes} disabled={blocked} aria-busy={loading || undefined} {...button}>{content}</button>;
});

export type IconButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> & {
  icon: LucideIcon;
  /** Required accessible name; also shown as the native tooltip. */
  label: string;
  variant?: Exclude<ButtonVariant, 'primary'>;
  size?: ButtonSize;
};

/** Icon-only button. 44 px target (36 px only for dense layouts with a fine pointer). */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ icon, label, variant = 'ghost', size = 'md', className, type = 'button', ...rest }, ref) {
  return <button ref={ref} type={type} aria-label={label} title={label} className={cx('ui-button', 'ui-icon-button', `ui-button--${variant}`, size === 'sm' && 'ui-button--sm', className)} {...rest}><Icon icon={icon} size={20} /></button>;
});
