import { z } from 'zod';
import { createDatabase } from './db.js';
import { TRAINING_LINK_AUDIENCE, TRAINING_LINK_PURPOSE, type ResolvedPersonAuth } from './training-link-protocol.js';
import { trainingLinkReceiptSchema, type TrainingLinkReceipt } from './training-integration.js';

type SqlClient = ReturnType<typeof createDatabase>['client'];
export type TrainingLinkReceiptReconciler = (context: { transactionId: string; personId: string; audience: string; purpose: string; challengeDigest: string }, signal: AbortSignal) => Promise<TrainingLinkReceipt | null>;
const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const futureSkewMs = 30_000;

function receiptFitsTransaction(receipt: TrainingLinkReceipt, row: Record<string, any>, now: number) {
  const verifiedAt = Date.parse(receipt.verifiedAt), createdAt = new Date(row.createdAt).getTime(), expiresAt = new Date(row.expiresAt).getTime();
  return Number.isFinite(verifiedAt) && new Date(verifiedAt).toISOString() === receipt.verifiedAt &&
    receipt.transactionId === row.transactionId && receipt.personId === row.personId &&
    receipt.audience === row.audience && receipt.purpose === row.purpose && receipt.challengeDigest === String(row.challengeDigest).trim() &&
    verifiedAt >= createdAt && verifiedAt <= expiresAt && verifiedAt <= now + futureSkewMs;
}

/** Internal Platform-only receipt recovery. It creates only a pending canonical link; it has no activation or SSO path. */
export function createTrainingCanonicalLinkLifecycle(database: SqlClient, options: {
  trainingVerifiedLinkingEnabled?: boolean;
  trainingServiceCallsEnabled?: boolean;
  trainingCanonicalLinkingEnabled?: boolean;
  reconcileReceipt?: TrainingLinkReceiptReconciler;
  now?: () => Date;
} = {}) {
  const enabled = options.trainingVerifiedLinkingEnabled === true && options.trainingServiceCallsEnabled === true && options.trainingCanonicalLinkingEnabled === true;
  return {
    async reconcile(input: { transactionId: string; auth: ResolvedPersonAuth }, signal = new AbortController().signal) {
      if (!enabled || !options.reconcileReceipt) return { status: 'disabled' as const };
      const transactionId = uuid.parse(input.transactionId), personId = uuid.parse(input.auth.personId);
      const auth = { ...input.auth, personId };
      const context = await database.begin(async (tx) => tx.unsafe(`
        SELECT t.transaction_id AS "transactionId",t.person_id AS "personId",t.auth_subject_link_id AS "authSubjectLinkId",
          t.state,t.created_at AS "createdAt",t.expires_at AS "expiresAt",t.nonce_hash AS "challengeDigest",t.audience,t.purpose,
          t.verified_training_user_id AS "verifiedTrainingUserId",p.status AS "personStatus",s.status AS "subjectStatus",
          s.auth_subject AS "authSubject",s.provider,s.provider_version AS "providerVersion"
        FROM training_link_transactions t
        JOIN platform_persons p ON p.id=t.person_id
        JOIN platform_person_auth_subjects s ON s.id=t.auth_subject_link_id
        WHERE t.transaction_id=$1 FOR SHARE OF t,p,s`, [transactionId]));
      const row = context[0] as Record<string, any> | undefined;
      if (!row) return { status: 'not_found' as const };
      if (row.personId !== personId) return { status: 'wrong_person' as const };
      if (row.authSubject !== auth.authSubject || row.provider !== auth.provider || row.providerVersion !== auth.providerVersion) return { status: 'wrong_auth_binding' as const };
      if (row.personStatus !== 'active' || row.subjectStatus !== 'active') return { status: 'identity_unavailable' as const };
      if (!['pending','verified','consumed'].includes(row.state)) return { status: 'not_recoverable' as const };
      if (row.audience !== TRAINING_LINK_AUDIENCE || row.purpose !== TRAINING_LINK_PURPOSE || !/^[a-f0-9]{64}$/.test(String(row.challengeDigest).trim())) return { status: 'context_invalid' as const };

      const remote = await options.reconcileReceipt({
        transactionId, personId, audience: row.audience, purpose: row.purpose, challengeDigest: String(row.challengeDigest).trim(),
      }, signal);
      const parsed = trainingLinkReceiptSchema.safeParse(remote);
      if (!parsed.success || !receiptFitsTransaction(parsed.data, row, (options.now ?? (() => new Date()))().getTime())) return { status: 'receipt_invalid' as const };
      const receipt = parsed.data;

      try {
        return await database.begin(async (tx) => {
          const locked = await tx.unsafe(`
            SELECT t.transaction_id AS "transactionId",t.person_id AS "personId",t.auth_subject_link_id AS "authSubjectLinkId",
              t.state,t.created_at AS "createdAt",t.expires_at AS "expiresAt",t.nonce_hash AS "challengeDigest",t.audience,t.purpose,
              t.verified_training_user_id AS "verifiedTrainingUserId",t.source_receipt_id AS "sourceReceiptId",
              p.status AS "personStatus",s.status AS "subjectStatus",s.auth_subject AS "authSubject",s.provider,s.provider_version AS "providerVersion"
            FROM training_link_transactions t JOIN platform_persons p ON p.id=t.person_id
            JOIN platform_person_auth_subjects s ON s.id=t.auth_subject_link_id
            WHERE t.transaction_id=$1 FOR UPDATE OF t,p,s`, [transactionId]);
          const current = locked[0] as Record<string, any> | undefined;
          if (!current || current.personId !== personId) return { status: 'not_found' as const };
          if (current.authSubject !== auth.authSubject || current.provider !== auth.provider || current.providerVersion !== auth.providerVersion) return { status: 'wrong_auth_binding' as const };
          if (current.personStatus !== 'active' || current.subjectStatus !== 'active') return { status: 'identity_unavailable' as const };
          if (!['pending','verified','consumed'].includes(current.state)) return { status: 'not_recoverable' as const };
          if (!receiptFitsTransaction(receipt, current, (options.now ?? (() => new Date()))().getTime())) return { status: 'receipt_invalid' as const };
          await tx.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`receipt:${receipt.receiptId}`]);
          const receiptOwner = await tx.unsafe('SELECT transaction_id AS "transactionId" FROM training_link_transactions WHERE source_receipt_id=$1', [receipt.receiptId]);
          if (receiptOwner[0] && receiptOwner[0].transactionId !== transactionId) {
            await tx.unsafe("INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES ($1,$2,'training.link_conflict_detected',$3,'{}'::jsonb)", [personId, current.authSubjectLinkId, transactionId]);
            return { status: 'conflict' as const };
          }
          if (current.verifiedTrainingUserId && current.verifiedTrainingUserId !== receipt.trainingUserId) {
            await tx.unsafe("INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES ($1,$2,'training.link_conflict_detected',$3,'{}'::jsonb)", [personId, current.authSubjectLinkId, transactionId]);
            return { status: 'conflict' as const };
          }
          if (current.sourceReceiptId && current.sourceReceiptId !== receipt.receiptId) {
            await tx.unsafe("INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES ($1,$2,'training.link_conflict_detected',$3,'{}'::jsonb)", [personId, current.authSubjectLinkId, transactionId]);
            return { status: 'conflict' as const };
          }

          let recovered = false;
          if (current.state === 'pending') {
            const changed = await tx.unsafe(`UPDATE training_link_transactions SET state='verified',verified_training_user_id=$2,
              verified_at=$3,source_receipt_id=$4,version=version+1 WHERE transaction_id=$1 AND state='pending'
              RETURNING transaction_id`, [transactionId, receipt.trainingUserId, receipt.verifiedAt, receipt.receiptId]);
            if (!changed.length) return { status: 'conflict' as const };
            recovered = true;
            await tx.unsafe("INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES ($1,$2,'training.link_reconciliation_recovered',$3,'{}'::jsonb)", [personId, current.authSubjectLinkId, transactionId]);
          }

          const replay = await tx.unsafe(`SELECT link_id AS "linkId",person_id AS "personId",training_user_id AS "trainingUserId",status,link_version AS "linkVersion",
              source_transaction_id AS "sourceTransactionId",source_receipt_id AS "sourceReceiptId"
            FROM training_account_links WHERE source_transaction_id=$1 OR source_receipt_id=$2 FOR UPDATE`, [transactionId, receipt.receiptId]);
          const same = replay.find((link: Record<string, any>) => link.personId === personId && link.trainingUserId === receipt.trainingUserId && link.sourceTransactionId === transactionId && link.sourceReceiptId === receipt.receiptId);
          if (same) return { status: 'pending' as const, recovered, replay: true, link: same };
          if (replay.length) {
            await tx.unsafe("INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES ($1,$2,'training.link_conflict_detected',$3,'{}'::jsonb)", [personId, current.authSubjectLinkId, transactionId]);
            return { status: 'conflict' as const };
          }

          const lockKeys = [`person:${personId}`, `training-user:${receipt.trainingUserId}`].sort();
          for (const key of lockKeys) await tx.unsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]);
          const collision = await tx.unsafe(`SELECT link_id AS "linkId",person_id AS "personId",training_user_id AS "trainingUserId" FROM training_account_links
            WHERE status IN ('pending','active','revocation_pending') AND (person_id=$1 OR training_user_id=$2) LIMIT 1 FOR UPDATE`, [personId, receipt.trainingUserId]);
          if (collision.length) {
            await tx.unsafe("INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES ($1,$2,'training.link_conflict_detected',$3,'{}'::jsonb)", [personId, current.authSubjectLinkId, transactionId]);
            return { status: 'conflict' as const };
          }
          const created = await tx.unsafe(`INSERT INTO training_account_links(request_id,person_id,training_user_id,status,method,source_transaction_id,source_receipt_id,link_version,created_by,updated_by)
            VALUES ($1,$2,$3,'pending','verified_training_proof',$1,$4,1,$5,$5)
            RETURNING link_id AS "linkId",person_id AS "personId",training_user_id AS "trainingUserId",status,link_version AS "linkVersion",
              source_transaction_id AS "sourceTransactionId",source_receipt_id AS "sourceReceiptId"`, [transactionId, personId, receipt.trainingUserId, receipt.receiptId, current.authSubjectLinkId]);
          const link = created[0];
          if (!link) throw new Error('canonical pending link insert returned no row');
          await tx.unsafe("INSERT INTO platform_identity_audit_events(person_id,actor_id,action,resource_id,details) VALUES ($1,$2,'training.link_pending_created',$3,($4::text)::jsonb)", [personId, current.authSubjectLinkId, link.linkId, JSON.stringify({ method: 'verified_training_proof', linkVersion: 1 })]);
          return { status: 'pending' as const, recovered, replay: false, link };
        });
      } catch (error) {
        if ((error as { code?: string }).code === '23505') return { status: 'conflict' as const };
        throw error;
      }
    },
  };
}
