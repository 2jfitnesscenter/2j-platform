import { useMemo, useState } from 'react'
import GymProfile, { GymCompatibility } from '../components/GymProfile.jsx'
import { gymExerciseList } from '../lib/gym-profiles.js'
import { useStore } from '../store/useStore.js'
import { t, nameFor } from '../lib/i18n.js'
import { exerciseBrowserSheet, exerciseDetailSheet, exerciseFamilySheet } from '../sheets.jsx'
import { Button, ChipSelect } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { Thumb } from '../components/Media.jsx'
import { MUSCLE_GROUPS, isInMuscleGroup } from '../lib/muscles.js'
import { allExercises, EXIDX } from '../lib/exercises.js'
import { familiesOf, searchExercises, scopeList, favSetOf, recentIdsOf, variantLabel, facets, isRecommended, isDeprecated, movementLabel, equipmentLabel, MOVEMENTS } from '../lib/library/index.js'

// Plan > Exercises — Exercise Library V2. A member sees "2J exercises" (the curated Recommended
// 2J catalogue) grouped by movement family, can search it in plain words, and opens the full
// master library only when they need it. Favourites and recents come from their own state.
const REGIONS = [['lower', 'Lower body'], ['upper', 'Upper body'], ['core', 'Core'], ['full', 'Full body & cardio']]
const KINDS = [['free', 'Free weights'], ['machine', 'Machines'], ['cable', 'Cables'], ['bodyweight', 'Body weight'], ['accessory', 'Accessories'], ['cardio', 'Cardio machines']]

// Library V3: an exercise as a card — picture, name, what it works, how it moves and with what, plus honest badges (2J recommended, one of
// the member's habitual ones, deprecated → the preferred exercise replaces it). Nothing is hidden: a valid exercise always shows up.
function ExerciseRow({ ex, fav, habitual }) {
  const f = facets(ex)
  const variant = variantLabel(ex) // already names the equipment, so the subtitle does not repeat it
  const parts = [t(ex.tg || ex.bp), f?.movement && movementLabel(f.movement) ? t(movementLabel(f.movement)) : null, !variant && f?.equipment && equipmentLabel(f.equipment) ? t(equipmentLabel(f.equipment)) : null].filter(Boolean)
  const deprecated = isDeprecated(ex.id)
  return <div className={'item v3-ex' + (deprecated ? ' deprecated' : '')} onClick={() => exerciseDetailSheet(ex)}>
    <Thumb ex={ex} />
    <div className="grow">
      <div className="tt capitalize">{nameFor(ex)}</div>
      <div className="ss capitalize">{parts.join(' · ')}</div>
      <div className="v3-ex-tags">
        {variant && <span className="v3-chip">{variant}</span>}
        {isRecommended(ex.id) && <span className="lib-2j">2J</span>}
        {(fav || habitual) && <span className="v3-chip hab">{t('Habitual')}</span>}
        {deprecated && <span className="v3-chip dep">{t('Replaced')}</span>}
      </div>
      <GymCompatibility ex={ex} />
    </div>
    {fav && <span className="tag acc"><Icon name="heart" /></span>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

export default function Library() {
  const S = useStore(s => s.S)
  useStore(s => s.gymProfileRevision)
  const [q, setQ] = useState('')
  const [view, setView] = useState('')        // '' = 2J families · 'fav' · 'recent'
  const [muscle, setMuscle] = useState('')
  const [move, setMove] = useState('')
  const [kind, setKind] = useState('')
  const [shown, setShown] = useState(40)
  const [available, setAvailable] = useState(false)
  const all = allExercises(S)
  const two = useMemo(() => scopeList(all, '2j'), [all])
  const families = useMemo(() => familiesOf(two), [two])
  const fav = favSetOf(S)
  const recent = recentIdsOf(S)
  const recentSet = useMemo(() => new Set(recent), [recent.join(',')])
  const filtering = !!(q.trim() || view || muscle || move || kind || available)

  let list = view === 'fav' ? all.filter(e => fav.has(e.id)) : view === 'recent' ? recent.map(id => EXIDX[id]).filter(Boolean) : two
  if (muscle) list = list.filter(e => muscle === 'cardio' ? e.bp === 'cardio' : isInMuscleGroup(e, muscle))
  if (move) list = list.filter(e => facets(e)?.movement === move)
  if (kind) list = list.filter(e => facets(e)?.kind === kind)
  if (q.trim()) list = searchExercises(list, q)
  list = gymExerciseList(S, list, available)
  const reset = () => { setQ(''); setView(''); setMuscle(''); setMove(''); setKind(''); setShown(40); setAvailable(false) }

  return <>
    <GymProfile />
    <button className={'chip' + (available ? ' on' : '')} aria-pressed={available} onClick={() => setAvailable(!available)}>{t('Compatible with this place')}</button>
    <div className="lib-head">
      <div>
        <h4 className="sec" style={{ margin: 0 }}>{t('2J exercises')}</h4>
        <div className="small dim">{t('{0} recommended exercises, grouped by movement', two.filter(e => !e.custom).length)}</div>
      </div>
    </div>
    <div className="search v3-search" style={{ margin: '10px 0 8px' }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search: row machine, glute barbell, hinge…')} value={q} onChange={e => { setQ(e.target.value); setShown(40) }} /></div>
    <div className="chips lib-chips">
      {fav.size > 0 && <button className={'chip' + (view === 'fav' ? ' on' : '')} onClick={() => setView(view === 'fav' ? '' : 'fav')}><Icon name="heart" />{t('Favourites')}</button>}
      {recent.length > 0 && <button className={'chip' + (view === 'recent' ? ' on' : '')} onClick={() => setView(view === 'recent' ? '' : 'recent')}><Icon name="history" />{t('Recent')}</button>}
      <ChipSelect value={muscle} onChange={v => setMuscle(v === '*' ? '' : v)} sheetTitle={t('Muscle group')} placeholder={t('Muscle')}
        options={[{ value: '*', label: t('Any muscle') }, ...MUSCLE_GROUPS.map(g => ({ value: g.key, label: t(g.name) })), { value: 'cardio', label: t('Cardio') }]} />
      <ChipSelect value={move} onChange={v => setMove(v === '*' ? '' : v)} sheetTitle={t('Movement')} placeholder={t('Movement')}
        options={[{ value: '*', label: t('Any movement') }, ...MOVEMENTS.map(m => ({ value: m.id, label: t(m.label) }))]} />
      <ChipSelect value={kind} onChange={v => setKind(v === '*' ? '' : v)} sheetTitle={t('Gear')} placeholder={t('Gear')}
        options={[{ value: '*', label: t('Any equipment') }, ...KINDS.map(([v, l]) => ({ value: v, label: t(l) }))]} />
      {filtering && <button className="chip nocap" onClick={reset}><Icon name="xmark" />{t('Clear filters')}</button>}
    </div>

    {filtering ? <>
      <div className="list" style={{ marginTop: 8 }}>
        {list.slice(0, shown).map(e => <ExerciseRow key={e.id} ex={e} fav={fav.has(e.id)} habitual={recentSet.has(e.id)} />)}
        {list.length === 0 && <div className="empty v3-empty"><div className="ico"><Icon name="magnifier" /></div>{t('No match in 2J exercises')}<div className="small dim" style={{ margin: '4px 0 12px' }}>{t('Try another word or clear the filters; the full library has every exercise.')}</div><Button size="sm" variant="tinted" icon="xmark" onClick={reset}>{t('Clear filters')}</Button></div>}
      </div>
      {list.length > shown && <><div style={{ height: 8 }} /><Button onClick={() => setShown(n => n + 40)}>{t('Show more')}</Button></>}
    </> : REGIONS.map(([region, label]) => {
      const fams = families.filter(f => f.region === region)
      if (!fams.length) return null
      return <section key={region} className="lib-region">
        <h4 className="sec">{t(label)}</h4>
        <div className="lib-fams">
          {fams.map(f => <button key={f.movement} className="lib-fam" onClick={() => exerciseFamilySheet(f.movement)}>
            <span className="lib-fam-thumbs">{gymExerciseList(S, f.recommended).slice(0, 3).map(e => <Thumb key={e.id} ex={e} />)}</span>
            <span className="lib-fam-t">{t(f.label)}</span>
            <span className="lib-fam-s">{t('{0} exercises', f.recommended.length)}</span>
          </button>)}
        </div>
      </section>
    })}

    <div style={{ height: 16 }} />
    <Button variant="plain" icon="exercises" onClick={() => exerciseBrowserSheet(null)}>{t('See the full library')}</Button>
  </>
}
