import React from 'react';

export type PageHeaderProps = {
  title: React.ReactNode;
  titleId?: string;
  description?: React.ReactNode;
  /** Secondary metadata under the description (last update, scope...). */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
};

/** Page title block. One h1, optional context line, actions on the right (wrap below on narrow screens). */
export function PageHeader({ title, titleId, description, meta, actions }: PageHeaderProps) {
  return <header className="ui-page-header">
    <div className="ui-page-header-copy">
      <h1 className="ui-page-title" {...(titleId ? { id: titleId } : {})}>{title}</h1>
      {description ? <p className="ui-page-description">{description}</p> : null}
      {meta ? <p className="ui-page-meta">{meta}</p> : null}
    </div>
    {actions ? <div className="ui-page-actions">{actions}</div> : null}
  </header>;
}
