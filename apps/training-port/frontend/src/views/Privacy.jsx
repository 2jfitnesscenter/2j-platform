// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The privacy policy, inside the app. ONE structured text with sections; Settings opens it whole
// ("Privacy policy") or on the part someone is looking for ("Data we process", "Artificial
// intelligence", "External providers"). docs/PRIVACY_POLICY.md says the same thing for people who
// read the repository — keep them in step (views/Privacy.test.jsx compares them).
//
// Rules for this text: it describes what the code does today and nothing else. What nobody has
// verified is written as a LEGAL_TBD_ placeholder (lib/legal-controller.js), never guessed, and the
// text never claims legal compliance — it informs.
import { t } from '../lib/i18n.js'
import { CONTROLLER, VERIFY, hasPendingLegalItems } from '../lib/legal-controller.js'

const H = ({ children }) => <div className="tt" style={{ fontWeight: 700, margin: '18px 0 4px' }}>{children}</div>
const P = ({ children }) => <div className="dim" style={{ marginTop: 6 }}>{children}</div>
const L = ({ items }) => <ul className="dim" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{items.map((x, i) => <li key={i} style={{ marginTop: 3 }}>{x}</li>)}</ul>

/** Which sections each entry point of Settings opens. */
export const TOPICS = {
  policy: ['controller', 'data', 'access', 'purposes', 'basis', 'health', 'ai', 'providers', 'transfers', 'retention', 'rights', 'contact'],
  data: ['data', 'access', 'purposes', 'basis', 'health', 'retention'],
  ai: ['ai'],
  providers: ['providers', 'transfers']
}
export const topicTitle = topic => ({
  policy: t('Privacy policy'), data: t('Data we process'), ai: t('Artificial intelligence'), providers: t('External providers')
}[topic] || t('Privacy policy'))

const SECTIONS = {
  controller: () => <>
    <H>{t('Who is responsible')}</H>
    <P>{t('The controller of the personal data processed by this app is {0}, tax ID {1}, address {2}.', CONTROLLER.name, CONTROLLER.taxId, CONTROLLER.address)}</P>
    <P>{t('Privacy contact: {0}.', CONTROLLER.privacyEmail)}</P>
    <P>{t('Privacy consultancy: {0} provides privacy consultancy services to the controller. A formal designation of a data protection officer is not documented yet ({1}; contact: {2}).', CONTROLLER.privacyAdvisor, VERIFY.dpoDesignation, VERIFY.dpoContact)}</P>
    <P>{t('2J Fitness is free software (AGPL). Whoever runs a copy of it for their own gym is the controller of the data in that copy.')}</P>
  </>,

  data: () => <>
    <H>{t('Data we process')}</H>
    <L items={[
      t('Account: name, username, avatar, role (member, trainer or admin), sign-in passkeys (public keys only; there are no passwords), active sessions and devices, invitations, recovery links and security events.'),
      t('Training: profile (birth date, sex, height, goals and preferences), routines, programs, workouts with sets, weights and effort, records and notes.'),
      t('Body and health-related data: body weight, body composition and test results, readiness and fatigue check-ins, follow-up questionnaires and progress photos, limitations or injuries you write for the Coach, and — only if you connect them — activity, sleep, heart-rate and recovery figures from Health Connect, HealthKit, WHOOP or Strava.'),
      t('Social and messages: friends, direct messages, posts, comments, challenges, shares and notifications.'),
      t('Staff records: routines assigned to you and private professional notes that gym staff write about your follow-up.'),
      t('Technical: push-notification subscriptions, a sign-in cookie that keeps you signed in (90 days by default), server logs with identifiers and error codes (never workout, health or message content) and security backups.'),
      t('On your device: the browser or phone keeps a local copy of your app state and sync journal; the standalone mobile build keeps its data only on the phone. 2J does not encrypt these local copies.')
    ]} />
    <P>{t('The app has no advertising and no third-party analytics.')}</P>
  </>,

  access: () => <>
    <H>{t('Who can see your data')}</H>
    <P>{t('You see your own data. Trainers have operational access to the training and follow-up of members across the centre; the trainer assigned to you is organizational information, not an access limit. Administrators additionally manage accounts, roles, security and settings. Other members see only what you choose to share.')}</P>
  </>,

  purposes: () => <>
    <H>{t('Why we use it')}</H>
    <P>{t('To run your account and sign you in securely; to store and sync your training; to let gym staff supervise your training and follow-up; to offer optional features you switch on (Coach and other AI features, social features, connected apps, notifications); to keep the service secure and recoverable (security log, backups); and to answer your requests about your data. Your data is not sold and not used for advertising.')}</P>
  </>,

  basis: () => <>
    <H>{t('Legal basis')}</H>
    <P>{t('The legal basis that applies to each processing is pending legal validation by the controller’s privacy advisor ({0}). What follows is the basis currently foreseen, not yet a confirmed legal determination.', VERIFY.legalBasis)}</P>
    <L items={[
      t('Account, training and service features: foreseen basis — performing the service you use (Art. 6(1)(b) GDPR).'),
      t('Security log and backups: foreseen basis — the legitimate interest in keeping the service secure and recoverable (Art. 6(1)(f) GDPR).'),
      t('Health-related data, body measurements, follow-up and progress photos: foreseen basis — your explicit consent (Art. 9(2)(a) GDPR), given when you enter, connect or upload them. You can withdraw it.'),
      t('AI features, connected apps, push notifications and social sharing: foreseen basis — your specific consent, asked when you switch them on or use them.')
    ]} />
  </>,

  health: () => <>
    <H>{t('Health-related data')}</H>
    <P>{t('Body measurements, check-ins, follow-up and health-integration data are health-related and are treated with extra care: only you and gym staff with operational access can see them, they never appear on Social, and the Coach receives only what is listed under Artificial intelligence. 2J is a training tool: its suggestions are not medical advice and do not replace a doctor or physiotherapist.')}</P>
  </>,

  ai: () => <>
    <H>{t('Artificial intelligence')}</H>
    <P>{t('AI acts only when you or a member of staff ask for it, and the screen tells you when AI is involved. What it returns is a proposal: nothing is applied without you or the professional reviewing it, and it is not medical advice. Without AI the app still works: progression, swaps and the Intelligence suggestions are calculated by the app itself.')}</P>
    <L items={[
      t('Coach (plan, review and explanations): optional and off until you give your consent in the Coach. The configured provider (Anthropic Claude, OpenAI Codex, Google Gemini or OpenAI) receives a pseudonymous identifier, language and units, gym equipment, your plan, recent logged sets, effort and records (up to 12 weeks), weigh-ins and goal, the intake you write (goal, days, limitations, likes, notes) and age, sex and height. You can turn it off at any time; the Coach then discards what it holds for you.'),
      t('Routine drafts by staff: when a trainer or the administrator uses “Generate with AI” to prepare your routine, Anthropic Claude receives your current routines and programs and the trainer’s brief (for example goal, experience and days per week). It does not receive your workout history, profile, name or measurements. What it returns is a proposal that staff review before anything is saved to your plan.'),
      t('Follow-up analysis by staff: when a trainer asks for the AI analysis, Claude receives compact calculated facts about your follow-up, without names, identifiers or notes. The result is labelled as written by AI.'),
      t('Scans: a body-composition report, routine sheet or machine photo is sent to Google Gemini only after you confirm a notice for that file, and the server refuses the scan without it. The file is used for that scan; the scan does not keep the file or the result, and you review the values before saving anything. If you cancel, nothing is read or sent.'),
      t('Import matching: when you import another app’s CSV, Gemini may receive exercise names from the file and 2J library names to match them — not workouts, dates, weights or who you are.')
    ]} />
    <P>{t('Never sent to AI: health, activity, heart-rate and sleep data; WHOOP and Strava data; body-composition values and measurement tests; workout session notes; progress photos; messages, social and community content; your name and account identifier; credentials and push data.')}</P>
    <P>{t('What a provider does with data after receiving it, and where, depends on its own terms and data-processing agreement, and 2J cannot delete it for you ({0}).', VERIFY.aiProviderTerms)}</P>
  </>,

  providers: () => <>
    <H>{t('External providers')}</H>
    <P>{t('Only these third parties are used by the app. “Optional” means the feature is off until you switch it on.')}</P>
    <L items={[
      t('Google (Gemini API) — scans and import matching; also the Coach if it is set to Gemini. Receives: the file or text of that request. Optional; specific consent for each scan file. May involve processing outside the EEA.'),
      t('Anthropic (Claude) — routine drafts and follow-up analysis by staff; also the Coach if it is set to Claude. Receives: the data listed under Artificial intelligence. Optional; the Coach needs your consent. May involve processing outside the EEA.'),
      t('OpenAI — only if the Coach is set to OpenAI or Codex. Receives: the Coach data listed under Artificial intelligence. Optional; needs your Coach consent. May involve processing outside the EEA.'),
      t('WHOOP — if you connect it: 2J reads your recovery, sleep, cycles, workouts and profile, and keeps the access token on the server. Optional; you authorize it in WHOOP.'),
      t('Strava — if you connect it: 2J sends the name, start time and duration of a finished workout and its total volume, and keeps the access token on the server. Optional; you authorize it in Strava.'),
      t('Push services of your browser or phone vendor — if you enable notifications: the notification text and your device’s push address pass through them. Optional; needs your browser or phone permission.'),
      t('Google Fonts — the web app loads its typeface from Google when it opens, so your IP address and browser details reach Google. It is not optional in the web version and may involve processing outside the EEA.'),
      t('jsDelivr (content network) — only the standalone mobile build: exercise images and animations are loaded from it, so your IP address reaches that network.'),
      t('Hosting and infrastructure — the server where your data is stored is provided by {0} ({1}; the country and data centre are not specified), and the certificate authority that issues the HTTPS certificate handles the domain name. Backups use the Auto Backup service contracted with {0}; no independent external backup provider is known.', CONTROLLER.hosting, CONTROLLER.serverRegion)
    ]} />
    <P>{t('Health Connect and HealthKit are read on your device with the operating system’s permission; 2J does not pass that data to anyone else.')}</P>
  </>,

  transfers: () => <>
    <H>{t('International transfers')}</H>
    <P>{t('Some providers above may process data outside the European Economic Area. Where each current provider processes data and the legal safeguard that applies to it (adequacy decision, standard contractual clauses or similar) have not been verified yet ({0}).', VERIFY.transferSafeguards)}</P>
  </>,

  retention: () => <>
    <H>{t('How long we keep it')}</H>
    <L items={[
      t('Account, training, body and follow-up data: until you delete your account or reset your data. There is no automatic expiry.'),
      t('Messages: until you or the other person deletes the account (both lose the conversation).'),
      t('Notifications: the latest 100 per person (5,000 in total). Shares and reports: the latest 5,000.'),
      t('Security events: a bounded log of the latest 3,000 events; staff-access audit: the latest 1,000.'),
      t('Coach proposals you have not decided on expire after 14 days. Scans keep nothing.'),
      t('Sign-in sessions: 90 days by default, or until you sign out everywhere.'),
      t('Backups: the server uses the Auto Backup service contracted with the hosting provider; what it covers ({0}), how often it runs ({1}) and how long its copies are kept ({2}) are still being verified.', VERIFY.backupScope, VERIFY.backupFrequency, VERIFY.backupRetention)
    ]} />
    <P>{t('These are the periods the app applies technically. The controller’s own retention policy for member, training, routine, progress and AI data is still pending ({0}).', VERIFY.retentionPolicy)}</P>
  </>,

  rights: () => <>
    <H>{t('Your rights')}</H>
    <P>{t('You can ask for access, rectification, erasure, restriction, portability and objection, withdraw any consent at any time, and complain to your data protection authority (in Spain, the AEPD).')}</P>
    <L items={[
      t('Export: Settings → Data → Export my data downloads one file with your account, synced state, follow-up answers, messages, friends, community posts, notifications, shares and Bunker PIN. It leaves out passkey keys and provider tokens, other people’s text, the image files of progress photos (only their descriptions) and the private professional notes of staff. You can ask for access to those notes by writing to {0}; the answer may be limited when that is needed to protect the rights of other people, protected internal information or other legal limits.', CONTROLLER.privacyEmail),
      t('Rectification: edit your profile, measurements and plan in the app; staff can correct measurements and routines for you; ask us for anything else.'),
      t('Erasure: Settings → Account → Delete my account removes your account, passkeys, push subscriptions, recovery links, synced state, follow-up answers and progress photos, messages, friends, notifications, shares, Bunker PIN, community posts and comments, goals, challenges you created, Coach record and uploaded images. Security events keep only anonymous facts (event, time, action).'),
      t('What can remain: copies in backups until they expire (see How long we keep it) — restoring an old backup could bring back deleted data. Trainer and admin accounts cannot be deleted from the app; ask the gym administrator.'),
      t('Connected apps: deleting your account removes the WHOOP and Strava tokens kept here, but the permission you granted stays in those apps until you revoke it there, and activities already created in Strava stay in Strava. AI providers keep nothing that 2J can delete, because 2J stores no copy of what it sent.'),
      t('Withdrawing consent: turn the Coach off in the Coach; do not confirm a scan; disconnect WHOOP or Strava in Settings (and revoke them in those apps); turn notifications off in Settings; withdraw Health Connect or HealthKit in your phone’s settings; change your sharing choices in Social. Withdrawing does not affect what happened before.')
    ]} />
  </>,

  contact: () => <>
    <H>{t('Contact')}</H>
    <P>{t('To exercise any right or ask a question about your data, write to {0}. Requests are answered within one month, as the GDPR requires.', CONTROLLER.privacyEmail)}</P>
    <P>{t('This text informs you about how the app handles data. It is not legal advice and does not by itself certify compliance with any law.')}</P>
  </>
}

export function PrivacySheet({ topic = 'policy' }) {
  const ids = TOPICS[topic] || TOPICS.policy
  return <>
    <h3>{topicTitle(topic)}</h3>
    <div className="small" style={{ lineHeight: 1.6 }}>
      {hasPendingLegalItems() && <div className="card" role="note" style={{ padding: 10, marginBottom: 6 }}>
        {t('Items shown as LEGAL_TBD_… are still being verified and are not yet legal statements.')}
      </div>}
      {ids.map(id => <div key={id}>{SECTIONS[id]()}</div>)}
    </div>
  </>
}
