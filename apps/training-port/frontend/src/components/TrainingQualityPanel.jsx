import { useMemo, useState } from 'react'
import { t, nameFor } from '../lib/i18n.js'
import { EXIDX } from '../lib/exercises.js'
import { MOVEMENT_BY_ID } from '../lib/protocol/movements.js'
import { analyzeRoutineStructure, PATTERN_KEYS } from '../lib/routine-structure.js'
import { findingTexts, evidenceTagLabel, referenceNote, PATTERN_LABEL } from '../lib/routine-structure-text.js'
import { groupLabel } from '../lib/library/index.js'
import Icon from './Icon.jsx'
import './training-quality-panel.css'

const MUSCLE_LABEL = { 'upper-back': 'Upper back', 'lower-back': 'Lower back' }
const STATUS_MARK = { below: '↓', within: '✓', above: '↑' }

// One compact line per pattern: sets (the unit balance is judged on) and the days it shows up; exercises only when there are no sets to count.
const patternValue = s => (s.sets ? t('{0} sets · {1} d', s.sets, s.days) : s.exercises ? t('{0} ex. · {1} d', s.exercises, s.days) : '0')

export default function TrainingQualityPanel({ routine, days, goal, level, focus, specialization, restrictions, availableEquipment, scheduledDays }) {
  const [expanded, setExpanded] = useState(false)
  const analysis = useMemo(() => analyzeRoutineStructure(routine || { days }, { goal, level, focus, specialization, restrictions, availableEquipment, scheduledDays }),
    [routine, days, goal, level, focus, specialization, restrictions, availableEquipment, scheduledDays])
  const peak = Math.max(1, ...PATTERN_KEYS.map(k => analysis.patternStats[k].sets || analysis.patternStats[k].exercises))
  const muscles = Object.entries(analysis.muscleSets).filter(([, x]) => x.exposure > 0).sort((a, b) => b[1].exposure - a[1].exposure).slice(0, 6)
  const findings = expanded ? analysis.findings : analysis.findings.slice(0, 4)
  const dayList = analysis.days
  const ref = analysis.reference
  const refGroups = ref.applicable ? Object.entries(ref.groups).sort((a, b) => b[1].sets - a[1].sets).slice(0, 8) : []
  const note = referenceNote(ref)

  return <section className="training-quality" aria-label={t('2J routine analysis')}>
    <header className="training-quality-head">
      <span className="training-quality-icon"><Icon name="chartLine" /></span>
      <div className="grow"><h3>{t('2J analysis')}</h3><p>{t('A practical review of the selected exercises and their distribution. It does not diagnose or change the plan.')}</p></div>
      <span className="training-quality-sets num">{analysis.programmedResistanceSets} {t('planned resistance sets')}</span>
    </header>

    <div className="training-quality-grid" aria-label={t('Exercise pattern distribution')}>
      {PATTERN_KEYS.map(id => {
        const s = analysis.patternStats[id]
        const size = s.sets || s.exercises
        return <div className="training-quality-bar-row" key={id}>
          <span>{t(PATTERN_LABEL[id])}</span><div className="training-quality-track" role="img" aria-label={`${t(PATTERN_LABEL[id])}: ${patternValue(s)}`}><i style={{ width: `${size ? Math.max(8, size / peak * 100) : 0}%` }} /></div><b className="num">{patternValue(s)}</b>
        </div>
      })}
    </div>

    {muscles.length > 0 && <div className="training-quality-muscles">
      <h4>{t('Muscle exposure')}</h4>
      <div>{muscles.map(([id, item]) => <span key={id}><b>{t(MUSCLE_LABEL[id] || id)}</b><small>{t('{0} direct · {1} secondary · {2}\u00A0d', item.direct, item.secondarySets, item.days)}</small></span>)}</div>
    </div>}

    {ref.applicable && <div className="training-quality-reference">
      <h4>{t('Weekly direct sets')} <small>{t('Reference {0}–{1} (rule of thumb, {2})', ref.range[0], ref.range[1], t(ref.level))}</small></h4>
      <div>{refGroups.map(([g, v]) => <span className={'tq-ref ' + v.status} key={g}>{t(groupLabel(g) || g)} <b className="num">{v.sets}</b> <i aria-hidden="true">{STATUS_MARK[v.status]}</i></span>)}</div>
    </div>}
    {!ref.applicable && ref.reason === 'level' && note && <div className="training-quality-refnote">{note}</div>}

    {dayList.length > 1 && <div className="training-quality-days">
      <h4>{t('By day')}</h4>
      {dayList.map(day => <div className="training-quality-day" key={day.id}>
        <b>{day.name}</b><span>{Object.keys(day.movements).map(id => t(MOVEMENT_BY_ID[id]?.label || id)).join(' · ') || t('No classified movement yet')}</span>
        <small className="num">{day.programmedResistanceSets} {t('sets')}</small>
      </div>)}
    </div>}

    {findings.length > 0 ? <div className="training-quality-findings">
      <h4>{t('Points to review')} <span className="num">{analysis.findings.length}</span></h4>
      {findings.map(item => {
        const text = findingTexts(item), tag = evidenceTagLabel(item.evidenceType)
        return <article className={`training-quality-finding ${item.severity}`} key={item.id}>
          <span aria-hidden="true"><Icon name="info" /></span>
          <div><b>{text.fact}</b>
            {text.interpretation && <p>{tag && <em className={'tq-tag ' + item.evidenceType}>{tag}</em>}{text.interpretation}</p>}
            {text.suggestion && <p>{text.suggestion}</p>}
            {item.alternatives?.length > 0 && <div className="training-quality-alternatives">{t('Available options')}: {item.alternatives.map(x => nameFor(EXIDX[x.id] || { id: x.id, n: x.name })).join(' · ')}</div>}
          </div>
        </article>
      })}
      {analysis.findings.length > 4 && <button className="training-quality-more" onClick={() => setExpanded(v => !v)}>{expanded ? t('Show fewer') : t('Show all points')}</button>}
    </div> : <div className="training-quality-clear"><Icon name="check" />{t('No clear structural issue found in the available information.')}</div>}
    <footer>{t('Counts are planned sets. Thresholds and reference ranges are rules of thumb, not a scientific score. Trainer judgment remains decisive.')}</footer>
  </section>
}
