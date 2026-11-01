// Tiny dependency-free i18n. English source strings are the keys; locale files in
// src/locales/ map them to translations and are lazy-loaded (Vite code-splits each
// import.meta.glob entry), so the initial bundle stays English-only.
// Exercise instructions come from separately generated packs in src/instr/ (one per
// language, from the upstream dataset) — also lazy-loaded on language switch.
import { useSyncExternalStore } from 'react'

// UI languages. de/pt have no instruction pack upstream — instructions fall back to English.
export const LANGS = {
  en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano',
  pt: 'Português', pl: 'Polski', tr: 'Türkçe', ru: 'Русский', zh: '中文',
  ko: '한국어', hi: 'हिन्दी'
}
export const INSTR_LANGS = ['en', 'es', 'fr', 'it', 'tr', 'ru', 'zh', 'hi', 'pl', 'ko']
const DATE_LOCALES = {
  en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT',
  pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN'
}

const localePacks = import.meta.glob('../locales/*.js')
const instrPacks = import.meta.glob('../instr/*.js')
const namePacks = import.meta.glob('../names/*.js')

let lang = 'es'
let dict = {}
let instr = null            // { exId: [steps] } for the current language, null = English
let names = null            // { exId: 'translated name' } for the current language, null = English
let loadedLang = null       // language whose complete packs are currently installed
let loadRequest = 0          // prevents an older async pack load from replacing the latest choice
let version = 0
const subs = new Set()
const notify = () => { version++; subs.forEach(f => f()) }

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'es-ES'

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  if (typeof v !== 'string') return ''     // never "undefined" on screen: a missing key falls back to its English source, a missing source to nothing
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}
// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []
// Display name for an exercise in the current language — `ex.n` (always English, and the
// field search/import matching keys off) stays untouched; this is presentation-only. A custom
// exercise's id is never in a names pack, so it falls through to its own `n` automatically.
// An admin-set Spanish name (library admin overlay) beats the Spanish pack; any other language
// keeps its pack, then the English name. The overlay lives in lib/library/core.js (ES_NAME).
let nameOverrides = {}
export const setNameOverrides = map => { nameOverrides = map || {}; notify() }
export const nameFor = ex => (ex && lang === 'es' && nameOverrides[ex.id]) || (ex && names && names[ex.id]) || (ex && ex.n) || ''

async function loadLocale(l) {
  if (l === 'en') return { dict: {}, instr: null, names: null }
  const [locale, instructions, exerciseNames] = await Promise.all([
    localePacks['../locales/' + l + '.js'](),
    INSTR_LANGS.includes(l) ? instrPacks['../instr/' + l + '.js']() : Promise.resolve(null),
    namePacks['../names/' + l + '.js'] ? namePacks['../names/' + l + '.js']() : Promise.resolve(null),
  ])
  return { dict: locale.default, instr: instructions?.default || null, names: exerciseNames?.default || null }
}

export async function setLang(l, loadPacks = loadLocale) {
  if (!LANGS[l]) l = 'es'
  if (l === lang && l === loadedLang && version > 0) return
  const request = ++loadRequest
  lang = l
  try {
    const packs = await loadPacks(l)
    if (request !== loadRequest) return
    dict = packs.dict
    instr = packs.instr
    names = packs.names
    loadedLang = l
  } catch (e) {
    if (request !== loadRequest) return
    dict = {}; instr = null; names = null; loadedLang = null
  }
  notify()
}

/** Load the persisted UI pack before mounting React, so the first visible frame is localized. */
export async function loadStartupLanguage(state, loadPacks = loadLocale) {
  const saved = state && typeof state.lang === 'string' ? state.lang : 'es'
  const selected = LANGS[saved] ? saved : 'es'
  await setLang(selected, loadPacks)
  return selected
}

// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, () => version)
}
