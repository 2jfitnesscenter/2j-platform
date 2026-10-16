// Pure logic for creating several variants of one product at once (Tienda).
// Reuses the existing variant model: label (shown), size (talla o formato), flavor (sabor), priceCents, stockTracked, sku.
// Nothing here talks to the API; the page creates the variants with the existing POST endpoints.

export type StoreCategory = 'nutrition' | 'merchandising';
export type VariantKind = 'sizes' | 'none' | 'custom';

export const APPAREL_SIZES = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL'] as const;
export const NUTRITION_PRESETS = ['150 g', '250 g', '500 g', '750 g', '1 kg', '2 kg', '2,5 kg', '5 kg'] as const;
export const FORMAT_UNITS = ['g', 'kg', 'ml', 'L', 'cápsulas', 'tabletas', 'sobres', 'unidades'] as const;
export const DEFAULT_VARIANT_LABEL = 'Estándar';

export type BuilderState = {
  kind: VariantKind;
  sizes: string[];
  formats: string[];
  flavors: string[];
  custom: string[];
  basePrice: string;
  stockTracked: boolean;
  /** Per-combination overrides keyed by combination key: price text and initial stock text. */
  overrides: Record<string, { price?: string; stock?: string }>;
};
export const emptyBuilder = (): BuilderState => ({ kind: 'sizes', sizes: [], formats: [], flavors: [], custom: [], basePrice: '', stockTracked: true, overrides: {} });

export type Combo = { key: string; label: string; size: string | null; flavor: string | null };
export type ExistingVariant = { label: string; size: string | null; flavor: string | null };

const squash = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim();
/** Case, accent and spacing insensitive key, so "1 KG · chocolate" equals "1 kg · Chocolate". */
export const normalizeKey = (value: string | null | undefined) => squash(value ?? '').toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');
export const cleanText = squash;

export function formatLabel(amount: string, unit: string) {
  const value = squash(amount).replace('.', ',');
  return value ? `${value} ${unit}` : '';
}

export function sortSizes(sizes: string[]) {
  return [...sizes].sort((a, b) => (APPAREL_SIZES as readonly string[]).indexOf(a) - (APPAREL_SIZES as readonly string[]).indexOf(b));
}

/** The visible label of a combination, derived so the administrator never types label/size/flavor. */
export function comboFor(parts: { kind: VariantKind | 'nutrition'; size?: string | null; flavor?: string | null; name?: string }): Combo {
  if (parts.kind === 'sizes') { const size = squash(parts.size ?? ''); return { key: normalizeKey(`talla ${size}`), label: `Talla ${size}`, size, flavor: null }; }
  if (parts.kind === 'none') return { key: normalizeKey(DEFAULT_VARIANT_LABEL), label: DEFAULT_VARIANT_LABEL, size: null, flavor: null };
  if (parts.kind === 'custom') { const name = squash(parts.name ?? ''); return { key: normalizeKey(name), label: name, size: null, flavor: null }; }
  const size = squash(parts.size ?? ''); const flavor = squash(parts.flavor ?? '');
  const label = flavor ? `${size} · ${flavor}` : size;
  return { key: normalizeKey(label), label, size, flavor: flavor || null };
}

/** Every variant the builder would create: sizes, or formats × flavors (flavors are optional), or a default one, or a custom list. */
export function buildCombos(category: StoreCategory, state: BuilderState): Combo[] {
  if (category === 'nutrition') {
    const flavors = state.flavors.length ? state.flavors : [null];
    return state.formats.flatMap((format) => flavors.map((flavor) => comboFor({ kind: 'nutrition', size: format, flavor })));
  }
  if (state.kind === 'none') return [comboFor({ kind: 'none' })];
  if (state.kind === 'custom') return state.custom.filter((name) => squash(name)).map((name) => comboFor({ kind: 'custom', name }));
  return sortSizes(state.sizes).map((size) => comboFor({ kind: 'sizes', size }));
}

export type PlannedVariant = Combo & { exists: boolean; priceCents: number | null; stock: number; problems: string[] };
const centsOf = (text: string) => { const value = Number(squash(text).replace(',', '.')); const cents = Math.round(value * 100); return squash(text) && Number.isFinite(value) && Number.isSafeInteger(cents) && cents >= 0 && cents <= 100_000_000_000 ? cents : null; };
export const parsePriceCents = centsOf;

/** Applies the base price, the per-variant overrides and the duplicate check against what the product already has. */
export function planVariants(category: StoreCategory, state: BuilderState, existing: ExistingVariant[]): PlannedVariant[] {
  const taken = new Set<string>(); const takenPairs = new Set<string>();
  for (const item of existing) { taken.add(normalizeKey(item.label)); if (item.size) takenPairs.add(`${normalizeKey(item.size)}|${normalizeKey(item.flavor)}`); }
  const seen = new Set<string>();
  return buildCombos(category, state).filter((combo) => { if (seen.has(combo.key)) return false; seen.add(combo.key); return true; }).map((combo) => {
    const exists = taken.has(combo.key) || Boolean(combo.size && takenPairs.has(`${normalizeKey(combo.size)}|${normalizeKey(combo.flavor)}`));
    const override = state.overrides[combo.key] ?? {};
    const priceText = override.price !== undefined ? override.price : state.basePrice;
    const priceCents = centsOf(priceText);
    const stockText = squash(override.stock ?? '');
    const stock = stockText === '' ? 0 : Number(stockText);
    const problems: string[] = [];
    if (!exists) {
      if (priceCents === null) problems.push('Indica un precio válido en euros.');
      if (state.stockTracked && (!Number.isInteger(stock) || stock < 0 || stock > 100_000)) problems.push('El stock debe ser un número entero de 0 o más.');
      if (combo.label.length > 100 || (combo.size?.length ?? 0) > 40 || (combo.flavor?.length ?? 0) > 80) problems.push('El texto es demasiado largo.');
    }
    return { ...combo, exists, priceCents, stock: Number.isInteger(stock) && stock > 0 ? stock : 0, problems };
  });
}

export const creatable = (planned: PlannedVariant[]) => planned.filter((item) => !item.exists);
export const plannedReady = (planned: PlannedVariant[]) => creatable(planned).length > 0 && creatable(planned).every((item) => item.problems.length === 0);

// ---------- Selling: product first, then size/format, then flavor ----------
export type SellVariant = { id: string; label: string; size: string | null; flavor: string | null; priceCents: number | string; stockTracked: boolean; stock: number };
export type SellStep = { sizeLabel: string; sizes: string[]; flavors: string[]; needsFlavor: boolean; byLabel: boolean };
const blank = (value: string | null | undefined) => !value || !value.trim();

/** What the sale dialog asks after the product: Talla (clothing) or Formato (nutrition), then Sabor if that size has flavors, or Variante for custom ones. */
export function sellStep(category: StoreCategory, variants: SellVariant[], size: string): SellStep {
  const sizes = [...new Set(variants.filter((item) => !blank(item.size)).map((item) => item.size!))];
  // Without sizes and flavors, or with an inconsistent mix (some variants without size), the variants are picked by name.
  const byLabel = (sizes.length === 0 && variants.every((item) => blank(item.flavor))) || (sizes.length > 0 && variants.some((item) => blank(item.size)));
  const withSize = variants.filter((item) => (sizes.length ? item.size === size : true));
  const named = withSize.filter((item) => !blank(item.flavor)).map((item) => item.flavor!);
  // A size that has flavors and also a plain version offers 'Sin sabor' (empty value) next to the flavors.
  const flavors = named.length && withSize.some((item) => blank(item.flavor)) ? ['', ...new Set(named)] : [...new Set(named)];
  const sorted = sortVariants(sizes.map((value) => ({ size: value, flavor: null, label: value }))).map((item) => item.size!);
  return { sizeLabel: category === 'merchandising' ? 'Talla' : 'Formato', sizes: sorted, flavors, needsFlavor: flavors.length > 0, byLabel };
}

/** The single variant the choices point to, or null while a step is still missing. */
export function resolveVariant(category: StoreCategory, variants: SellVariant[], choice: { size: string; flavor: string | null; label: string }): SellVariant | null {
  if (variants.length === 1) return variants[0] ?? null;
  const step = sellStep(category, variants, choice.size);
  if (step.byLabel) return variants.find((item) => item.id === choice.label) ?? null;
  if (step.sizes.length && !choice.size) return null;
  const pool = variants.filter((item) => (step.sizes.length ? item.size === choice.size : true));
  if (step.needsFlavor) return choice.flavor === null ? null : pool.find((item) => (item.flavor ?? '') === choice.flavor) ?? null;
  return pool.length === 1 ? pool[0] ?? null : null;
}

/** Distinct sizes/formats of a product in a sensible order, for the catalogue card. */
export function productOptions(category: StoreCategory, variants: { size: string | null; flavor: string | null }[]) {
  const sizes = [...new Set(variants.filter((item) => !blank(item.size)).map((item) => item.size!))];
  const ordered = sortVariants(sizes.map((size) => ({ size, flavor: null, label: size }))).map((item) => item.size!);
  const flavors = [...new Set(variants.filter((item) => !blank(item.flavor)).map((item) => item.flavor!))];
  return { sizeTitle: category === 'merchandising' ? 'Tallas' : 'Formatos', sizes: ordered, flavors };
}

// ---------- Natural order (the API sorts variants by label, which puts "1 kg" before "500 g" and "Talla 2XL" before "Talla L") ----------
const UNIT_FACTOR: Record<string, number> = { g: 1, kg: 1000, ml: 1, l: 1000 };
function sizeRank(size: string | null | undefined): [number, number, string] {
  const text = (size ?? "").trim();
  const apparel = (APPAREL_SIZES as readonly string[]).indexOf(text);
  if (apparel >= 0) return [0, apparel, text];
  const match = /^(\d+(?:[.,]\d+)?)\s*(\p{L}+)?/u.exec(text);
  if (match) return [1, Number(match[1]!.replace(",", ".")) * (UNIT_FACTOR[(match[2] ?? "").toLowerCase()] ?? 1), text];
  return [2, 0, text];
}
export function compareVariants(a: { size: string | null; flavor: string | null; label: string }, b: { size: string | null; flavor: string | null; label: string }) {
  const [ga, na, ta] = sizeRank(a.size); const [gb, nb, tb] = sizeRank(b.size);
  return ga - gb || na - nb || ta.localeCompare(tb, "es") || (a.flavor ?? "").localeCompare(b.flavor ?? "", "es") || a.label.localeCompare(b.label, "es");
}
export const sortVariants = <T extends { size: string | null; flavor: string | null; label: string }>(variants: T[]) => [...variants].sort(compareVariants);
