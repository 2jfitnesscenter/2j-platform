import React from 'react';
import { Button } from '@2j/ui';
import {
  APPAREL_SIZES, FORMAT_UNITS, NUTRITION_PRESETS, cleanText, creatable, formatLabel, normalizeKey, planVariants, sortSizes,
  type BuilderState, type ExistingVariant, type StoreCategory, type VariantKind,
} from './store-variants';

type Props = { category: StoreCategory; existing: ExistingVariant[]; state: BuilderState; onChange: (update: (state: BuilderState) => BuilderState) => void; disabled?: boolean };

const kindOptions: { value: VariantKind; label: string }[] = [{ value: 'none', label: 'Sin variantes' }, { value: 'sizes', label: 'Tallas' }, { value: 'custom', label: 'Variantes personalizadas' }];
const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

export function VariantBuilder({ category, existing, state, onChange, disabled = false }: Props) {
  const [customAmount, setCustomAmount] = React.useState('');
  const [customUnit, setCustomUnit] = React.useState<string>('g');
  const [flavorDraft, setFlavorDraft] = React.useState('');
  const [customDraft, setCustomDraft] = React.useState('');
  const planned = planVariants(category, state, existing);
  const toCreate = creatable(planned);
  const existingKeys = new Set(existing.map((item) => normalizeKey(item.label)));
  const sizeExists = (size: string) => existingKeys.has(normalizeKey(`Talla ${size}`)) || existing.some((item) => normalizeKey(item.size) === normalizeKey(size) && !item.flavor);
  const formatExists = (format: string) => planned.length > 0 && !state.flavors.length && existing.some((item) => normalizeKey(item.size) === normalizeKey(format) && !item.flavor);
  const set = (patch: Partial<BuilderState>) => onChange((current) => ({ ...current, ...patch }));
  const addFormat = (text: string) => { const value = cleanText(text); if (value) onChange((current) => (current.formats.some((item) => normalizeKey(item) === normalizeKey(value)) ? current : { ...current, formats: [...current.formats, value] })); };
  const addFlavor = () => { const value = cleanText(flavorDraft); if (!value) return; onChange((current) => (current.flavors.some((item) => normalizeKey(item) === normalizeKey(value)) ? current : { ...current, flavors: [...current.flavors, value] })); setFlavorDraft(''); };
  const addCustom = () => { const value = cleanText(customDraft); if (!value) return; onChange((current) => (current.custom.some((item) => normalizeKey(item) === normalizeKey(value)) ? current : { ...current, custom: [...current.custom, value] })); setCustomDraft(''); };
  const override = (key: string, patch: { price?: string; stock?: string }) => onChange((current) => ({ ...current, overrides: { ...current.overrides, [key]: { ...current.overrides[key], ...patch } } }));
  const customFormats = state.formats.filter((item) => !(NUTRITION_PRESETS as readonly string[]).includes(item));
  const hint = category === 'nutrition'
    ? (state.formats.length === 0 ? 'Elige al menos un formato para generar variantes.' : '')
    : state.kind === 'sizes' ? (state.sizes.length === 0 ? 'Elige al menos una talla.' : '') : state.kind === 'custom' ? (state.custom.length === 0 ? 'Añade al menos una variante.' : '') : '';

  return <fieldset className="vb" disabled={disabled}>
    <legend>Variantes</legend>
    {category === 'merchandising' && <div className="vb-block"><span className="vb-title" id="vb-kind-title">Tipo de variante</span><div className="vb-chips" role="radiogroup" aria-labelledby="vb-kind-title">{kindOptions.map((option) => <label key={option.value} className={`vb-chip${state.kind === option.value ? ' is-on' : ''}`}><input type="radio" name="variant-kind" checked={state.kind === option.value} onChange={() => set({ kind: option.value })} /><span>{option.label}</span></label>)}</div></div>}

    {category === 'merchandising' && state.kind === 'sizes' && <div className="vb-block"><span className="vb-title" id="vb-sizes-title">Tallas disponibles</span><div className="vb-chips" role="group" aria-labelledby="vb-sizes-title">{APPAREL_SIZES.map((size) => { const taken = sizeExists(size); return <label key={size} className={`vb-chip${state.sizes.includes(size) && !taken ? ' is-on' : ''}${taken ? ' is-taken' : ''}`} title={taken ? 'Esta variante ya existe.' : undefined}><input type="checkbox" checked={state.sizes.includes(size) && !taken} disabled={taken} onChange={() => set({ sizes: sortSizes(toggle(state.sizes, size)) })} /><span>{size}</span></label>; })}</div></div>}

    {category === 'merchandising' && state.kind === 'none' && <p className="vb-note">Se creará una única variante, «Estándar», para poder vender y contar el stock del producto.</p>}

    {category === 'merchandising' && state.kind === 'custom' && <div className="vb-block"><span className="vb-title">Variantes personalizadas</span><div className="vb-inline"><label>Nombre de la variante<input value={customDraft} maxLength={100} placeholder="Ej. Negro" onChange={(event) => setCustomDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustom(); } }} /></label><Button onClick={addCustom} disabled={!cleanText(customDraft)}>Añadir variante</Button></div>{state.custom.length > 0 && <ul className="vb-tags" aria-label="Variantes añadidas">{state.custom.map((item) => <li key={item}><span>{item}</span><button type="button" aria-label={`Quitar ${item}`} onClick={() => set({ custom: state.custom.filter((value) => value !== item) })}>×</button></li>)}</ul>}</div>}

    {category === 'nutrition' && <>
      <div className="vb-block"><span className="vb-title" id="vb-formats-title">Formatos / tamaños</span>
        <div className="vb-chips" role="group" aria-labelledby="vb-formats-title">{NUTRITION_PRESETS.map((preset) => { const taken = formatExists(preset); return <label key={preset} className={`vb-chip${state.formats.includes(preset) && !taken ? ' is-on' : ''}${taken ? ' is-taken' : ''}`} title={taken ? 'Esta variante ya existe.' : undefined}><input type="checkbox" checked={state.formats.includes(preset) && !taken} disabled={taken} onChange={() => set({ formats: toggle(state.formats, preset) })} /><span>{preset}</span></label>; })}</div>
        <div className="vb-inline vb-custom-format"><label>Formato personalizado<input inputMode="decimal" value={customAmount} placeholder="Ej. 908" onChange={(event) => setCustomAmount(event.target.value)} /></label><label>Unidad<select value={customUnit} onChange={(event) => setCustomUnit(event.target.value)}>{FORMAT_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label><Button disabled={!cleanText(customAmount)} onClick={() => { addFormat(formatLabel(customAmount, customUnit)); setCustomAmount(''); }}>Añadir formato</Button></div>
        {customFormats.length > 0 && <ul className="vb-tags" aria-label="Formatos personalizados">{customFormats.map((item) => <li key={item}><span>{item}</span><button type="button" aria-label={`Quitar ${item}`} onClick={() => set({ formats: state.formats.filter((value) => value !== item) })}>×</button></li>)}</ul>}
      </div>
      <div className="vb-block"><span className="vb-title">Sabores (opcional)</span><div className="vb-inline"><label>Nuevo sabor<input value={flavorDraft} maxLength={80} placeholder="Ej. Chocolate" onChange={(event) => setFlavorDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addFlavor(); } }} /></label><Button onClick={addFlavor} disabled={!cleanText(flavorDraft)}>Añadir sabor</Button></div>{state.flavors.length > 0 ? <ul className="vb-tags" aria-label="Sabores">{state.flavors.map((item) => <li key={item}><span>{item}</span><button type="button" aria-label={`Quitar sabor ${item}`} onClick={() => set({ flavors: state.flavors.filter((value) => value !== item) })}>×</button></li>)}</ul> : <p className="vb-note">Sin sabores: cada formato será una variante.</p>}</div>
    </>}

    <div className="vb-grid">
      <label>Precio (€)<input inputMode="decimal" value={state.basePrice} placeholder="Ej. 18" onChange={(event) => set({ basePrice: event.target.value })} /></label>
      <label className="vb-check"><input type="checkbox" checked={state.stockTracked} onChange={(event) => set({ stockTracked: event.target.checked })} />Controlar unidades de stock</label>
    </div>
    <p className="vb-note">El precio se aplica a todas las variantes; puedes cambiarlo en cada una. El código (SKU) es opcional y se añade después.</p>

    {planned.length > 0 && <div className="vb-preview"><p className="vb-count" role="status" aria-live="polite">{toCreate.length === 0 ? 'No hay variantes nuevas que crear.' : toCreate.length === 1 ? 'Se creará 1 variante' : `Se crearán ${toCreate.length} variantes`}</p>
      <table className="vb-table"><thead><tr><th>Variante</th><th>Precio (€)</th>{state.stockTracked && <th>Stock inicial</th>}</tr></thead><tbody>{planned.map((item) => <tr key={item.key} className={item.exists ? 'is-taken' : ''}>
        <td data-label="Variante"><strong>{item.label}</strong>{item.exists && <small className="vb-exists">Esta variante ya existe.</small>}</td>
        {item.exists ? <td colSpan={state.stockTracked ? 2 : 1} /> : <><td data-label="Precio (€)"><input aria-label={`Precio ${item.label}`} inputMode="decimal" value={state.overrides[item.key]?.price ?? state.basePrice} onChange={(event) => override(item.key, { price: event.target.value })} /></td>{state.stockTracked && <td data-label="Stock inicial"><input aria-label={`Stock ${item.label}`} type="number" min="0" step="1" placeholder="0" value={state.overrides[item.key]?.stock ?? ''} onChange={(event) => override(item.key, { stock: event.target.value })} /></td>}</>}
      </tr>)}</tbody></table>
      {toCreate.some((item) => item.problems.length > 0) && <ul className="vb-problems" role="alert">{[...new Set(toCreate.flatMap((item) => item.problems))].map((problem) => <li key={problem}>{problem}</li>)}</ul>}
    </div>}
    {planned.length === 0 && hint && <p className="vb-note" role="status">{hint}</p>}
  </fieldset>;
}
