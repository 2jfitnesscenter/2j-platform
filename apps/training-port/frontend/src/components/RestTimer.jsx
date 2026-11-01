import { useEffect } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'
import { useStore } from '../store/useStore.js'
import { nextTodoSet } from '../lib/training-v3.js'

const clock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')

// One bar, two meanings: the rest countdown between sets, and the work countdown during a
// timed set (issue #16). They are mutually exclusive by construction — startWork() stops any
// running rest — so the bar can never have to show both, and a work set gets its own colour
// plus a "Done" that logs the time actually held.
export default function RestTimer() {
  const timer = useUI(s => s.timer)
  const work = useUI(s => s.work)
  const { addRest, stopRest, pauseRest, resumeRest, finishWorkEarly, stopWork } = useUI()
  const active = useStore(s => s.S.active)
  const on = work || timer
  // The bar is fixed above the tab bar and floats over whatever is beneath it — during a
  // rest that was the next set's row. Extra bottom padding lets the page scroll clear.
  useEffect(() => {
    document.body.classList.toggle('resting', !!on)
    return () => document.body.classList.remove('resting')
  }, [!!on])
  if (!on) return null
  const pct = (on.left / on.total) * 100
  const next = timer ? nextTodoSet(active) : null

  if (work) return (
    <div id="timer" className="working">
      <div className="t">{clock(work.left)}</div>
      <div className="grow">
        {work.label && <div className="lbl">{work.label}</div>}
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
      </div>
      <Button size="sm" onClick={stopWork}>{t('Cancel')}</Button>
      <Button size="sm" variant="primary" icon="check" onClick={finishWorkEarly}>{t('Done')}</Button>
    </div>
  )
  // Three controls plus the clock don't fit one line on a phone — at 360px the bar is left
  // with about 30px and stops saying anything. So the rest variant stacks: clock and bar
  // read at a glance, controls get their own row. −15 and +15 sit together in number-line
  // order; Skip is pushed to the far edge, away from the button you tap to buy more time.
  return (
    <div id="timer" className="rest">
      <div className="head">
        <div className="v3-rest-ring" role="img" aria-label={clock(timer.left)}>
          <svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
            <circle cx="32" cy="32" r="28" fill="none" strokeWidth="5" className="trk" />
            <circle cx="32" cy="32" r="28" fill="none" strokeWidth="5" strokeLinecap="round" className="arc"
              strokeDasharray={2 * Math.PI * 28} strokeDashoffset={2 * Math.PI * 28 * (1 - Math.max(0, Math.min(1, pct / 100)))} transform="rotate(-90 32 32)" />
          </svg>
          <div className="t">{clock(timer.left)}</div>
        </div>
        <div className="grow">
          <div className="lbl">{timer.paused ? t('Paused') : t('Rest')}</div>
          <div className="v3-rest-next">{next ? <>{next.sameExercise ? t('Next: set {0} of {1}', next.setIdx + 1, next.total) + ' · ' : t('Next up') + ': '}<b className="capitalize">{next.name}</b></> : <b className="capitalize">{timer.exercise}</b>}</div>
        </div>
      </div>
      <div className="acts">
        <Button size="sm" icon="minus" onClick={() => addRest(-15)}>15s</Button>
        <Button size="sm" icon="plus" onClick={() => addRest(15)}>15s</Button>
        <Button size="sm" icon={timer.paused ? 'play' : 'pause'} aria-label={timer.paused ? t('Resume') : t('Pause')}
          onClick={timer.paused ? resumeRest : pauseRest}>{timer.paused ? t('Resume') : t('Pause')}</Button>
        <Button size="sm" variant="primary" className="skip" onClick={stopRest}>{t('Skip')}</Button>
      </div>
    </div>
  )
}
