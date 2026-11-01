import { t } from '../lib/i18n.js'
import { mediaUrl } from '../lib/media.js'
import { glyphOf } from '../lib/glyphs.js'
import { routineMeta, programMeta, GOAL_LABEL } from '../lib/plan-cards.js'
import { exCount, routineCount, daysPerWeekLabel, weeksLabel, sessionsPerWeekLabel } from '../lib/format.js'
import { LEVEL_LABEL } from '../lib/protocol/index.js'
import { startFlow } from '../sheets.jsx'
import Icon from './Icon.jsx'
import WorkoutCover from './WorkoutCover.jsx'
import '../views/guided-programs.css'

/* Detail heroes for the existing routine / program editors: the same cover, source and figures as the Library cards, then one clear action, and
   the editor continues below untouched. Every figure is derived (lib/plan-cards.js); a missing one leaves no gap. */
const SOURCE = { own: 'Mine', trainer: 'From your trainer', '2j': 'From 2J' }
const COVER_FOR = { own: 'strength', trainer: 'circuit', '2j': 'mixed' }
const STATE = { active: 'Active', saved: 'Saved', completed: 'Completed' }
const Chip = ({ children }) => children ? <span className="v3-chip">{children}</span> : null

function Cover({ item, category, onCover, children }) {
  const edit = onCover && <button type="button" className="v3-cover-edit" onClick={onCover}><Icon name="pencil" />{t('Change cover')}</button>
  if (item.image) return <div className="v3-hero-cover v3-card-photo" style={{ backgroundImage: `url(${mediaUrl(item.image)})` }}>{children}{edit}</div>
  return <WorkoutCover r={{ id: item.id, category }} shape="wide" className="v3-hero-cover">{children}{edit}</WorkoutCover>
}

export function RoutineHero({ r, S, onCover }) {
  const m = routineMeta(r, S)
  const level = m.level && LEVEL_LABEL?.[m.level] ? t(LEVEL_LABEL[m.level]) : null
  const goal = m.goal && GOAL_LABEL[m.goal] ? t(GOAL_LABEL[m.goal]) : null
  return <section className="v3-hero" aria-label={r.name}>
    <Cover item={r} category={COVER_FOR[m.source]} onCover={onCover}>
      <span className="v3-card-glyph"><Icon name={glyphOf(r.emoji)} /></span>
      <span className={'v3-src ' + m.source}>{t(SOURCE[m.source])}</span>
    </Cover>
    <div className="v3-hero-body">
      <span className="v3-chips">
        <Chip>{goal}</Chip><Chip>{level}</Chip><Chip>{m.exercises ? exCount(m.exercises) : null}</Chip>
        <Chip>{m.minutes ? t('~{0} min', m.minutes) : null}</Chip><Chip>{m.daysPerWeek ? daysPerWeekLabel(m.daysPerWeek) : null}</Chip>
      </span>
      {(m.done > 0 || m.next) && <small className="v3-card-next">
        {m.next ? (m.next.inDays === 0 ? t('Planned today') : m.next.inDays === 1 ? t('Planned tomorrow') : t('Next: {0}', t(m.next.day))) : ''}
        {m.next && m.done > 0 ? ' · ' : ''}{m.done > 0 ? t('Trained {0} times', m.done) : ''}
      </small>}
      {m.exercises > 0 && <button type="button" className="btn primary v3-card-go" onClick={() => startFlow(r.id)}><Icon name="play" />{t('Start')}</button>}
    </div>
  </section>
}

export function ProgramHero({ p, S, onCover }) {
  const m = programMeta(p, S)
  const level = m.level && LEVEL_LABEL?.[m.level] ? t(LEVEL_LABEL[m.level]) : null
  const goal = m.goal && GOAL_LABEL[m.goal] ? t(GOAL_LABEL[m.goal]) : null
  const cta = m.state === 'completed' ? null : m.nextRoutine ? t('Start {0}', m.nextRoutine.name) : null
  return <section className="v3-hero" aria-label={p.name}>
    <Cover item={p} category="strength" onCover={onCover}>
      <span className="v3-card-glyph"><Icon name={glyphOf(p.emoji || 'folder')} /></span>
      <span className={'v3-state ' + m.state}>{t(STATE[m.state])}</span>
    </Cover>
    <div className="v3-hero-body">
      <span className="v3-chips">
        <Chip>{goal}</Chip><Chip>{level}</Chip><Chip>{m.total ? routineCount(m.total) : null}</Chip>
        <Chip>{m.weeks ? weeksLabel(m.weeks) : null}</Chip><Chip>{m.perWeek ? sessionsPerWeekLabel(m.perWeek) : null}</Chip>
      </span>
      {m.total > 0 && (m.done > 0 || m.state === 'active') && <>
        <span className="gp-progress" role="progressbar" aria-label={t('Program progress')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={m.percent}><span style={{ width: m.percent + '%' }} /></span>
        <small className="v3-card-next">{t('{0} of {1} sessions', m.done, m.total)} · {t('this week')}</small>
      </>}
      {cta && <button type="button" className="btn primary v3-card-go" onClick={() => startFlow(m.nextRoutine.id)}><Icon name="play" /><span className="v3-go-t" title={cta}>{cta}</span></button>}
    </div>
  </section>
}
