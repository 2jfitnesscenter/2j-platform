// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The ONE place for the facts about the data controller. The values below come from the owner and
// from the documentation reviewed. Anything nobody has verified yet stays an explicit LEGAL_TBD_ placeholder: never invent
// it and never ship a guess. The privacy screen (views/Privacy.jsx) and docs/PRIVACY_POLICY.md
// read / mirror exactly these fields; the "still being verified" notice on the screen shows only
// while at least one LEGAL_TBD_ remains in this file.

export const CONTROLLER = {
  name: 'JUAN JOSE PEREZ SANCHEZ',
  taxId: '54088887V',
  address: 'FRANCISCO LOPEZ SANCHEZ 15, LOCAL, 35250 INGENIO, LAS PALMAS',
  privacyEmail: '2JFITNESSCENTER@GMAIL.COM',
  // SIREINSA provides privacy consultancy services to the controller. The documents reviewed do NOT
  // establish a formal designation as data protection officer, so it is never called one here.
  privacyAdvisor: 'SIREINSA',
  hosting: 'Contabo',
  serverRegion: 'Hub Europe'        // as documented; the country and the data centre are not specified and must not be invented
}

// Facts that are still being verified. Remove an entry (and its mention in the text) only when
// the real value is known.
export const VERIFY = {
  legalBasis: 'LEGAL_TBD_LEGAL_BASIS_REVIEW',           // the specific legal basis per processing, pending legal validation by the privacy advisor
  dpoDesignation: 'LEGAL_TBD_DPO_DESIGNATION',         // whether a data protection officer has been formally designated (and who)
  dpoContact: 'LEGAL_TBD_DPO_CONTACT',                 // the formal DPO contact channel, if one is designated
  backupScope: 'LEGAL_TBD_BACKUP_SCOPE',               // what Contabo's Auto Backup covers
  backupFrequency: 'LEGAL_TBD_BACKUP_FREQUENCY',       // how often it runs
  backupRetention: 'LEGAL_TBD_BACKUP_RETENTION',       // how long the copies are kept
  retentionPolicy: 'LEGAL_TBD_RETENTION_POLICY',       // the controller's own retention policy for member, training, routine, progress and AI data
  transferSafeguards: 'LEGAL_TBD_TRANSFER_SAFEGUARDS', // adequacy decision / SCC / DPF per current provider, once provider, location and terms are verified
  aiProviderTerms: 'LEGAL_TBD_AI_PROVIDER_TERMS'       // terms, data-processing agreement and processing location of the real AI provider accounts
}

const isTbd = v => typeof v === 'string' && v.startsWith('LEGAL_TBD_')

/** Every field of this file that is still a placeholder. */
export const pendingItems = () => [...Object.values(CONTROLLER), ...Object.values(VERIFY)].filter(isTbd)
export const hasPendingLegalItems = () => pendingItems().length > 0
