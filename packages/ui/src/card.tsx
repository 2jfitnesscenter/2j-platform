import React from 'react';
import { cx } from './classnames.js';

export type CardProps = React.HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'section' | 'article' | 'li';
  padding?: 'none' | 'md' | 'lg';
};

/** The single card surface: white, 1 px border, V2 radius, no resting shadow. */
export function Card({ as = 'div', padding = 'md', className, children, ...rest }: CardProps) {
  return React.createElement(as, { className: cx('ui-card', `ui-card--pad-${padding}`, className), ...rest }, children);
}

export type CardHeaderProps = {
  title: React.ReactNode;
  titleId?: string;
  level?: 2 | 3;
  description?: React.ReactNode;
  /** Right-aligned slot: a count chip, a text action... */
  actions?: React.ReactNode;
};

export function CardHeader({ title, titleId, level = 2, description, actions }: CardHeaderProps) {
  return <div className="ui-card-header">
    <div className="ui-card-heading">
      {React.createElement(`h${level}`, { className: 'ui-card-title', ...(titleId ? { id: titleId } : {}) }, title)}
      {description ? <p className="ui-card-description">{description}</p> : null}
    </div>
    {actions ? <div className="ui-card-actions">{actions}</div> : null}
  </div>;
}
