// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { EQUIPMENT, EQUIPMENT_KINDS } from '../lib/protocol/movements.js'
import { activeGymProfile, gymProfilesOf, selectGymProfile, saveGymProfile, compatibleWithGym, DEFAULT_2J_EQUIPMENT } from '../lib/gym-profiles.js'
import Icon from './Icon.jsx'

const PROFILE_CARDS = [
  { id: '2j', name: '2J Fitness Center', subtitle: 'Your regular gym', icon: 'dumbbell' },
  { id: 'home', name: 'Home gym', subtitle: 'Train at home', icon: 'house' },
  { id: 'hotel', name: 'Hotel', subtitle: 'The essentials', icon: 'machine' },
  { id: 'other', name: 'Other gym', subtitle: 'Another training space', icon: 'figureStrength', create: true },
  { id: 'custom', name: 'Custom gym', subtitle: 'Make it your own', icon: 'sparkles', create: true },
]

const EQUIPMENT_ICONS = { bodyweight: 'figureStrength', dumbbell: 'dumbbell', barbell: 'barbell', machine: 'machine', selectorized: 'machine' }
const EQUIPMENT_KIND_LABELS = { free: 'Free weights', machine: 'Machines', cable: 'Cables', bodyweight: 'Body weight', accessory: 'Accessories', cardio: 'Cardio machines' }

function OfficialEquipmentEditor({ close }) {
  const S = useStore(s => s.S)
  const saveOfficialGymEquipment = useStore(s => s.saveOfficialGymEquipment)
  const [draft, setDraft] = useState(() => [...activeGymProfile(S).availableEquipment])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const toggle = id => setDraft(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id])
  const save = async () => {
    setSaving(true); setError('')
    try { await saveOfficialGymEquipment(draft); close() }
    catch (e) { setError(e.message || t('Could not save official equipment')) }
    finally { setSaving(false) }
  }
  return <div className="gym-official-editor">
    <div className="gym-sheet-head">
      <div className="gym-sheet-heading"><span className="gym-sheet-mark"><Icon name="dumbbell" /></span><div><h2>{t('2J official equipment')}</h2><p>{t('Choose the equipment available at 2J Fitness Center.')}</p></div></div>
      <button className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
    </div>
    <div className="gym-official-groups">
      {EQUIPMENT_KINDS.map(kind => {
        const items = EQUIPMENT.filter(item => item.kind === kind)
        if (!items.length) return null
        return <section className="gym-official-group" key={kind}><h3>{t(EQUIPMENT_KIND_LABELS[kind])}</h3><div className="gym-equipment-grid">
          {items.map(item => {
            const selected = draft.includes(item.id)
            return <button key={item.id} className={'gym-equipment-chip' + (selected ? ' on' : '')} type="button" aria-pressed={selected} onClick={() => toggle(item.id)}><Icon name={EQUIPMENT_ICONS[item.id] || 'checkCircle'} /><span>{t(item.label)}</span>{selected && <Icon name="check" className="gym-equipment-check" />}</button>
          })}
        </div></section>
      })}
    </div>
    <button type="button" className="gym-add-place-link" onClick={() => setDraft([...DEFAULT_2J_EQUIPMENT])}><Icon name="reset" />{t('Restore recommended equipment')}</button>
    {error && <p className="gym-editor-error" role="alert">{error}</p>}
    <div className="gym-sheet-bottom"><button className="btn" type="button" onClick={close} disabled={saving}>{t('Cancel')}</button><button className="btn primary gym-done-button" type="button" onClick={save} disabled={saving}>{saving ? t('Saving') : t('Save equipment')}</button></div>
  </div>
}

function GymProfileHelp({ close }) {
  return <div className="gym-help-sheet">
    <div className="gym-sheet-head">
      <div className="gym-sheet-heading"><span className="gym-sheet-mark"><Icon name="info" /></span><div><h2>{t('What is the training place?')}</h2><p>{t('A little context for your training.')}</p></div></div>
      <button className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
    </div>
    <div className="gym-help-copy">
      <p>{t('It helps 2J show equipment-compatible exercises and swaps, and guide the Constructor, Train2J and recommendations or AI.')}</p>
      <p>{t('It never changes your routines automatically or removes exercises. Availability is based on equipment categories, not specific machines.')}</p>
      <p>{t('Bunker always keeps the 2J Fitness Center equipment context.')}</p>
    </div>
    <button className="btn gym-help-done" onClick={close}>{t('Got it')}</button>
  </div>
}

function PersonalEquipmentEditor({ profile, update }) {
  const [draft, setDraft] = useState(() => [...profile.availableEquipment])
  const [query, setQuery] = useState('')
  const saved = EQUIPMENT.every(item => draft.includes(item.id) === profile.availableEquipment.includes(item.id))
  const filtered = EQUIPMENT.filter(item => t(item.label).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const toggle = id => setDraft(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id])
  const save = () => update(s => saveGymProfile(s, { ...profile, availableEquipment: draft }))
  return <div className="gym-personal-equipment">
    <div className="gym-equipment-tools">
      <input className="input" type="search" aria-label={t('Search equipment')} placeholder={t('Search equipment')} value={query} onChange={e => setQuery(e.target.value)} />
      <span className="gym-equipment-count">{t('{0} selected', draft.length)}</span>
    </div>
    <div className="gym-equipment-grid">
      {filtered.map(item => {
        const available = draft.includes(item.id)
        return <button key={item.id} className={'gym-equipment-chip' + (available ? ' on' : '')} type="button" aria-pressed={available} onClick={() => toggle(item.id)}><Icon name={EQUIPMENT_ICONS[item.id] || 'checkCircle'} /><span>{t(item.label)}</span>{available && <Icon name="check" className="gym-equipment-check" />}</button>
      })}
    </div>
    {filtered.length === 0 && <p className="gym-equipment-empty">{t('No matching equipment')}</p>}
    {!saved && <p className="gym-equipment-unsaved" role="status">{t('Unsaved equipment changes')}</p>}
    <button className="btn primary gym-equipment-save" type="button" onClick={save} disabled={saved}>{t('Save equipment')}</button>
  </div>
}

export function GymProfileSheet({ close = () => {}, editable = false }) {
  const S = useStore(s => s.S), update = useStore(s => s.update)
  useStore(s => s.gymProfileRevision)
  const user = useStore(s => s.user)
  const canEditOfficial = editable && user?.admin === true
  const openSheet = useUI(s => s.openSheet)
  const active = activeGymProfile(S)
  const profiles = gymProfilesOf(S)
  const [draftType, setDraftType] = useState('')
  const [name, setName] = useState('')
  const change = id => update(s => selectGymProfile(s, id))
  const activeName = active.type === 'official' ? t(active.name) : active.name
  const chooseCard = card => {
    if (!card.create) { change(card.id); setDraftType(''); return }
    const existing = profiles.find(p => p.type === card.id)
    if (existing) { change(existing.id); setDraftType(''); return }
    if (editable) setDraftType(card.id)
  }
  const addPlace = () => {
    const cleanName = name.trim()
    if (!cleanName || !draftType || profiles.length >= 15) return
    const id = 'gym-' + crypto.randomUUID()
    update(s => { saveGymProfile(s, { id, name: cleanName, type: draftType, availableEquipment: ['bodyweight'] }); selectGymProfile(s, id) })
    setName(''); setDraftType('')
  }

  return <div className="gym-profile-sheet">
    <div className="gym-sheet-head">
      <div><p className="gym-eyebrow">{t('YOUR TRAINING, YOUR PLACE')}</p><h1>{t('Where are you training today?')}</h1><p className="gym-sheet-intro">{t('Choose the place that best matches the equipment you have.')}</p></div>
      <div className="gym-sheet-actions">
        <button className="iconbtn gym-info-button" aria-label={t('What is the training place?')} title={t('What is the training place?')} onClick={() => openSheet(done => <GymProfileHelp close={done} />)}><Icon name="info" /></button>
        <button className="iconbtn" aria-label={t('Close')} onClick={close}><Icon name="xmark" /></button>
      </div>
    </div>

    <div className="gym-profile-grid" role="group" aria-label={t('Training place profiles')}>
      {PROFILE_CARDS.map(card => {
        const selected = card.create ? active.type === card.id : active.id === card.id
        // Tapping "Other gym" / "Custom gym" with none saved opens the name form: the card must show it is the one being set up (nothing becomes active until the place is added)
        const pending = !selected && card.create && draftType === card.id
        return <button key={card.id} type="button" className={'gym-profile-card' + (selected ? ' selected' : '') + (pending ? ' pending' : '')} aria-pressed={selected || pending} onClick={() => chooseCard(card)}>
          <span className="gym-profile-card-icon"><Icon name={card.icon} /></span>
          <span className="gym-profile-card-copy"><span className="gym-profile-card-title">{t(card.name)}</span><span className="gym-profile-card-subtitle">{t(card.subtitle)}</span></span>
          {selected ? <span className="gym-active-badge"><Icon name="check" />{t('Active')}</span> : pending ? <span className="gym-active-badge gym-pending-badge"><Icon name="plus" />{t('Adding')}</span> : <span className="gym-profile-radio" aria-hidden="true" />}
        </button>
      })}
    </div>

    {profiles.some(p => p.type === 'other' || p.type === 'custom') && <div className="gym-saved-places">
      <p className="gym-section-label">{t('Your saved places')}</p>
      <div className="gym-saved-place-list">{profiles.filter(p => p.type === 'other' || p.type === 'custom').map(p => <button key={p.id} className={'gym-saved-place' + (active.id === p.id ? ' selected' : '')} aria-pressed={active.id === p.id} onClick={() => change(p.id)}>{p.name}<span>{active.id === p.id ? t('Active') : <Icon name="chevronRight" />}</span></button>)}</div>
      {editable && profiles.length < 15 && <button className="gym-add-place-link" onClick={() => setDraftType('choose')}><Icon name="plus" />{t('Add another place')}</button>}
    </div>}

    {draftType === 'choose' && <div className="gym-create-place gym-create-kind"><span>{t('Choose a place type')}</span><button className="chip" onClick={() => setDraftType('other')}>{t('Other gym')}</button><button className="chip" onClick={() => setDraftType('custom')}>{t('Custom gym')}</button></div>}
    {draftType && <form className="gym-create-place" onSubmit={e => { e.preventDefault(); addPlace() }}>
      {draftType !== 'choose' && <><label htmlFor="gym-profile-name">{t(draftType === 'other' ? 'Name this gym' : 'Name this place')}</label>
      <div className="gym-create-row"><input id="gym-profile-name" className="input" autoFocus maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder={t(draftType === 'other' ? 'Gym name' : 'Place name')} /><button className="btn gym-create-button" type="submit" disabled={!name.trim() || profiles.length >= 15}>{t('Add place')}</button></div>
      </>}
    </form>}

    <div className="gym-material-heading"><div><h2>{t('Material available')}</h2><p>{activeName}</p></div>{active.id === '2j' && (canEditOfficial
      ? <button type="button" className="gym-edit-official" onClick={() => openSheet(done => <OfficialEquipmentEditor close={done} />, { kind: 'full' })}><Icon name="pencil" />{t('Edit official equipment')}</button>
      : editable ? <span className="gym-fixed-note">{t('Material managed by 2J Fitness Center')}</span> : null)}</div>
    {editable && active.id === '2j' && <div className="gym-equipment-grid">
      {EQUIPMENT.map(item => {
        const available = active.availableEquipment.includes(item.id)
        return <button key={item.id} className={'gym-equipment-chip' + (available ? ' on' : '')} type="button" aria-pressed={available} disabled><Icon name={EQUIPMENT_ICONS[item.id] || 'checkCircle'} /><span>{t(item.label)}</span>{available && <Icon name="check" className="gym-equipment-check" />}</button>
      })}
    </div>}
    {editable && active.id !== '2j' && <PersonalEquipmentEditor key={active.id} profile={active} update={update} />}
    {!editable && <div className="gym-material-readonly">{active.availableEquipment.map(id => t(EQUIPMENT.find(e => e.id === id)?.label || id)).join(' · ') || t('No equipment selected')}</div>}
    <p className="gym-sheet-footnote">{t('Equipment is grouped by category. Check the specific machine before training.')}</p>
    {editable && (active.type === 'other' || active.type === 'custom') && <button className="gym-delete-place" onClick={() => update(s => { s.gymProfiles = { ...s.gymProfiles, activeId: '2j', custom: (s.gymProfiles?.custom || []).filter(p => p.id !== active.id) } })}><Icon name="trash" />{t('Delete place')}</button>}
    <div className="gym-sheet-bottom"><button className="btn gym-done-button" onClick={close}>{t('Done')}</button></div>
  </div>
}

export function GymCompatibility({ ex, context }) {
  const S = useStore(s => s.S)
  useStore(s => s.gymProfileRevision)
  return <span className="small dim">{compatibleWithGym(context || S, ex) ? t('Compatible with this place') : t('Equipment not confirmed here')}</span>
}

export default function GymProfile({ editable = false }) {
  const S = useStore(s => s.S)
  useStore(s => s.gymProfileRevision)
  const active = activeGymProfile(S)
  const openSheet = useUI(s => s.openSheet)
  const title = active.type === 'official' ? t(active.name) : active.name
  const open = () => openSheet(close => <GymProfileSheet close={close} editable={editable} />, { kind: 'full' })
  return <div className="gym-profile-row-wrap">
    <button className="lrow tap gym-profile-row" type="button" onClick={open} aria-label={`${t('Training place')}: ${title}`}>
      <span className="lrow-i soft gym-row-icon"><Icon name="mapPin" /></span>
      <span className="lrow-m"><span className="lrow-t">{t('Training place')}</span><span className="lrow-s">{title}</span></span>
      <Icon name="chevronRight" className="lrow-c" />
    </button>
    {editable && <button className="gym-row-info" type="button" aria-label={t('What is the training place?')} title={t('What is the training place?')} onClick={() => openSheet(close => <GymProfileHelp close={close} />)}><Icon name="info" /></button>}
  </div>
}
