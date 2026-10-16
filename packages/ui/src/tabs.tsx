import React from 'react';
import { cx } from './classnames.js';

export type TabItem = { id: string; label: React.ReactNode };

export type TabsProps = {
  /** Accessible name of the tab list. */
  label: string;
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Id of the single tabpanel these tabs control. */
  panelId: string;
  /** Prefix for tab ids: the tab for item `x` gets id `${idPrefix}-x` (use it for aria-labelledby on the panel). */
  idPrefix: string;
  className?: string;
};

/** One tab pattern: WAI-ARIA tablist with roving tabindex and Arrow/Home/End keys. Scrolls horizontally on narrow screens. */
export function Tabs({ label, items, value, onChange, panelId, idPrefix, className }: TabsProps) {
  const refs = React.useRef(new Map<string, HTMLButtonElement>());
  const move = (event: React.KeyboardEvent<HTMLButtonElement>, currentId: string) => {
    const index = items.findIndex((item) => item.id === currentId);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    const target = items[next];
    if (target) { onChange(target.id); refs.current.get(target.id)?.focus(); }
  };
  return <div role="tablist" aria-label={label} aria-orientation="horizontal" className={cx('ui-tabs', className)}>
    {items.map((item) => {
      const selected = item.id === value;
      return <button
        key={item.id}
        ref={(node) => { if (node) refs.current.set(item.id, node); else refs.current.delete(item.id); }}
        type="button" role="tab" id={`${idPrefix}-${item.id}`}
        aria-selected={selected} aria-controls={panelId} tabIndex={selected ? 0 : -1}
        className={cx('ui-tab', selected && 'is-selected')}
        onClick={() => onChange(item.id)} onKeyDown={(event) => move(event, item.id)}
      >{item.label}</button>;
    })}
  </div>;
}
