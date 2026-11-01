// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, nameFor } from '../lib/i18n.js'
import { dateSortValue, fmtDate, fmtNum, uid, exCount, routineCount } from '../lib/format.js'
import { setLabel, modeOf, exLine, bestWeightFor, lastBW } from '../lib/history.js'
import { exOr, extractCustomDefs, mergeCustomDefs } from '../lib/exercises.js'
import { glyphOf } from '../lib/glyphs.js'
import Icon from '../components/Icon.jsx'
import { Thumb } from '../components/Media.jsx'
import { ListSkeleton } from '../components/v2.jsx'
import StaffBadge from '../components/StaffBadge.jsx'
import Stepper from '../components/Stepper.jsx'
import { Button, Segmented, TextArea, TextField, SelectRow } from '../components/ui.jsx'
import { confirmSheet, exercisePicker, goalSheet } from '../sheets.jsx'
import {
  fetchSocialRoutines, publishSocialRoutine, rateSocialRoutine, deleteSocialRoutine,
  fetchSocialPrograms, publishSocialProgram, rateSocialProgram, deleteSocialProgram,
  fetchWall, publishWallPost, deleteWallPost, postWallComment, deleteWallComment, setWallVisibility,
  fetchTopics, publishTopic, deleteTopic, postTopicComment, deleteTopicComment,
  fetchBoard, publishBoardPost, deleteBoardPost, toggleBoardComments, postBoardComment, deleteBoardComment,
  fetchChallenges, fetchChallengeDetail, createChallenge, joinChallenge, leaveChallenge, deleteChallenge,
  fetchGoals, publishGoal, unpublishGoal,
  fetchTrainerMembers, assignRoutineToMember, assignProgramToMember
} from '../lib/social-api.js'
import { resizeImageFile, uploadImage, mediaUrl, refetchAsDataUrl } from '../lib/media.js'
import { fetchFriends } from '../lib/friends-api.js'
import { fetchThreads } from '../lib/chat-api.js'
import { fetchNotifications } from '../lib/notifications-api.js'
import SocialShareSheet from '../components/SocialShareSheet.jsx'
import ReportContentButton from '../components/ReportContentButton.jsx'
import SocialMoments from './SocialMoments.jsx'
import { socialCardPayload } from '../lib/social-share.js'
import { communityIntroSeen, markCommunityIntroSeen } from '../lib/community-onboarding.js'
import { uxOn } from '../lib/features.js'

// Same "spec sheet" fields api/server.js's readSpecFields accepts — level/goal are fixed
// choices (goal reuses lib/starter.js's own GOALS, same labels the quick-plan intake uses, so
// "Build muscle" means the same thing whether it came from there or a Social publish).
const LEVELS = ['beginner', 'intermediate', 'advanced']
const LEVEL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }
const GOALS_LIST = ['hypertrophy', 'toning', 'fatloss', 'power', 'plyometrics', 'longevity']
const GOAL_LABEL = { hypertrophy: 'Build muscle', toning: 'Tone up', fatloss: 'Lose fat', power: 'Power', plyometrics: 'Plyometrics', longevity: 'Health & longevity' }

// Tap-to-rate when `onRate` is given, a plain readout otherwise (e.g. showing someone else's
// average). Rounds to the nearest whole star for the fill — half-stars would need a second
// icon/mask this hand-drawn set doesn't have, and a rounded average reads fine at this size.
function Stars({ value, onRate }) {
  const full = Math.round(value || 0)
  return <div className="row" style={{ gap: 2 }}>
    {[1, 2, 3, 4, 5].map(n => (
      <button key={n} className="iconbtn" style={{ width: 30, height: 30, color: n <= full ? 'var(--yellow)' : 'var(--label-2)', cursor: onRate ? 'pointer' : 'default' }}
        onClick={onRate ? () => onRate(n) : undefined} aria-label={String(n)}>
        <Icon name={n <= full ? 'starFill' : 'star'} />
      </button>
    ))}
  </div>
}

// A file input that reads the chosen photo and hands back a resized JPEG data URL (see
// lib/media.js's resizeImageFile) — this is what keeps an upload small without a bigger
// request-body cap or any server-side image library. `value` may start pre-filled with the
// routine/program's own already-uploaded cover (see PublishDetailsSheet).
function ImagePicker({ value, onChange }) {
  const inputRef = useRef(null)
  const toast = useUI(s => s.toast)
  const onFile = e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    resizeImageFile(file).then(onChange).catch(err => toast(err.message))
  }
  return <div>
    <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
    {value ? <div style={{ position: 'relative' }}>
      <img src={value} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: 12, display: 'block' }} />
      <button className="iconbtn" style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.55)', color: '#fff' }}
        onClick={() => onChange(null)} aria-label={t('Remove image')}><Icon name="xmark" /></button>
    </div> : <Button icon="upload" onClick={() => inputRef.current?.click()}>{t('Add a photo (optional)')}</Button>}
  </div>
}

// Hero image bleeding to the sheet's own edges (the sheet has 18px of horizontal padding —
// negative-margined out here) + a centered "spec sheet" (level · goal, days/week · duration —
// whichever of those four were actually filled in) + rating + author, shared by both the
// routine and the program detail sheets so a plan reads the same whichever kind it is.
function DetailHeader({ post, isProgram, isOwn, onRate }) {
  const img = mediaUrl(post.image)
  const line1 = [post.level && t(LEVEL_LABEL[post.level]), post.goal && t(GOAL_LABEL[post.goal])].filter(Boolean).join(' · ')
  const line2 = [isProgram && post.daysPerWeek && t('{0} days/week', post.daysPerWeek), post.duration].filter(Boolean).join(' · ')
  return <>
    {img && <img src={img} alt="" style={{ width: 'calc(100% + 36px)', margin: '0 -18px 14px', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }} />}
    <h3 style={{ textAlign: 'center' }}>{post.name}</h3>
    {!!(line1 || line2) && <div style={{ textAlign: 'center', marginTop: -8, marginBottom: 10 }}>
      {line1 && <div className="small dim">{line1}</div>}
      {line2 && <div className="small dim">{line2}</div>}
    </div>}
    <div className="row" style={{ justifyContent: 'center', gap: 8, margin: '0 0 4px' }}>
      <Stars value={post.avgStars || 0} />
      {post.ratingCount >= 5 && <span className="tag acc">{t('Popular')}</span>}
    </div>
    <div style={{ textAlign: 'center', marginBottom: 10 }} className="small muted">
      {post.ratingCount ? t('{0} ratings', post.ratingCount) : t('No ratings yet')}
    </div>
    <div className="row" style={{ justifyContent: 'center', gap: 6, marginBottom: 10 }}>
      <span className="lrow-i" style={{ width: 26, height: 26, fontSize: 13 }}><Icon name="person" /></span>
      <span className="small capitalize">{t('By {0}', post.authorName)}</span>
      {post.authorKind === 'trainer' && <StaffBadge />}
    </div>
    {post.description && <div className="small" style={{ margin: '10px 0', lineHeight: 1.5 }}>{post.description}</div>}
    {!isOwn && <div style={{ margin: '10px 0' }}>
      <div className="dim small" style={{ marginBottom: 4, textAlign: 'center' }}>{t('Your rating')}</div>
      <div className="row" style={{ justifyContent: 'center' }}><Stars value={post.myStars || 0} onRate={onRate} /></div>
    </div>}
    {isOwn && <div className="dim small" style={{ margin: '10px 0', textAlign: 'center' }}>{isProgram ? t("You can't rate your own program.") : t("You can't rate your own routine.")}</div>}
  </>
}

function RoutineCard({ post, onOpen }) {
  return <div className="item" onClick={() => onOpen(post)}>
    <span className="lrow-i"><Icon name={glyphOf(post.emoji)} /></span>
    <div className="grow">
      <div className="tt">{post.name}</div>
      <div className="ss capitalize row" style={{ gap: 4 }}>{post.authorName} · {exCount(post.ex.length)}{post.authorKind === 'trainer' && <StaffBadge size={11} />}</div>
    </div>
    {post.ratingCount ? <span className="tag acc"><Icon name="starFill" />{fmtNum(post.avgStars)} ({post.ratingCount})</span> : <span className="tag">{t('No ratings yet')}</span>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

// Image-led when one was uploaded — bigger than a routine card on purpose, the same way the
// Lyfta-style reference cards Juanjo shared stand out from a plain list row.
function ProgramCard({ post, onOpen }) {
  const img = mediaUrl(post.image)
  return <div className="item" style={{ flexDirection: 'column', alignItems: 'stretch', padding: img ? 0 : undefined, overflow: 'hidden' }} onClick={() => onOpen(post)}>
    {img && <img src={img} alt="" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover' }} />}
    <div className="row" style={{ padding: img ? '10px 14px 12px' : 0, width: '100%' }}>
      {!img && <span className="lrow-i"><Icon name={glyphOf(post.emoji)} /></span>}
      <div className="grow">
        <div className="tt">{post.name}</div>
        <div className="ss capitalize row" style={{ gap: 4 }}>{post.authorName} · {routineCount(post.routines.length)}{post.authorKind === 'trainer' && <StaffBadge size={11} />}</div>
      </div>
      {post.ratingCount ? <span className="tag acc"><Icon name="starFill" />{fmtNum(post.avgStars)} ({post.ratingCount})</span> : <span className="tag">{t('No ratings yet')}</span>}
      <Icon name="chevronRight" className="chev" />
    </div>
  </div>
}

function PickTypeSheet({ onRoutine, onProgram, close }) {
  return <>
    <h3>{t('What do you want to publish?')}</h3>
    <div className="list">
      <div className="item" onClick={() => { close(); onRoutine() }}>
        <span className="lrow-i"><Icon name="dumbbell" /></span>
        <div className="grow"><div className="tt">{t('A routine')}</div><div className="ss">{t("One session — a single day's training.")}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
      <div className="item" onClick={() => { close(); onProgram() }}>
        <span className="lrow-i"><Icon name="folder" /></span>
        <div className="grow"><div className="tt">{t('A full program')}</div><div className="ss">{t('Several routines grouped together.')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </div>
  </>
}

function PickRoutineSheet({ routines, onPick, close }) {
  return <>
    <h3>{t('Choose a routine')}</h3>
    {routines.length ? <div className="list">
      {routines.map(r => <div key={r.id} className="item" onClick={() => { close(); onPick(r) }}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
      </div>)}
    </div> : <div className="empty">{t('You have no routines yet.')}</div>}
  </>
}

function PickProgramSheet({ programs, onPick, close }) {
  return <>
    <h3>{t('Choose a program')}</h3>
    {programs.length ? <div className="list">
      {programs.map(p => <div key={p.id} className="item" onClick={() => { close(); onPick(p) }}>
        <span className="lrow-i"><Icon name={glyphOf(p.emoji)} /></span>
        <div className="grow"><div className="tt">{p.name}</div><div className="ss">{routineCount((p.routineIds || []).length)}</div></div>
      </div>)}
    </div> : <div className="empty">{t('You have no programs yet.')}</div>}
  </>
}

// Last step of publishing, for both kinds — an optional cover photo and a short explanation
// (why this one, who it's for) before the actual publish call.
function PublishDetailsSheet({ kind, source, S, onPublished, close }) {
  const toast = useUI(s => s.toast)
  const [image, setImage] = useState(null)
  const [description, setDescription] = useState('')
  const [level, setLevel] = useState('')
  const [goal, setGoal] = useState('')
  const [duration, setDuration] = useState('')
  const [daysPerWeek, setDaysPerWeek] = useState(3)
  const [busy, setBusy] = useState(false)

  // Already set a cover on this routine/program from Plan? Pre-fill it here (still replaceable/
  // removable) — refetched as its own data URL rather than reusing the stored filename, so the
  // Social post gets an independent copy neither side's later delete can break for the other.
  useEffect(() => {
    if (source.image) refetchAsDataUrl(source.image).then(setImage).catch(() => {})
  }, [])

  const publish = () => {
    const programRoutines = kind === 'program'
      ? (source.routineIds || []).map(rid => S.routines.find(r => r.id === rid)).filter(Boolean) : null
    if (kind === 'program' && !programRoutines.length) { toast(t('Add a routine to a program before publishing it.')); return }
    setBusy(true)
    const extra = { description: description.trim() }
    if (image) extra.image = image
    if (level) extra.level = level
    if (goal) extra.goal = goal
    if (duration.trim()) extra.duration = duration.trim()
    if (kind === 'program' && daysPerWeek) extra.daysPerWeek = daysPerWeek
    const req = kind === 'routine'
      ? publishSocialRoutine({ name: source.name, emoji: source.emoji, prog: source.prog, ex: source.ex, customExDefs: extractCustomDefs(source, S), ...extra })
      : publishSocialProgram({
        name: source.name, emoji: source.emoji,
        routines: programRoutines.map(r => ({ name: r.name, emoji: r.emoji, prog: r.prog, ex: r.ex, customExDefs: extractCustomDefs(r, S) })),
        ...extra
      })
    req.then(() => { toast(t('Published')); onPublished(); close() }).catch(e => { setBusy(false); toast(e.message) })
  }

  return <>
    <h3>{source.name}</h3>
    <div className="dim small" style={{ margin: '4px 0 14px' }}>{kind === 'program' ? t('Full program') : t('Routine')}</div>
    <ImagePicker value={image} onChange={setImage} />
    <div style={{ height: 14 }} />

    <div className="dim small" style={{ marginBottom: 6 }}>{t('Level (optional)')}</div>
    <Segmented options={[{ value: '', label: t('Any') }, ...LEVELS.map(l => ({ value: l, label: t(LEVEL_LABEL[l]) }))]} value={level} onChange={setLevel} />
    <div style={{ height: 12 }} />

    <SelectRow title={t('Goal (optional)')} sheetTitle={t('Goal')} value={goal}
      options={[{ value: '', label: t('None') }, ...GOALS_LIST.map(g => ({ value: g, label: t(GOAL_LABEL[g]) }))]}
      onChange={setGoal} />
    <div style={{ height: 12 }} />

    {kind === 'program' && <>
      <div className="dim small" style={{ marginBottom: 6 }}>{t('Days per week (optional)')}</div>
      <Segmented options={[2, 3, 4, 5, 6].map(n => ({ value: n, label: String(n) }))} value={daysPerWeek} onChange={setDaysPerWeek} />
      <div style={{ height: 12 }} />
    </>}

    <div className="dim small" style={{ marginBottom: 4 }}>{t('Duration (optional)')}</div>
    <input className="input" value={duration} onChange={e => setDuration(e.target.value)} maxLength={30} placeholder={t('e.g. “4 months”')} />
    <div style={{ height: 12 }} />

    <div className="dim small" style={{ marginBottom: 4 }}>{t('Description (optional)')}</div>
    <TextArea value={description} onChange={e => setDescription(e.target.value)} maxLength={300} rows={3} placeholder={t('Why this one, who it’s for…')} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy} onClick={publish}>{t('Publish')}</Button>
  </>
}

function MemberPickerSheet({ members, onPick, close }) {
  const [q, setQ] = useState('')
  const ql = q.toLowerCase().trim()
  const f = ql ? members.filter(m => m.name.toLowerCase().includes(ql)) : members
  return <>
    <h3>{t('Assign to a member')}</h3>
    <div className="search" style={{ margin: '6px 0 10px' }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search {0} members…', members.length)} value={q} onChange={e => setQ(e.target.value)} /></div>
    <div className="list">
      {f.map(m => <div key={m.id} className="item capitalize" onClick={() => { close(); onPick(m.id) }}>
        <div className="grow"><div className="tt">{m.name}</div></div>
      </div>)}
      {!f.length && <div className="empty">{t('No match')}</div>}
    </div>
  </>
}

function RoutineDetailSheet({ post: initial, onChanged, close }) {
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [post, setPost] = useState(initial)
  const [busy, setBusy] = useState(false)
  const customMap = Object.fromEntries((post.customExDefs || []).map(d => [d.id, d]))
  const resolveEx = id => customMap[id] || exOr(id)
  const isOwn = post.authorId === user?.id
  const canManage = isOwn || user?.admin

  const rate = stars => {
    rateSocialRoutine(post.id, stars)
      .then(res => {
        setPost(p => ({ ...p, avgStars: res.avgStars, ratingCount: res.ratingCount, myStars: res.myStars }))
        onChanged()   // background refresh so the card behind this sheet shows the new average too
      })
      .catch(e => toast(e.message))
  }
  const copy = () => {
    const r = { id: uid(), name: post.name, emoji: post.emoji, ex: JSON.parse(JSON.stringify(post.ex)) }
    if (post.prog) r.prog = post.prog
    update(s => { s.routines.push(r); s.customEx = mergeCustomDefs(post.customExDefs, s.customEx) })
    toast(t('Added to your routines'))
    close()
  }
  const del = () => confirmSheet({
    title: t('Delete this routine?'), message: t('This removes it from Social for everyone.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => deleteSocialRoutine(post.id).then(() => { toast(t('Deleted')); onChanged(); close() }).catch(e => toast(e.message))
  })
  const assign = () => {
    setBusy(true)
    fetchTrainerMembers().then(members => {
      setBusy(false)
      openSheet(close2 => <MemberPickerSheet members={members} close={close2} onPick={memberId => {
        assignRoutineToMember(post.id, memberId).then(() => toast(t('Assigned to {0}', members.find(m => m.id === memberId)?.name || '')))
          .catch(e => toast(e.message))
      }} />)
    }).catch(e => { setBusy(false); toast(e.message) })
  }

  return <>
    <DetailHeader post={post} isProgram={false} isOwn={isOwn} onRate={rate} />
    <Button icon="upload" style={{ width: '100%', margin: '0 0 10px' }} onClick={() => openSheet(close2 => <SocialShareSheet data={socialCardPayload('routine', { title: post.name, subtitle: post.description || t('A routine shared with the 2J community'), metric: t('{0} exercises', post.ex.length), date: fmtDate(post.createdAt, true) })} shareTarget={isOwn ? { kind: 'routine', targetId: post.id } : null} close={close2} />, { kind: 'center' })}>{t('Share')}</Button>
    <h4 className="sec">{t('Exercises')}</h4>
    <div className="list" style={{ marginBottom: 12 }}>
      {post.ex.map((e, i) => {
        const ex = resolveEx(e.id)
        return <div key={i} className="item">
          <Thumb ex={ex} />
          <div className="grow"><div className="tt capitalize">{nameFor(ex)}</div>
            <div className="ss">{exLine(e, S.unit)}</div></div>
        </div>
      })}
    </div>
    <Button variant="primary" style={{ width: '100%', marginBottom: 8 }} onClick={copy}>{t('Copy to my routines')}</Button>
    {user?.trainer && isOwn && post.authorKind === 'trainer' &&
      <Button style={{ width: '100%', marginBottom: 8 }} disabled={busy} onClick={assign}>{t('Assign to a member')}</Button>}
    {canManage && <button className="btn danger" style={{ width: '100%' }} onClick={del}>{t('Delete')}</button>}
  </>
}

function ProgramDetailSheet({ post: initial, onChanged, close }) {
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [post, setPost] = useState(initial)
  const [busy, setBusy] = useState(false)
  const isOwn = post.authorId === user?.id
  const canManage = isOwn || user?.admin

  const rate = stars => {
    rateSocialProgram(post.id, stars)
      .then(res => {
        setPost(p => ({ ...p, avgStars: res.avgStars, ratingCount: res.ratingCount, myStars: res.myStars }))
        onChanged()
      })
      .catch(e => toast(e.message))
  }
  const copy = () => {
    const newIds = []
    update(s => {
      post.routines.forEach(r => {
        const nr = { id: uid(), name: r.name, emoji: r.emoji, ex: JSON.parse(JSON.stringify(r.ex)) }
        if (r.prog) nr.prog = r.prog
        s.routines.push(nr)
        newIds.push(nr.id)
        s.customEx = mergeCustomDefs(r.customExDefs, s.customEx)
      })
      s.programs = s.programs || []
      s.programs.push({ id: uid(), name: post.name, emoji: post.emoji, routineIds: newIds })
    })
    toast(t('Added to your programs'))
    close()
  }
  const del = () => confirmSheet({
    title: t('Delete this program?'), message: t('This removes it from Social for everyone.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => deleteSocialProgram(post.id).then(() => { toast(t('Deleted')); onChanged(); close() }).catch(e => toast(e.message))
  })
  const assign = () => {
    setBusy(true)
    fetchTrainerMembers().then(members => {
      setBusy(false)
      openSheet(close2 => <MemberPickerSheet members={members} close={close2} onPick={memberId => {
        assignProgramToMember(post.id, memberId).then(() => toast(t('Assigned to {0}', members.find(m => m.id === memberId)?.name || '')))
          .catch(e => toast(e.message))
      }} />)
    }).catch(e => { setBusy(false); toast(e.message) })
  }

  return <>
    <DetailHeader post={post} isProgram={true} isOwn={isOwn} onRate={rate} />
    <Button icon="upload" style={{ width: '100%', margin: '0 0 10px' }} onClick={() => openSheet(close2 => <SocialShareSheet data={socialCardPayload('program', { title: post.name, subtitle: post.description || t('A program shared with the 2J community'), metric: t('{0} routines', post.routines.length), date: fmtDate(post.createdAt, true), items: post.routines.map(r => r.name), facts: [post.daysPerWeek ? t('{0} days a week', post.daysPerWeek) : '', post.level ? t(LEVEL_LABEL[post.level]) : '', post.goal ? t(GOAL_LABEL[post.goal]) : ''].filter(Boolean) })} shareTarget={isOwn ? { kind: 'program', targetId: post.id } : null} close={close2} />, { kind: 'center' })}>{t('Share')}</Button>
    <h4 className="sec">{t('Workouts in this program')}</h4>
    <div className="list" style={{ marginBottom: 12 }}>
      {post.routines.map((r, i) => <div key={i} className="item"
        onClick={() => openSheet(close2 => <RoutineExercisesSheet routine={r} unit={S.unit} close={close2} />)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>)}
    </div>
    <Button variant="primary" style={{ width: '100%', marginBottom: 8 }} onClick={copy}>{t('Copy to my programs')}</Button>
    {user?.trainer && isOwn && post.authorKind === 'trainer' &&
      <Button style={{ width: '100%', marginBottom: 8 }} disabled={busy} onClick={assign}>{t('Assign to a member')}</Button>}
    {canManage && <button className="btn danger" style={{ width: '100%' }} onClick={del}>{t('Delete')}</button>}
  </>
}

// Read-only drill-down from a program into one of its routines — the exercise photos are what
// make this worth a tap rather than just showing the exercise count on the row above.
function RoutineExercisesSheet({ routine, unit }) {
  const customMap = Object.fromEntries((routine.customExDefs || []).map(d => [d.id, d]))
  const resolveEx = id => customMap[id] || exOr(id)
  return <>
    <h3>{routine.name}</h3>
    <div className="list">
      {routine.ex.map((e, i) => {
        const ex = resolveEx(e.id)
        return <div key={i} className="item">
          <Thumb ex={ex} />
          <div className="grow"><div className="tt capitalize">{nameFor(ex)}</div><div className="ss">{exLine(e, unit)}</div></div>
        </div>
      })}
    </div>
  </>
}

function WallDetailSheet({ post: initial, onChanged, close }) {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [post, setPost] = useState(initial)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const send = () => {
    const v = text.trim()
    if (!v) return
    setBusy(true)
    postWallComment(post.id, v).then(res => {
      setPost(p => ({ ...p, comments: [...(p.comments || []), res.comment] }))
      setText('')
      setBusy(false)
    }).catch(e => { setBusy(false); toast(e.message) })
  }
  const removeComment = c => {
    deleteWallComment(post.id, c.id)
      .then(() => setPost(p => ({ ...p, comments: (p.comments || []).filter(x => x.id !== c.id) })))
      .catch(e => toast(e.message))
  }
  const delPost = () => confirmSheet({
    title: t('Delete this post?'), confirmText: t('Delete'), danger: true,
    onConfirm: () => deleteWallPost(post.id).then(() => { toast(t('Deleted')); onChanged(); close() }).catch(e => toast(e.message))
  })
  const isOwn = post.authorId === user?.id
  const toggleVisibility = () => {
    const next = !post.public
    setWallVisibility(post.id, next)
      .then(() => setPost(p => ({ ...p, public: next })))
      .catch(e => toast(e.message))
  }

  return <>
    <div className="row" style={{ gap: 10, marginBottom: 10 }}>
      <Thumb ex={exOr(post.exId)} />
      <div className="grow">
        <div className="tt capitalize">{post.exName}</div>
        <div className="ss capitalize row" style={{ gap: 4 }}>{post.authorName} · {setLabel(post.exId, post.value, { mode: post.mode })} · {fmtDate(post.sourceDate, true)}{post.authorKind === 'trainer' && <StaffBadge size={11} />}</div>
      </div>
    </div>
    <Button icon="upload" style={{ width: '100%', marginBottom: 10 }} onClick={() => openSheet(close2 => <SocialShareSheet data={socialCardPayload('record', { title: post.exName, metric: setLabel(post.exId, post.value, { mode: post.mode }), subtitle: t('Personal record shared by {0}', post.authorName), date: fmtDate(post.sourceDate, true) })} shareTarget={isOwn ? { kind: 'record', targetId: post.id } : null} close={close2} />, { kind: 'center' })}>{t('Share')}</Button>
    {post.note && <div className="small" style={{ margin: '0 0 14px', lineHeight: 1.5 }}>“{post.note}”</div>}
    {(isOwn || user?.admin) && <div className="row between" style={{ margin: '0 0 14px', padding: '10px 12px', borderRadius: 10, background: 'var(--fill)' }}>
      <div className="row" style={{ gap: 6 }}><Icon name={post.public ? 'globe' : 'lock'} style={{ width: 16, height: 16 }} /><div className="small">{post.public ? t('Visible to everyone') : t('Only visible to you')}</div></div>
      <Button size="sm" variant={post.public ? 'primary' : 'tinted'} onClick={toggleVisibility}>{post.public ? t('Public') : t('Private')}</Button>
    </div>}
    <h4 className="sec">{t('Comments')}</h4>
    <div className="list" style={{ gap: 0, marginBottom: 10 }}>
      {(post.comments || []).map(c => <div key={c.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div style={{ minWidth: 0 }}>
          <div className="small capitalize row" style={{ gap: 4, fontWeight: 600 }}>{c.authorName}{c.authorKind === 'trainer' && <StaffBadge size={11} />}</div>
          <div className="small">{c.text}</div>
        </div>
        <div className="row" style={{ gap: 2 }}>
          {c.authorId !== user?.id && <ReportContentButton icon targetType="comment" targetId={'wall:' + post.id + ':' + c.id} />}
          {(c.authorId === user?.id || user?.admin) &&
            <button className="iconbtn" onClick={() => removeComment(c)} aria-label={t('Delete')}><Icon name="trash" /></button>}
        </div>
      </div>)}
      {!(post.comments || []).length && <div className="muted small" style={{ padding: '6px 2px' }}>{t('No comments yet.')}</div>}
    </div>
    <TextArea rows={3} maxLength={300} value={text} placeholder={t('Add a comment…')} onChange={e => setText(e.target.value)} />
    <div style={{ height: 10 }} />
    <div className="row" style={{ gap: 8 }}>
      <Button variant="primary" style={{ flex: 1 }} disabled={busy || !text.trim()} onClick={send}>{t('Send')}</Button>
      {(post.authorId === user?.id || user?.admin) &&
        <Button variant="danger" style={{ flex: 1 }} onClick={delPost}>{t('Delete post')}</Button>}
    </div>
  </>
}

/* ============================ muro (topics chat) ============================ */
// A gym-wide forum: anyone opens a topic, anyone comments. Moderation is wider than the Wall's
// own (authorId-or-admin) — here any trainer can remove any topic or comment too, per the
// owner's own choice, so the flat-comment pattern from WallDetailSheet gets that one check widened.
const canModerate = user => !!(user?.admin || user?.trainer)

function NewTopicSheet({ close, onPublished }) {
  const toast = useUI(s => s.toast)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = () => {
    if (!title.trim() || !text.trim()) { toast(t('Give it a title and a message.')); return }
    setBusy(true)
    publishTopic({ title: title.trim(), text: text.trim() })
      .then(() => { toast(t('Topic created')); onPublished(); close() })
      .catch(e => { setBusy(false); toast(e.message) })
  }
  return <>
    <h3>{t('New topic')}</h3>
    <TextField placeholder={t('Title')} maxLength={80} value={title} onChange={e => setTitle(e.target.value)} />
    <div style={{ height: 10 }} />
    <TextArea rows={4} maxLength={1000} placeholder={t('What do you want to talk about?')} value={text} onChange={e => setText(e.target.value)} />
    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={busy} onClick={send}>{t('Post')}</Button>
  </>
}

function TopicDetailSheet({ topic: initial, onChanged, close }) {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [topic, setTopic] = useState(initial)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const send = () => {
    const v = text.trim()
    if (!v) return
    setBusy(true)
    postTopicComment(topic.id, v).then(res => {
      setTopic(p => ({ ...p, comments: [...(p.comments || []), res.comment] }))
      setText('')
      setBusy(false)
    }).catch(e => { setBusy(false); toast(e.message) })
  }
  const removeComment = c => {
    deleteTopicComment(topic.id, c.id)
      .then(() => setTopic(p => ({ ...p, comments: (p.comments || []).filter(x => x.id !== c.id) })))
      .catch(e => toast(e.message))
  }
  const delTopic = () => confirmSheet({
    title: t('Delete this topic?'), confirmText: t('Delete'), danger: true,
    onConfirm: () => deleteTopic(topic.id).then(() => { toast(t('Deleted')); onChanged(); close() }).catch(e => toast(e.message))
  })

  return <>
    <h3>{topic.title}</h3>
    <div className="ss capitalize row" style={{ gap: 4, margin: '2px 0 12px' }}>{topic.authorName}{topic.authorKind === 'trainer' && <StaffBadge size={11} />} · {fmtDate(topic.createdAt, true)}</div>
    <div className="small" style={{ margin: '0 0 14px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{topic.text}</div>
    <h4 className="sec">{t('Comments')}</h4>
    <div className="list" style={{ gap: 0, marginBottom: 10 }}>
      {(topic.comments || []).map(c => <div key={c.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div style={{ minWidth: 0 }}>
          <div className="small capitalize row" style={{ gap: 4, fontWeight: 600 }}>{c.authorName}{c.authorKind === 'trainer' && <StaffBadge size={11} />}</div>
          <div className="small">{c.text}</div>
        </div>
        <div className="row" style={{ gap: 2 }}>
          {c.authorId !== user?.id && <ReportContentButton icon targetType="comment" targetId={'topic:' + topic.id + ':' + c.id} />}
          {(c.authorId === user?.id || canModerate(user)) &&
            <button className="iconbtn" onClick={() => removeComment(c)} aria-label={t('Delete')}><Icon name="trash" /></button>}
        </div>
      </div>)}
      {!(topic.comments || []).length && <div className="muted small" style={{ padding: '6px 2px' }}>{t('No comments yet.')}</div>}
    </div>
    <TextArea rows={3} maxLength={300} value={text} placeholder={t('Add a comment…')} onChange={e => setText(e.target.value)} />
    <div style={{ height: 10 }} />
    <div className="row" style={{ gap: 8 }}>
      <Button variant="primary" style={{ flex: 1 }} disabled={busy || !text.trim()} onClick={send}>{t('Send')}</Button>
      {(topic.authorId === user?.id || canModerate(user)) &&
        <Button variant="danger" style={{ flex: 1 }} onClick={delTopic}>{t('Delete topic')}</Button>}
    </div>
  </>
}

/* ============================ tablón de entrenadores ============================ */
// Read-only by default: a trainer/admin can flip `commentsEnabled` on any post from the detail
// sheet, and only then does the comment box appear — the server enforces the same gate, this is
// just the UI reflecting it.

function NewBoardPostSheet({ close, onPublished }) {
  const toast = useUI(s => s.toast)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const send = () => {
    if (!title.trim() || !text.trim()) { toast(t('Give it a title and a message.')); return }
    setBusy(true)
    publishBoardPost({ title: title.trim(), text: text.trim() })
      .then(() => { toast(t('Posted')); onPublished(); close() })
      .catch(e => { setBusy(false); toast(e.message) })
  }
  return <>
    <h3>{t('New announcement')}</h3>
    <TextField placeholder={t('Title')} maxLength={80} value={title} onChange={e => setTitle(e.target.value)} />
    <div style={{ height: 10 }} />
    <TextArea rows={5} maxLength={2000} placeholder={t('News, an idea, a test to try…')} value={text} onChange={e => setText(e.target.value)} />
    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={busy} onClick={send}>{t('Post')}</Button>
  </>
}

function BoardDetailSheet({ post: initial, onChanged, close }) {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [post, setPost] = useState(initial)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const send = () => {
    const v = text.trim()
    if (!v) return
    setBusy(true)
    postBoardComment(post.id, v).then(res => {
      setPost(p => ({ ...p, comments: [...(p.comments || []), res.comment] }))
      setText('')
      setBusy(false)
    }).catch(e => { setBusy(false); toast(e.message) })
  }
  const removeComment = c => {
    deleteBoardComment(post.id, c.id)
      .then(() => setPost(p => ({ ...p, comments: (p.comments || []).filter(x => x.id !== c.id) })))
      .catch(e => toast(e.message))
  }
  const delPost = () => confirmSheet({
    title: t('Delete this announcement?'), confirmText: t('Delete'), danger: true,
    onConfirm: () => deleteBoardPost(post.id).then(() => { toast(t('Deleted')); onChanged(); close() }).catch(e => toast(e.message))
  })
  const toggleComments = () => {
    const next = !post.commentsEnabled
    toggleBoardComments(post.id, next)
      .then(() => setPost(p => ({ ...p, commentsEnabled: next })))
      .catch(e => toast(e.message))
  }

  return <>
    <h3>{post.title}</h3>
    <div className="ss capitalize row" style={{ gap: 4, margin: '2px 0 12px' }}>{post.authorName}<StaffBadge size={11} /> · {fmtDate(post.createdAt, true)}</div>
    <div className="small" style={{ margin: '0 0 14px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{post.text}</div>

    {canModerate(user) && <div className="row between" style={{ margin: '0 0 14px', padding: '10px 12px', borderRadius: 10, background: 'var(--fill)' }}>
      <div className="small">{t('Allow comments on this post')}</div>
      <Button size="sm" variant={post.commentsEnabled ? 'primary' : 'tinted'} onClick={toggleComments}>{post.commentsEnabled ? t('Enabled') : t('Disabled')}</Button>
    </div>}

    {post.commentsEnabled ? <>
      <h4 className="sec">{t('Comments')}</h4>
      <div className="list" style={{ gap: 0, marginBottom: 10 }}>
        {(post.comments || []).map(c => <div key={c.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <div style={{ minWidth: 0 }}>
            <div className="small capitalize row" style={{ gap: 4, fontWeight: 600 }}>{c.authorName}{c.authorKind === 'trainer' && <StaffBadge size={11} />}</div>
            <div className="small">{c.text}</div>
          </div>
          <div className="row" style={{ gap: 2 }}>
            {c.authorId !== user?.id && <ReportContentButton icon targetType="comment" targetId={'board:' + post.id + ':' + c.id} />}
            {(c.authorId === user?.id || canModerate(user)) &&
              <button className="iconbtn" onClick={() => removeComment(c)} aria-label={t('Delete')}><Icon name="trash" /></button>}
          </div>
        </div>)}
        {!(post.comments || []).length && <div className="muted small" style={{ padding: '6px 2px' }}>{t('No comments yet.')}</div>}
      </div>
      <TextArea rows={3} maxLength={300} value={text} placeholder={t('Add a comment…')} onChange={e => setText(e.target.value)} />
      <div style={{ height: 10 }} />
    </> : <div className="dim small" style={{ margin: '0 0 14px' }}>{t('Comments are off for this post.')}</div>}

    <div className="row" style={{ gap: 8 }}>
      {post.commentsEnabled && <Button variant="primary" style={{ flex: 1 }} disabled={busy || !text.trim()} onClick={send}>{t('Send')}</Button>}
      {(post.authorId === user?.id || user?.admin) &&
        <Button variant="danger" style={{ flex: 1 }} onClick={delPost}>{t('Delete post')}</Button>}
    </div>
  </>
}

/* ============================ challenges & goals ============================ */
// A challenge is gym-wide and trainer-authored; progress is never typed in by hand, only ever
// computed server-side from what the participant already logged (see api/server.js's
// challengeProgress). A goal is the opposite direction: personal and private by default
// (generalises S.targetW, the existing bodyweight goal, to any exercise) — publishing one is
// the one deliberate act that puts a single number of theirs in front of the rest of the gym.

function ChallengeCard({ c, onOpen }) {
  const metricLabel = c.type === 'frequency'
    ? `${c.targetWorkouts} entrenos`
    : `${c.targetValue} ${c.metric === 'volume' ? 'kg' : c.metric === 'reps' ? 'reps' : 'series'} · ${c.exName || c.exId}`
  return <div className="item v2-challenge" onClick={() => onOpen(c)}>
    <span className="lrow-i"><Icon name="trophy" /></span>
    <div className="grow">
      <div className="tt">{c.name}</div>
      <div className="ss">{metricLabel} · {c.participantCount} apuntados</div>
    </div>
    {c.joined ? <span className="tag acc">Apuntado</span> : !c.active ? <span className="tag">Terminado</span> : null}
    <Icon name="chevronRight" className="chev" />
  </div>
}

function NewChallengeSheet({ close, onCreated }) {
  const toast = useUI(s => s.toast)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState('frequency')
  const [targetWorkouts, setTargetWorkouts] = useState(12)
  const [ex, setEx] = useState(null)
  const [metric, setMetric] = useState('sets')
  const [targetValue, setTargetValue] = useState(100)
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [endDate, setEndDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 28); return d.toISOString().slice(0, 10) })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) { toast('Ponle un nombre al desafío'); return }
    if (type === 'exercise' && !ex) { toast('Elige un ejercicio'); return }
    setBusy(true)
    try {
      await createChallenge({
        name: name.trim(), description: description.trim(), type, startDate, endDate,
        targetWorkouts, exId: ex?.id, exName: ex ? nameFor(ex) : undefined, metric, targetValue
      })
      toast('Desafío creado')
      close(); onCreated?.()
    } catch (e) { toast(e.message) }
    setBusy(false)
  }

  return <>
    <h3>Nuevo desafío</h3>
    <TextField placeholder="Nombre del desafío" maxLength={60} value={name} onChange={e => setName(e.target.value)} />
    <div style={{ height: 10 }} />
    <TextArea rows={2} maxLength={300} placeholder="Descripción (opcional)" value={description} onChange={e => setDescription(e.target.value)} />
    <div style={{ height: 14 }} />
    <Segmented options={[{ value: 'frequency', label: 'Frecuencia' }, { value: 'exercise', label: 'Un ejercicio' }]} value={type} onChange={setType} />
    <div style={{ height: 14 }} />
    {type === 'frequency' ? (
      <Stepper label="Entrenos a completar" value={targetWorkouts} step={1} decimal={false} onChange={setTargetWorkouts} />
    ) : <>
      <Button icon="magnifier" onClick={() => exercisePicker(picked => setEx(picked))}>{ex ? nameFor(ex) : 'Elegir ejercicio'}</Button>
      <div style={{ height: 10 }} />
      <Segmented options={[{ value: 'sets', label: 'Series' }, { value: 'reps', label: 'Reps' }, { value: 'volume', label: 'Volumen' }]} value={metric} onChange={setMetric} />
      <div style={{ height: 10 }} />
      <Stepper label={metric === 'volume' ? 'Objetivo (kg)' : metric === 'reps' ? 'Objetivo (reps)' : 'Objetivo (series)'}
        value={targetValue} step={metric === 'volume' ? 50 : 5} decimal={false} onChange={setTargetValue} />
    </>}
    <div style={{ height: 14 }} />
    <div className="row" style={{ gap: 10 }}>
      <div className="grow"><div className="dim small" style={{ marginBottom: 4 }}>Empieza</div>
        <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></div>
      <div className="grow"><div className="dim small" style={{ marginBottom: 4 }}>Termina</div>
        <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></div>
    </div>
    <div style={{ height: 16 }} />
    <Button variant="primary" disabled={busy} onClick={save}>Crear desafío</Button>
  </>
}

function ChallengeDetailSheet({ id, onChanged, close }) {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => fetchChallengeDetail(id).then(setD).catch(e => toast(e.message))
  useEffect(() => { load() }, [])
  if (!d) return <ListSkeleton />
  const c = d.challenge
  const unitLabel = c.metric === 'volume' ? 'kg' : c.metric === 'reps' ? 'reps' : c.metric === 'sets' ? 'series' : 'entrenos'
  const toggleJoin = async () => {
    setBusy(true)
    try { d.joined ? await leaveChallenge(id) : await joinChallenge(id); await load(); onChanged?.() }
    catch (e) { toast(e.message) }
    setBusy(false)
  }
  const del = () => confirmSheet({
    title: '¿Eliminar este desafío?', message: 'Se borra para todos los apuntados.', confirmText: t('Delete'), danger: true,
    onConfirm: () => deleteChallenge(id).then(() => { toast(t('Deleted')); onChanged?.(); close() }).catch(e => toast(e.message))
  })
  return <>
    <h3>{c.name}</h3>
    <Button icon="upload" style={{ width: '100%', margin: '0 0 10px' }} onClick={() => openSheet(close2 => <SocialShareSheet data={socialCardPayload('challenge', { title: c.name, subtitle: c.description || t('Train together'), metric: c.type === 'frequency' ? t('{0} workouts', c.targetWorkouts) : `${c.targetValue} ${unitLabel}`, date: `${fmtDate(c.startDate)} – ${fmtDate(c.endDate)}` })} shareTarget={{ kind: 'challenge', targetId: c.id }} close={close2} />, { kind: 'center' })}>{t('Share')}</Button>
    {c.description && <div className="small dim" style={{ margin: '6px 0 12px', lineHeight: 1.5 }}>{c.description}</div>}
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
      <span className="tag acc">{c.type === 'frequency' ? `${c.targetWorkouts} entrenos` : `${c.targetValue} ${unitLabel} · ${c.exName}`}</span>
      <span className="tag">{fmtDate(c.startDate)} – {fmtDate(c.endDate)}</span>
    </div>
    <h4 className="sec" style={{ marginTop: 0 }}>Clasificación</h4>
    <div className="list" style={{ marginBottom: 14 }}>
      {!d.leaderboardVisible && <div className="muted small" style={{ padding: '6px 2px' }}>{t('Join this challenge to see its shared leaderboard.')}</div>}
      {d.leaderboard.map((row, i) => <div key={row.userId} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="dim small" style={{ width: 18, textAlign: 'right' }}>{i + 1}</span>
          <span className="small capitalize" style={row.userId === user?.id ? { fontWeight: 700, color: 'var(--acc)' } : { fontWeight: 500 }}>{row.userName}</span>
        </div>
        <span className="small">{row.value}{c.type === 'frequency' ? '' : ' ' + unitLabel}</span>
      </div>)}
      {d.leaderboardVisible && !d.leaderboard.length && <div className="dim small" style={{ padding: '6px 2px' }}>{t('No shared results yet.')}</div>}
    </div>
    <Button variant={d.joined ? 'danger' : 'primary'} disabled={busy} onClick={toggleJoin}>{d.joined ? 'Dejar el desafío' : 'Apuntarme'}</Button>
    {(user?.id === c.authorId || user?.admin) && <><div style={{ height: 8 }} /><Button variant="danger" onClick={del}>Eliminar desafío</Button></>}
  </>
}

function ChallengesSection({ challenges, loadChallenges, user }) {
  const openSheet = useUI(s => s.openSheet)
  const openDetail = c => openSheet(close => <ChallengeDetailSheet id={c.id} onChanged={loadChallenges} close={close} />)
  const active = (challenges || []).filter(c => c.active)
  const past = (challenges || []).filter(c => !c.active)
  return <>
    <div className="row between" style={{ marginBottom: 10 }}>
      <h4 className="sec" style={{ margin: 0 }}>Desafíos</h4>
      {user?.trainer && <Button size="sm" variant="tinted" icon="plus"
        onClick={() => openSheet(close => <NewChallengeSheet close={close} onCreated={loadChallenges} />)}>Crear</Button>}
    </div>
    {challenges === null ? <ListSkeleton /> :
      active.length ? <div className="list" style={{ marginBottom: past.length ? 18 : 0 }}>{active.map(c => <ChallengeCard key={c.id} c={c} onOpen={openDetail} />)}</div> :
        <div className="empty"><div className="ico"><Icon name="trophy" /></div>Todavía no hay desafíos activos.</div>}
    {past.length > 0 && <>
      <h4 className="sec">Terminados</h4>
      <div className="list">{past.map(c => <ChallengeCard key={c.id} c={c} onOpen={openDetail} />)}</div>
    </>}
  </>
}

function ExerciseGoalSheet({ exId, exName, current, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [v, setV] = useState(S.exGoals?.[exId] || Math.round(((current || 20) * 1.1) / 2.5) * 2.5)
  const save = () => { update(s => { s.exGoals = s.exGoals || {}; s.exGoals[exId] = v }); close() }
  const remove = () => { update(s => { if (s.exGoals) delete s.exGoals[exId] }); close() }
  return <>
    <h3 className="capitalize">Meta: {exName}</h3>
    {current > 0 && <div className="dim small" style={{ marginBottom: 12 }}>Tu mejor marca ahora mismo: {fmtNum(current)} {S.unit}</div>}
    <Stepper label={`Objetivo (${S.unit})`} value={v} step={2.5} onChange={setV} />
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>Guardar meta</Button>
    {S.exGoals?.[exId] != null && <><div style={{ height: 8 }} /><Button variant="danger" onClick={remove}>Quitar meta</Button></>}
  </>
}

function GoalsSection({ goals, loadGoals }) {
  const S = useStore(st => st.S)
  const user = useStore(st => st.user)
  const toast = useUI(st => st.toast)
  const openSheet = useUI(st => st.openSheet)
  const [busyKey, setBusyKey] = useState(null)

  const bw = lastBW(S)
  const myExGoalIds = Object.keys(S.exGoals || {})
  const mine = new Map((goals || []).filter(g => g.userId === user?.id).map(g => [g.kind === 'bodyweight' ? 'bw' : g.exId, g]))
  const others = (goals || []).filter(g => g.userId !== user?.id)

  const togglePublishBW = async () => {
    setBusyKey('bw')
    try {
      const pub = mine.get('bw')
      if (pub) await unpublishGoal(pub.id); else await publishGoal({ kind: 'bodyweight', target: S.targetW })
      await loadGoals()
    } catch (e) { toast(e.message) }
    setBusyKey(null)
  }
  const togglePublishEx = async (exId, target) => {
    setBusyKey(exId)
    try {
      const pub = mine.get(exId)
      if (pub) await unpublishGoal(pub.id); else await publishGoal({ kind: 'exercise', exId, exName: nameFor(exOr(exId)), target })
      await loadGoals()
    } catch (e) { toast(e.message) }
    setBusyKey(null)
  }
  const addExerciseGoal = () => exercisePicker(ex =>
    openSheet(close => <ExerciseGoalSheet exId={ex.id} exName={nameFor(ex)} current={bestWeightFor(S, ex.id)} close={close} />))

  return <>
    <div className="row between" style={{ marginBottom: 10 }}>
      <h4 className="sec" style={{ margin: 0 }}>Tus metas</h4>
      <Button size="sm" variant="tinted" icon="plus" onClick={addExerciseGoal}>Añadir</Button>
    </div>
    <div className="list" style={{ marginBottom: 18 }}>
      <div className="item" onClick={() => goalSheet()}>
        <span className="lrow-i" style={{ '--tint': 'var(--yellow)' }}><Icon name="target" /></span>
        <div className="grow">
          <div className="tt">Peso corporal</div>
          <div className="ss">{S.targetW ? `Objetivo ${fmtNum(S.targetW)} ${S.unit}${bw ? ` · actual ${fmtNum(bw.w)} ${S.unit}` : ''}` : 'Sin meta fijada'}</div>
        </div>
        {!!S.targetW && <Button size="sm" variant={mine.has('bw') ? 'primary' : 'tinted'} disabled={busyKey === 'bw'}
          onClick={e => { e.stopPropagation(); togglePublishBW() }}>{mine.has('bw') ? 'Publicada' : 'Publicar'}</Button>}
      </div>
      {myExGoalIds.map(exId => {
        const ex = exOr(exId)
        const target = S.exGoals[exId]
        const current = bestWeightFor(S, exId)
        return <div key={exId} className="item" onClick={() => openSheet(close => <ExerciseGoalSheet exId={exId} exName={nameFor(ex)} current={current} close={close} />)}>
          <span className="lrow-i" style={{ '--tint': 'var(--acc)' }}><Icon name="target" /></span>
          <div className="grow">
            <div className="tt capitalize">{nameFor(ex)}</div>
            <div className="ss">{`Objetivo ${fmtNum(target)} ${S.unit} · actual ${fmtNum(current)} ${S.unit}`}</div>
          </div>
          <Button size="sm" variant={mine.has(exId) ? 'primary' : 'tinted'} disabled={busyKey === exId}
            onClick={e => { e.stopPropagation(); togglePublishEx(exId, target) }}>{mine.has(exId) ? 'Publicada' : 'Publicar'}</Button>
        </div>
      })}
      {!myExGoalIds.length && <div className="dim small" style={{ padding: '10px 2px' }}>Añade una meta de un ejercicio concreto para hacerle seguimiento.</div>}
    </div>

    <h4 className="sec">Metas de la comunidad</h4>
    {goals === null ? <ListSkeleton /> :
      others.length ? <div className="list">{others.map(g => {
        const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0
        return <div key={g.id} className="item" style={{ cursor: 'default' }}>
          <span className="lrow-i" style={{ '--tint': 'var(--acc)' }}><Icon name="target" /></span>
          <div className="grow">
            <div className="tt capitalize row" style={{ gap: 4 }}>{g.kind === 'bodyweight' ? 'Peso corporal' : g.exName}{g.authorKind === 'trainer' && <StaffBadge size={11} />}</div>
            <div className="ss">{g.userName} · {fmtNum(g.current)} / {fmtNum(g.target)} {g.unit}{pct >= 100 ? ' · ¡conseguida!' : ''}</div>
          </div>
        </div>
      })}</div> : <div className="dim small" style={{ padding: '10px 2px' }}>Nadie ha publicado una meta todavía.</div>}
  </>
}

export default function Social() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const unreadNotifications = useUI(s => s.notificationUnread)
  useStore(s => s.features)   // the admin's switches may arrive after the first render
  // Challenges, Marks (record posts) and Goals live in one tab: it exists only while the "challenges" feature is on for this member
  // (admin allows it AND the member did not hide Social). A direct link to it lands on the Wall instead.
  const challengesOn = uxOn(S, 'challenges')
  const [rawTab, setTab] = useState(() => ['muro', 'moments', 'routines', 'board', 'challenges'].includes(searchParams.get('tab')) ? searchParams.get('tab') : 'muro')
  const tab = rawTab === 'challenges' && !challengesOn ? 'muro' : rawTab
  const [introStep, setIntroStep] = useState(() => communityIntroSeen(() => window.localStorage, user?.id) ? -1 : 0)
  const [communityStats, setCommunityStats] = useState(null)
  const [routines, setRoutines] = useState(null)
  const [programs, setPrograms] = useState(null)
  const [wall, setWall] = useState(null)
  const [topics, setTopics] = useState(null)
  const [board, setBoard] = useState(null)
  const [challenges, setChallenges] = useState(null)
  const [goals, setGoals] = useState(null)
  const handledChallengeLink = useRef(null)

  const loadRoutines = () => fetchSocialRoutines().then(setRoutines).catch(e => toast(e.message))
  const loadPrograms = () => fetchSocialPrograms().then(setPrograms).catch(e => toast(e.message))
  const loadFeed = () => { loadRoutines(); loadPrograms() }
  const loadWall = () => fetchWall().then(setWall).catch(e => toast(e.message))
  const loadTopics = () => fetchTopics().then(setTopics).catch(e => toast(e.message))
  const loadBoard = () => fetchBoard().then(setBoard).catch(e => toast(e.message))
  const loadChallenges = () => fetchChallenges().then(setChallenges).catch(e => toast(e.message))
  const loadGoals = () => fetchGoals().then(setGoals).catch(e => toast(e.message))
  const dismissIntro = () => { markCommunityIntroSeen(() => window.localStorage, user?.id); setIntroStep(-1) }

  useEffect(() => { if (tab === 'muro' && topics === null) loadTopics() }, [tab])
  useEffect(() => { if (tab === 'routines' && (routines === null || programs === null)) loadFeed() }, [tab])
  useEffect(() => { if (tab === 'board' && board === null) loadBoard() }, [tab])
  useEffect(() => { if (tab === 'challenges' && challenges === null) { loadChallenges(); loadGoals() } }, [tab])
  useEffect(() => { if (tab === 'challenges' && wall === null) loadWall() }, [tab])
  useEffect(() => {
    const id = searchParams.get('id')
    if (tab !== 'challenges' || !id || !challenges || handledChallengeLink.current === id) return
    handledChallengeLink.current = id
    if (challenges.some(c => c.id === id)) openSheet(close => <ChallengeDetailSheet id={id} onChanged={loadChallenges} close={close} />, { kind: 'center' })
  }, [tab, challenges, searchParams])
  useEffect(() => {
    let live = true
    Promise.allSettled([fetchFriends(), fetchThreads(), fetchNotifications()]).then(results => {
      if (!live) return
      const [friends, threads, notices] = results
      setCommunityStats({ friends: friends.status === 'fulfilled' ? friends.value.friends.length : null,
        unreadChats: threads.status === 'fulfilled' ? threads.value.filter(x => x.unread).length : null,
        unreadNotifications: notices.status === 'fulfilled' ? notices.value.unread : null })
    })
    return () => { live = false }
  }, [user?.id])

  const openPublishDetails = (kind, source) =>
    openSheet(close => <PublishDetailsSheet kind={kind} source={source} S={S} close={close} onPublished={loadFeed} />)
  const publish = () => openSheet(close => <PickTypeSheet close={close}
    onRoutine={() => {
      if (!S.routines.length) { toast(t('You have no routines yet.')); return }
      openSheet(close2 => <PickRoutineSheet routines={S.routines} close={close2} onPick={r => openPublishDetails('routine', r)} />)
    }}
    onProgram={() => {
      const withRoutines = (S.programs || []).filter(p => (p.routineIds || []).length > 0)
      if (!withRoutines.length) { toast(t('Add a routine to a program before publishing it.')); return }
      openSheet(close2 => <PickProgramSheet programs={withRoutines} close={close2} onPick={p => openPublishDetails('program', p)} />)
    }} />)

  const openDetail = post => openSheet(close => post.kind === 'program'
    ? <ProgramDetailSheet post={post} onChanged={loadFeed} close={close} />
    : <RoutineDetailSheet post={post} onChanged={loadFeed} close={close} />)

  const publishWall = () => openSheet(close => <WallPublishSheet S={S} close={close} onPublished={loadWall} />)
  const openWallDetail = post => openSheet(close => <WallDetailSheet post={post} onChanged={loadWall} close={close} />)

  const newTopic = () => openSheet(close => <NewTopicSheet close={close} onPublished={loadTopics} />)
  const openTopicDetail = topic => openSheet(close => <TopicDetailSheet topic={topic} onChanged={loadTopics} close={close} />)

  const newBoardPost = () => openSheet(close => <NewBoardPostSheet close={close} onPublished={loadBoard} />)
  const openBoardDetail = post => openSheet(close => <BoardDetailSheet post={post} onChanged={loadBoard} close={close} />)

  const feed = routines === null || programs === null ? null :
    [...routines.map(r => ({ ...r, kind: 'routine' })), ...programs.map(p => ({ ...p, kind: 'program' }))]
      .sort((a, b) => dateSortValue(b.createdAt) - dateSortValue(a.createdAt))
  const memberFeed = feed ? feed.filter(p => p.authorKind !== 'trainer') : null
  const trainerFeed = feed ? feed.filter(p => p.authorKind === 'trainer') : null

  return <div className="narrow v2-social">
    <div className="hdr">
      <div><h1>{t('Community')}</h1><div className="sub">{t('Share and discover, gym-wide')}</div></div>
      <div className="row" style={{ gap: 4 }}>
        <button className="iconbtn notification-bell" aria-label={t('Notifications')} onClick={() => navigate('/notifications')}><Icon name="bell" />{unreadNotifications > 0 && <span className="notification-count">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}</button>
        <button className="iconbtn" aria-label={t('Your privacy')} onClick={() => navigate('/social/preferences')}><Icon name="lock" /></button>
        <button className="iconbtn" aria-label={t('Friends')} onClick={() => navigate('/friends')}><Icon name="users" /></button>
        <button className="iconbtn" aria-label={t('Conversations')} onClick={() => navigate('/chat')}><Icon name="message" /></button>
      </div>
    </div>
    {introStep >= 0 ? <section className="community-intro card" aria-label={t('How Community works')}>
      <div className="community-intro-mark"><Icon name={['users', 'lock', 'message'][introStep]} /></div>
      <div className="community-intro-copy"><div className="tag acc">{t('COMMUNITY · {0}/3', introStep + 1)}</div>
        <h3>{t(['Connect with friends', 'Share only what you choose', 'Messages stay in your control'][introStep])}</h3>
        <p className="small muted">{t(['Find friends and motivate each other with real training milestones.', 'Your profile, activity and shared content have separate privacy controls.', 'Requests and messages appear in one inbox. Health and measurements stay private.'][introStep])}</p>
      </div>
      <div className="row between community-intro-actions"><button className="btn ghost" onClick={dismissIntro}>{t('Skip')}</button><div className="row"><button className="btn ghost" onClick={() => setIntroStep(0)}>{t('How it works')}</button><Button size="sm" variant="primary" onClick={() => introStep === 2 ? dismissIntro() : setIntroStep(introStep + 1)}>{introStep === 2 ? t('Done') : t('Next')}</Button></div></div>
    </section> : <button className="community-help" onClick={() => setIntroStep(0)}><Icon name="info" /> {t('How Community works')}</button>}
    <section className="community-dashboard" aria-label={t('Your community')}>
      {uxOn(S, 'friends') && <button className="community-tile community-tile-main" onClick={() => navigate('/friends')}>
        <span className="community-tile-icon"><Icon name="users" /></span><span className="community-tile-copy"><strong>{t('Friends')}</strong><small>{communityStats?.friends == null ? t('Find people to train with') : t('{0} connections', communityStats.friends)}</small></span><Icon name="chevronRight" />
      </button>}
      {uxOn(S, 'chat') && <button className="community-tile" onClick={() => navigate('/chat')}>
        <span className="community-tile-icon"><Icon name="message" /></span><span className="community-tile-copy"><strong>{t('Messages')}</strong><small>{communityStats?.unreadChats ? t('{0} unread', communityStats.unreadChats) : t('Conversations with friends and trainers')}</small></span><Icon name="chevronRight" />
      </button>}
      <button className="community-tile" onClick={() => navigate('/notifications')}>
        <span className="community-tile-icon"><Icon name="bell" /></span><span className="community-tile-copy"><strong>{t('Notifications')}</strong><small>{communityStats?.unreadNotifications ? t('{0} unread', communityStats.unreadNotifications) : t('Requests, messages and shared moments')}</small></span><Icon name="chevronRight" />
      </button>
    </section>
    <Segmented options={[{ value: 'muro', label: t('Wall') }, { value: 'moments', label: t('Moments') }, { value: 'routines', label: t('Routines') }, { value: 'board', label: t('Trainers') }, ...(challengesOn ? [{ value: 'challenges', label: t('Challenges & PRs') }] : [])]} value={tab} onChange={setTab} />
    <div style={{ height: 14 }} />

    {tab === 'muro' && <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Wall')}</h4>
        <Button size="sm" variant="tinted" icon="plus" onClick={newTopic}>{t('New topic')}</Button>
      </div>
      {topics === null ? <ListSkeleton /> :
        topics.length ? <div className="list">{topics.map(tp => <div key={tp.id} className="item" onClick={() => openTopicDetail(tp)}>
          <span className="lrow-i"><Icon name="list" /></span>
          <div className="grow">
            <div className="tt row" style={{ gap: 4 }}>{tp.title}{tp.authorKind === 'trainer' && <StaffBadge size={11} />}</div>
            <div className="ss capitalize">{tp.authorName} · {(tp.comments || []).length} {t('comments')} · {fmtDate(tp.createdAt, true)}</div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>)}</div> :
          <div className="empty"><div className="ico"><Icon name="list" /></div>{t('No topics yet.')}<br />{t('Be the first to start one.')}</div>}
    </>}

    {tab === 'moments' && <><h4 className="sec">{t('Shared moments')}</h4><SocialMoments /></>}

    {tab === 'routines' && <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <Button size="sm" variant="tinted" icon="upload" onClick={publish}>{t('Publish')}</Button>
      </div>
      <h4 className="sec" style={{ marginTop: 0 }}>{t('Public routines')}</h4>
      {memberFeed === null ? <ListSkeleton /> :
        memberFeed.length ? <div className="list" style={{ marginBottom: 18 }}>{memberFeed.map(p => p.kind === 'program'
          ? <ProgramCard key={p.id} post={p} onOpen={openDetail} />
          : <RoutineCard key={p.id} post={p} onOpen={openDetail} />)}</div> :
          <div className="empty" style={{ marginBottom: 18 }}><div className="ico"><Icon name="users" /></div>{t('No routines published yet.')}<br />{t('Be the first to share one.')}</div>}

      <h4 className="sec">{t('Trainer routines')}</h4>
      {trainerFeed === null ? <ListSkeleton /> :
        trainerFeed.length ? <div className="list">{trainerFeed.map(p => p.kind === 'program'
          ? <ProgramCard key={p.id} post={p} onOpen={openDetail} />
          : <RoutineCard key={p.id} post={p} onOpen={openDetail} />)}</div> :
          <div className="empty"><div className="ico"><Icon name="medal" /></div>{t('No trainer routines yet.')}</div>}
    </>}

    {tab === 'board' && <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Trainers')}</h4>
        {(user?.trainer || user?.admin) && <Button size="sm" variant="tinted" icon="plus" onClick={newBoardPost}>{t('New announcement')}</Button>}
      </div>
      {board === null ? <ListSkeleton /> :
        board.length ? <div className="list">{board.map(p => <div key={p.id} className="item" onClick={() => openBoardDetail(p)}>
          <span className="lrow-i" style={{ '--tint': 'var(--acc)' }}><Icon name="medal" /></span>
          <div className="grow">
            <div className="tt row" style={{ gap: 4 }}>{p.title}<StaffBadge size={11} /></div>
            <div className="ss capitalize">{p.authorName} · {fmtDate(p.createdAt, true)}{p.commentsEnabled ? ` · ${(p.comments || []).length} ${t('comments')}` : ''}</div>
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>)}</div> :
          <div className="empty"><div className="ico"><Icon name="medal" /></div>{t('No announcements yet.')}</div>}
    </>}

    {tab === 'challenges' && <>
      <ChallengesSection challenges={challenges} loadChallenges={loadChallenges} user={user} />
      <div style={{ height: 22 }} />

      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Marks')}</h4>
        <Button size="sm" variant="tinted" icon="upload" onClick={publishWall}>{t('Post a record')}</Button>
      </div>
      {wall === null ? <ListSkeleton /> :
        wall.length ? <div className="list" style={{ marginBottom: 18 }}>{wall.map(p => <div key={p.id} className="item v2-mark" onClick={() => openWallDetail(p)}>
          <Thumb ex={exOr(p.exId)} />
          <div className="grow">
            <div className="tt capitalize">{p.exName}</div>
            <div className="ss capitalize row" style={{ gap: 4 }}>{p.authorName} · {setLabel(p.exId, p.value, { mode: p.mode })} · {fmtDate(p.sourceDate, true)}{p.authorKind === 'trainer' && <StaffBadge size={11} />}</div>
            {p.note && <div className="ss dim">“{p.note}”</div>}
          </div>
          <Icon name={p.public ? 'globe' : 'lock'} style={{ width: 16, height: 16, opacity: .5, flexShrink: 0 }} />
          <Icon name="chevronRight" className="chev" />
        </div>)}</div> :
          <div className="empty" style={{ marginBottom: 18 }}><div className="ico"><Icon name="trophy" /></div>{t('No records posted yet.')}<br />{t('Post one from a workout you already logged.')}</div>}

      <GoalsSection goals={goals} loadGoals={loadGoals} />
    </>}
    <div style={{ height: 20 }} />
  </div>
}

// Publishing a Wall post is a 3-step pick, never free text for the record itself: an exercise
// the member has actually trained → one specific done set logged for it → an optional note. The
// server re-checks the chosen set against the member's own history anyway (api/server.js), so
// this picker is what keeps the flow honest, not what enforces it.
function WallPublishSheet({ S, onPublished, close }) {
  const toast = useUI(s => s.toast)
  const [step, setStep] = useState('exercise')
  const [exId, setExId] = useState(null)
  const [chosen, setChosen] = useState(null)   // { d, s, mode }
  const [note, setNote] = useState('')
  const [isPublic, setIsPublic] = useState(false)   // Marcas are private by default
  const [busy, setBusy] = useState(false)

  const trained = []
  const seen = new Set()
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    S.workouts[i].entries.forEach(e => {
      if (!seen.has(e.id) && e.sets.some(s => s.done)) { seen.add(e.id); trained.push(e.id) }
    })
  }

  if (step === 'exercise') return <>
    <h3>{t('Pick an exercise')}</h3>
    <div className="list">
      {trained.map(id => {
        const ex = exOr(id)
        return <div key={id} className="item" onClick={() => { setExId(id); setStep('set') }}>
          <div className="grow"><div className="tt capitalize">{nameFor(ex)}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>
      })}
      {!trained.length && <div className="empty">{t('Log a workout first.')}</div>}
    </div>
  </>

  if (step === 'set') {
    const candidates = []
    S.workouts.forEach(w => {
      const entry = w.entries.find(e => e.id === exId)
      if (!entry) return
      const mode = modeOf({ ...(entry.target || {}), id: exId })
      entry.sets.forEach(s => { if (s.done) candidates.push({ d: w.d, s, mode }) })
    })
    candidates.reverse()
    return <>
      <h3>{t('Pick a set')}</h3>
      <div className="muted small capitalize" style={{ margin: '4px 0 10px' }}>{nameFor(exOr(exId))}</div>
      <div className="list">
        {candidates.map((c, i) => <div key={i} className="item" onClick={() => { setChosen(c); setStep('note') }}>
          <div className="grow"><div className="tt">{setLabel(exId, c.s, { mode: c.mode })}</div><div className="ss">{fmtDate(c.d, true)}</div></div>
        </div>)}
        {!candidates.length && <div className="empty">{t('No logged sets for this exercise.')}</div>}
      </div>
    </>
  }

  const publish = () => {
    setBusy(true)
    const value = chosen.mode === 'cardio' ? { min: chosen.s.min, speed: chosen.s.speed }
      : chosen.mode === 'time' ? { sec: chosen.s.sec, w: chosen.s.w || 0 }
      : { w: chosen.s.w, r: chosen.s.r }
    publishWallPost({ exId, exName: nameFor(exOr(exId)), mode: chosen.mode, value, sourceDate: chosen.d, note: note.trim().slice(0, 140), public: isPublic })
      .then(() => { toast(t('Mark posted')); onPublished(); close() })
      .catch(e => { setBusy(false); toast(e.message) })
  }
  return <>
    <h3>{t('Add a note (optional)')}</h3>
    <div className="muted small capitalize" style={{ margin: '4px 0 10px' }}>{nameFor(exOr(exId))} · {setLabel(exId, chosen.s, { mode: chosen.mode })}</div>
    <TextArea value={note} onChange={e => setNote(e.target.value)} maxLength={140} rows={3} placeholder={t('e.g. “Bar felt light today”')} />
    <div style={{ height: 14 }} />
    <div className="dim small" style={{ marginBottom: 6 }}>{t('Visibility')}</div>
    <Segmented options={[{ value: false, label: t('Private (only you)') }, { value: true, label: t('Public (everyone)') }]} value={isPublic} onChange={setIsPublic} />
    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={busy} onClick={publish}>{t('Post the mark')}</Button>
  </>
}
