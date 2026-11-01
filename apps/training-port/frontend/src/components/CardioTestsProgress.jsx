import { cardioTestGroups, formatPace } from '../lib/cardio-tests.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const ERG_LABEL = { row: 'Rowing ergometer', bike: 'Bike ergometer', ski: 'Ski ergometer' }
const ZONE_LABEL = { easy: 'Easy', aerobic: 'Aerobic', steady: 'Steady', interval: 'Intervals' }

function Result({ label, test }) {
  if (!test) return null
  return <div className="row between small" style={{ gap: 8, padding: '5px 0' }}>
    <span className="dim">{t(label)}</span>
    <span>{fmtNum(test.avgSpeed)} km/h <span className="dim">· {fmtDate(test.d, true)}</span></span>
  </div>
}

export default function CardioTestsProgress({ tests, onStart }) {
  const groups = cardioTestGroups(tests)
  return <section className="card" aria-label={t('Cardio tests')}>
    <div className="row between" style={{ gap: 10, marginBottom: 8 }}>
      <div><h2 style={{ margin: 0 }}>{t('Cardio tests')}</h2><div className="small dim">{t('Test results guide your cardio targets and show how they change.')}</div></div>
      <Button size="sm" variant="ghost" icon="plus" onClick={onStart}>{t('Test')}</Button>
    </div>
    {!groups.length ? <div className="small dim">{t('No cardio tests yet. A VAM or ergometer test can give you a useful baseline.')}</div> : <div className="list" style={{ gap: 10 }}>
      {groups.map(group => <div key={group.key} style={{ borderTop: 'var(--hair) solid var(--sep)', paddingTop: 10 }}>
        <div className="row" style={{ gap: 8, marginBottom: 4 }}>
          <span className="lrow-i"><Icon name={group.type === 'vam' ? 'figureRun' : 'bike'} /></span>
          <b>{t(group.type === 'vam' ? "VAM 6'" : ERG_LABEL[group.ergType])}</b>
        </div>
        <Result label="Latest result" test={group.latest} />
        <Result label="Best result" test={group.best} />
        {group.previous && <div className="small" style={{ padding: '4px 0' }}>
          {t('Compared with previous')}: <b>{group.changePct > 0 ? '+' : ''}{fmtNum(group.changePct)}%</b>
          <span className="dim"> · {fmtDate(group.previous.d, true)}</span>
        </div>}
        <div className="small dim" style={{ padding: '4px 0' }}>
          {t('Next test goal')}: {fmtNum(group.nextGoal)} km/h
        </div>
        {group.type === 'vam' && group.zones.length > 0 && <div className="small" style={{ marginTop: 7 }}>
          <div className="dim" style={{ marginBottom: 4 }}>{t('Indicative running paces from this VAM result')}</div>
          {group.zones.map(zone => <div key={zone.key} className="row between" style={{ gap: 8, padding: '3px 0' }}>
            <span>{t(ZONE_LABEL[zone.key])} · {Math.round(zone.low * 100)}–{Math.round(zone.high * 100)}%</span>
            <span className="dim">{fmtNum(zone.slow)}–{fmtNum(zone.fast)} km/h · {formatPace(zone.paceFast)}–{formatPace(zone.paceSlow)}</span>
          </div>)}
          <div className="dim" style={{ marginTop: 4 }}>{t('Pace ranges are guides, not measured thresholds.')}</div>
        </div>}
        {group.type === 'vam' && !group.zones.length && <div className="small dim" style={{ marginTop: 7 }}>{t('Pace ranges need a VAM test close to six minutes.')}</div>}
        {group.reminder && <div className="progline" style={{ marginTop: 7 }}>
          <Icon name="clock" /><span>{t('It may be a good time to repeat this test. Training can continue as usual.')}</span>
        </div>}
      </div>)}
    </div>}
  </section>
}
