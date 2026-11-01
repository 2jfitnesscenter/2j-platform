import { t } from '../lib/i18n.js'
import { mediaUrl } from '../lib/media.js'
import { glyphOf } from '../lib/glyphs.js'
import { routineMeta, programMeta, GOAL_LABEL } from '../lib/plan-cards.js'
import { exCount, routineCount, daysPerWeekLabel, weeksLabel, sessionsPerWeekLabel } from '../lib/format.js'
import { LEVEL_LABEL } from '../lib/protocol/index.js'
import Icon from './Icon.jsx'
import WorkoutCover from './WorkoutCover.jsx'
import '../views/guided-programs.css'

/* Library V3 cards: a routine or program with a cover, its source, the figures that can really be derived, what is next and one clear action.
   Presentation only — every action calls back into the existing flows (start, open/edit, favourite, duplicate). */
const SOURCE = { own: 'Mine', trainer: 'From your trainer', '2j': 'From 2J' }
const COVER_FOR = { own: 'strength', trainer: 'circuit', '2j': 'mixed' }

function Cover({ item, category, children }) {
  if (item.image) return <div className="v3-card-photo" style={{ backgroundImage: `url(${mediaUrl(item.image)})` }}>{children}</div>
  return <WorkoutCover r={{ id: item.id, category }} shape="wide">{children}</WorkoutCover>
}
const Chip = ({ children }) => children == null || children === false ? null : <span className="v3-chip">{children}</span>

function nextLabel(next) {
  if (!next) return null
  return next.inDays === 0 ? t('Planned today') : next.inDays === 1 ? t('Planned tomorrow') : t('Next: {0}', t(next.day))
}

export function RoutineCard({ r, S, onOpen, onStart, onFav, onDuplicate, selecting = false, selected = false, layout = 'grid' }) {
  const m = routineMeta(r, S)
  const level = m.level && LEVEL_LABEL?.[m.level] ? t(LEVEL_LABEL[m.level]) : null
  return <article className={'v3-card' + (layout === 'rows' ? ' row' : '') + (selected ? ' on' : '')}>
    <button type="button" className="v3-card-open" onClick={onOpen} aria-label={r.name}>
      <Cover item={r} category={COVER_FOR[m.source]}>
        <span className="v3-card-glyph"><Icon name={glyphOf(r.emoji)} /></span>
        <span className={'v3-src ' + m.source}>{t(SOURCE[m.source])}</span>
        {selecting && <span className="v3-card-pick">{selected ? <Icon name="checkCircle" /> : <i />}</span>}
      </Cover>
      <span className="v3-card-body">
        <span className={'v3-rowtag ' + m.source}>{t(SOURCE[m.source])}</span>
        <b>{r.name}</b>
        <span className="v3-chips">
          <Chip>{exCount(m.exercises)}</Chip>
          <Chip>{m.minutes ? t('~{0} min', m.minutes) : null}</Chip>
          <Chip>{m.daysPerWeek ? daysPerWeekLabel(m.daysPerWeek) : null}</Chip>
          <Chip>{level}</Chip>
          {m.goal && GOAL_LABEL[m.goal] && <span className="v3-chip goal">{t(GOAL_LABEL[m.goal])}</span>}
        </span>
        {(nextLabel(m.next) || m.done > 0) && <small className="v3-card-next">{nextLabel(m.next)}{nextLabel(m.next) && m.done > 0 ? ' · ' : ''}{m.done > 0 ? t('Trained {0} times', m.done) : ''}</small>}
      </span>
    </button>
    {!selecting && <div className="v3-card-acts">
      <button type="button" className="btn primary v3-card-go" onClick={onStart}><Icon name="play" />{t('Start')}</button>
      <button type="button" className="iconbtn" style={{ color: m.fav ? 'var(--yellow)' : 'var(--label-3)' }} aria-label={m.fav ? t('Unfavorite') : t('Favorite')} aria-pressed={m.fav} onClick={onFav}><Icon name={m.fav ? 'starFill' : 'star'} /></button>
      <button type="button" className="iconbtn" aria-label={t('Duplicate')} title={t('Duplicate')} onClick={onDuplicate}><Icon name="clipboard" /></button>
    </div>}
  </article>
}

const STATE = { active: 'Active', saved: 'Saved', completed: 'Completed' }
export function ProgramCard({ p, S, onOpen, onContinue, layout = 'grid' }) {
  const m = programMeta(p, S)
  const official = m.kind === 'official'
  const cta = m.state === 'completed' ? null
    : official ? (m.nextSession ? (m.done > 0 ? t('Continue program') : t('Start program')) : null)
      : (m.nextRoutine ? t('Start {0}', m.nextRoutine.name) : null)
  return <article className={'v3-card' + (layout === 'rows' ? ' row' : '')}>
    <button type="button" className="v3-card-open" onClick={onOpen} aria-label={p.name}>
      <Cover item={p} category={official ? (p.cover || 'mixed') : 'strength'}>
        <span className="v3-card-glyph"><Icon name={glyphOf(p.emoji || 'folder')} /></span>
        {official && <span className="v3-src 2j">{t('From 2J')}</span>}
        <span className={'v3-state ' + m.state}>{t(STATE[m.state])}</span>
      </Cover>
      <span className="v3-card-body">
        <span className={'v3-rowtag state ' + m.state}>{t(STATE[m.state])}{official ? ' · ' + t('From 2J') : ''}</span>
        <b>{official ? t(p.name) : p.name}</b>
        <span className="v3-chips">
          <Chip>{m.weeks ? weeksLabel(m.weeks) : null}</Chip>
          <Chip>{m.perWeek ? sessionsPerWeekLabel(m.perWeek) : null}</Chip>
          <Chip>{!official && m.total ? routineCount(m.total) : null}</Chip>
          {m.goal && GOAL_LABEL[m.goal] && <span className="v3-chip goal">{t(GOAL_LABEL[m.goal])}</span>}
        </span>
        {m.total > 0 && (m.done > 0 || m.state === 'active') && <>
          <span className="gp-progress" role="progressbar" aria-label={t('Program progress')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={m.percent}><span style={{ width: m.percent + '%' }} /></span>
          <small className="v3-card-next">{official ? t('Week {0} of {1}', m.currentWeek, m.weeks) + ' · ' : ''}{t('{0} of {1} sessions', m.done, m.total)}{!official ? ' · ' + t('this week') : ''}</small>
        </>}
      </span>
    </button>
    {cta && <div className="v3-card-acts"><button type="button" className="btn primary v3-card-go" onClick={onContinue}><Icon name="play" /><span className="v3-go-t" title={cta}>{cta}</span></button></div>}
  </article>
}

/** Grid / rows switch for Routines and Programs (the choice itself is stored by lib/view-pref.js, per user and device). */
export function ViewToggle({ value, onChange }) {
  return <div className="v3-viewtoggle" role="group" aria-label={t('View')}>
    {[['grid', 'grid', 'Grid'], ['rows', 'list', 'Rows']].map(([v, icon, label]) =>
      <button key={v} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} aria-label={t(label)} title={t(label)} onClick={() => onChange(v)}><Icon name={icon} /></button>)}
  </div>
}
