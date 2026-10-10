import { createHash, createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { TrainingLinkVerificationContext, TrainingLinkVerifier } from './training-link-protocol.js';

const opaqueId = z.string().min(1).max(200).refine((value) => value.trim() === value, 'Identifier must be canonical');
const personUuid = z.string().uuid().transform((value) => value.toLowerCase());
export const platformSubjectSchema = z.object({
  v: z.literal(1), personId: personUuid, clientId: z.string().uuid().optional(), staffId: z.string().uuid().optional(),
  capabilities: z.array(z.enum(['client', 'staff'])).optional(), status: z.enum(['active', 'revoked']),
}).strict().superRefine((subject, context) => {
  if (!subject.clientId && !subject.staffId) context.addIssue({ code: 'custom', message: 'A subject must have at least one Platform facet.' });
  if (subject.capabilities && new Set(subject.capabilities).size !== subject.capabilities.length) context.addIssue({ code: 'custom', message: 'Capabilities must be unique.' });
});
export const linkProposalSchema = z.object({
  v: z.literal(1), personId: personUuid, candidate: z.object({ trainingUserId: opaqueId }).strict().optional(),
  method: z.literal('explicit_admin'), requestId: z.string().uuid(),
}).strict();
export const accessGrantSchema = z.object({ v: z.literal(1), personId: personUuid, trainingAccess: z.enum(['enabled', 'blocked', 'unknown']), asOf: z.string().datetime().optional() }).strict();
export const trainingSummarySchema = z.object({
  v: z.literal(1), personId: personUuid, asOf: z.string().datetime(),
  activity: z.object({ lastActivityAt: z.string().datetime().nullable() }).strict().optional(),
  program: z.object({ activeCount: z.number().int().nonnegative() }).strict().optional(),
  coach: z.object({ assigned: z.boolean() }).strict().optional(),
}).strict();

export type PlatformSubject = z.infer<typeof platformSubjectSchema>;
export type LinkProposal = z.infer<typeof linkProposalSchema>;
export type AccessGrant = z.infer<typeof accessGrantSchema>;
export type TrainingSummary = z.infer<typeof trainingSummarySchema>;
export type TrainingAdapter = {
  getSummary(personId: string, signal?: AbortSignal): Promise<{ status: 'disabled' | 'unavailable' | 'available'; summary?: TrainingSummary }>;
};

const TRAINING_PROOF_PATH = '/api/platform/v1/link-proofs/exchange';
const TRAINING_LINK_AUDIENCE = '2j-training-account-link';
const TRAINING_LINK_PURPOSE = 'training-account-link';
const proofAssertionSchema = z.object({ v: z.literal(1), code: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
const proofExchangeResponseSchema = z.object({
  v: z.literal(1), transactionId: z.string().uuid(), personId: z.string().uuid(),
  trainingUserId: opaqueId.refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
  audience: z.literal(TRAINING_LINK_AUDIENCE), purpose: z.literal(TRAINING_LINK_PURPOSE),
  verifiedAt: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
}).strict();
const exchangeContextSchema = z.object({
  transactionId: z.string().uuid(), personId: z.string().uuid(),
  audience: z.literal(TRAINING_LINK_AUDIENCE), purpose: z.literal(TRAINING_LINK_PURPOSE),
  challengeDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type RemoteTrainingLinkVerifierOptions = {
  trainingVerifiedLinkingEnabled?: boolean;
  trainingServiceCallsEnabled?: boolean;
  baseUrl?: string;
  keyId?: string;
  /** Canonical base64url-encoded key; decoded value must contain at least 32 bytes. */
  secret?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Test-only escape hatch; applies only to explicit loopback URLs. */
  allowInsecureLoopbackForTests?: boolean;
};

function parseRemoteTrainingConfig(options: RemoteTrainingLinkVerifierOptions) {
  try {
    if (options.trainingVerifiedLinkingEnabled !== true || options.trainingServiceCallsEnabled !== true || !options.fetcher || !options.keyId || !options.secret || !/^[A-Za-z0-9._-]{1,80}$/.test(options.keyId)) return null;
    const key = Buffer.from(options.secret, 'base64url');
    if (key.length < 32 || key.toString('base64url') !== options.secret) return null;
    const base = new URL(options.baseUrl || '');
    const host = base.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (base.username || base.password || base.pathname !== '/' || base.search || base.hash) return null;
    if (base.protocol !== 'https:' && !(options.allowInsecureLoopbackForTests === true && base.protocol === 'http:' && loopback)) return null;
    return { origin: base.origin, key };
  } catch { return null; }
}

/** Bounded UTF-8 JSON reader shared by the signed proof verifier only. */
async function readProofResponse(response: Response, maxBytes: number, signal: AbortSignal) {
  if (response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') throw new Error('unexpected response content type');
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new Error('response too large');
  if (!response.body) throw new Error('missing response body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw signal.reason ?? new Error('request aborted');
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('response too large'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Fail-closed Platform → Training proof exchange. It never trusts context supplied by assertion or response. */
export function createRemoteTrainingLinkVerifier(options: RemoteTrainingLinkVerifierOptions = {}): TrainingLinkVerifier {
  const config = parseRemoteTrainingConfig(options);
  return async (untrustedContext: TrainingLinkVerificationContext, externalSignal: AbortSignal) => {
    if (!config) return null;
    const assertion = proofAssertionSchema.safeParse(untrustedContext.assertion);
    const context = exchangeContextSchema.safeParse({
      transactionId: untrustedContext.transactionId, personId: untrustedContext.personId,
      audience: untrustedContext.audience, purpose: untrustedContext.purpose,
      challengeDigest: untrustedContext.challengeDigest,
    });
    if (!assertion.success || !context.success || externalSignal.aborted) return null;

    const requestBody = Buffer.from(JSON.stringify({ v: 1, code: assertion.data.code, ...context.data }), 'utf8');
    const requestId = randomUUID();
    const timestamp = new Date().toISOString();
    const path = TRAINING_PROOF_PATH;
    const signingInput: ServiceSigningInput = { keyId: options.keyId!, timestamp, requestId, method: 'POST', path, body: requestBody };
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(externalSignal.reason);
    externalSignal.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error('Training exchange deadline exceeded')), Math.max(1, Math.min(options.timeoutMs ?? 8_000, 8_000)));
    const aborted = new Promise<never>((_resolve, reject) => {
      if (controller.signal.aborted) reject(controller.signal.reason ?? new Error('request aborted'));
      else controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new Error('request aborted')), { once: true });
    });
    try {
      const headers = await Promise.race([buildTrainingServiceAuthHeaders(signingInput, async (canonical) => createHmac('sha256', config.key).update(Buffer.from(canonical, 'utf8')).digest('base64url'), controller.signal), aborted]);
      const url = new URL(path, config.origin);
      const response = await Promise.race([options.fetcher!(url, {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
        body: requestBody,
      }), aborted]);
      if (response.status !== 200 || !response.ok) return null;
      const raw = await Promise.race([readProofResponse(response, Math.max(1, Math.min(options.maxResponseBytes ?? 16_384, 16_384)), controller.signal), aborted]);
      let decoded: unknown;
      try { decoded = JSON.parse(raw); } catch { return null; }
      const parsed = proofExchangeResponseSchema.safeParse(decoded);
      if (!parsed.success) return null;
      const value = parsed.data;
      const verifiedAt = new Date(value.verifiedAt);
      if (!Number.isFinite(verifiedAt.getTime()) || verifiedAt.toISOString() !== value.verifiedAt) return null;
      if (value.transactionId !== context.data.transactionId || value.personId !== context.data.personId || value.audience !== context.data.audience || value.purpose !== context.data.purpose) return null;
      return value.trainingUserId;
    } catch { return null; }
    finally {
      clearTimeout(timeout);
      externalSignal.removeEventListener('abort', abortFromCaller);
    }
  };
}

export type ServiceSigningInput = { keyId: string; timestamp: string; requestId: string; method: string; path: string; body: Uint8Array };

/** V1 canonical bytes: UTF-8, seven newline-separated fields, no trailing newline; bodyDigest is lowercase SHA-256 hex. */
export function canonicalizeTrainingServiceRequest(input: ServiceSigningInput) {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(input.keyId) || !z.string().uuid().safeParse(input.requestId).success) throw new Error('invalid signing metadata');
  const timestamp = new Date(input.timestamp);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== input.timestamp) throw new Error('timestamp must be canonical UTC ISO-8601');
  if (!['GET', 'POST'].includes(input.method) || !input.path.startsWith('/') || input.path.startsWith('//') || input.path.includes('\\') || /[\u0000-\u001f\u007f]/.test(input.path) || input.path.includes('#')) throw new Error('invalid request target');
  const separator = input.path.indexOf('?'), rawPath = separator < 0 ? input.path : input.path.slice(0, separator);
  const target = new URL(input.path, 'https://canonical.invalid');
  if (target.origin !== 'https://canonical.invalid' || target.pathname !== rawPath || target.search !== (separator < 0 ? '' : input.path.slice(separator))) throw new Error('non-canonical request target');
  const segments = rawPath.split('/').map((segment) => { try { return decodeURIComponent(segment); } catch { return '..'; } });
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))) throw new Error('path traversal rejected');
  const bodyDigest = createHash('sha256').update(input.body).digest('hex');
  return ['2J-SERVICE-AUTH-V1', input.keyId, input.timestamp, input.requestId, input.method, input.path, bodyDigest].join('\n');
}

export function buildTrainingServiceAuthHeaders(input: ServiceSigningInput, signCanonical: (canonicalRequest: string, signal: AbortSignal) => Promise<string>, signal: AbortSignal) {
  const canonicalRequest = canonicalizeTrainingServiceRequest(input);
  return signCanonical(canonicalRequest, signal).then((signature) => {
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(signature)) throw new Error('invalid signer output');
    return {
      'x-2j-key-id': input.keyId,
      'x-2j-timestamp': input.timestamp,
      'x-2j-request-id': input.requestId,
      'x-2j-signature': signature,
    };
  });
}

function isLoopback(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
function boundedUrl(baseUrl: string, allowedOrigins: string[], allowInsecureLocalForTests: boolean, personId: string) {
  const normalizedPersonId = personUuid.parse(personId);
  const base = new URL(baseUrl);
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('base URL must be an origin');
  if (base.protocol !== 'https:' && !(allowInsecureLocalForTests && base.protocol === 'http:' && isLoopback(base.hostname))) throw new Error('HTTPS is required');
  if (!allowedOrigins.includes(base.origin)) throw new Error('origin is not allowed');
  const path = '/api/platform/v1/persons/' + normalizedPersonId + '/summary';
  return { url: new URL(path, base.origin), path };
}

async function readBoundedBody(response: Response, maxBytes: number, signal: AbortSignal) {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new Error('unexpected content type');
  const lengthHeader = response.headers.get('content-length');
  if (lengthHeader && (!/^\d+$/.test(lengthHeader) || Number(lengthHeader) > maxBytes)) throw new Error('response too large');
  if (!response.body) throw new Error('missing response body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('request aborted');
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('response too large'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Fail-soft adapter. No request is possible without explicit enablement, origin allowlist, signer and fetcher. */
export function createTrainingAdapter(options: {
  enabled?: boolean; baseUrl?: string; allowedOrigins?: string[]; fetcher?: typeof fetch;
  signRequest?: (canonicalRequest: string, signal: AbortSignal) => Promise<string>; keyId?: string;
  timeoutMs?: number; maxResponseBytes?: number; allowInsecureLocalForTests?: boolean;
} = {}): TrainingAdapter {
  return {
    async getSummary(personId, externalSignal) {
      if (!options.enabled || !options.baseUrl || !options.fetcher || !options.signRequest || !options.keyId || !options.allowedOrigins?.length) return { status: 'disabled' };
      const controller = new AbortController();
      const abortFromExternal = () => controller.abort(externalSignal?.reason);
      if (externalSignal?.aborted) abortFromExternal();
      else externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
      const timeout = setTimeout(() => controller.abort(new Error('deadline exceeded')), options.timeoutMs ?? 2_000);
      const abortPromise = new Promise<never>((_resolve, reject) => {
        if (controller.signal.aborted) reject(controller.signal.reason ?? new Error('request aborted'));
        else controller.signal.addEventListener('abort', () => reject(controller.signal.reason ?? new Error('request aborted')), { once: true });
      });
      try {
        const { url, path } = boundedUrl(options.baseUrl, options.allowedOrigins, options.allowInsecureLocalForTests === true, personId);
        const timestamp = new Date().toISOString(), requestId = randomUUID();
        const signing: ServiceSigningInput = { keyId: options.keyId, timestamp, requestId, method: 'GET', path, body: new Uint8Array() };
        const headers = await Promise.race([buildTrainingServiceAuthHeaders(signing, options.signRequest, controller.signal), abortPromise]);
        if (controller.signal.aborted) return { status: 'unavailable' };
        const response = await Promise.race([options.fetcher(url, { method: 'GET', redirect: 'error', signal: controller.signal, headers: { accept: 'application/json', ...headers } }), abortPromise]);
        if (!response.ok) return { status: 'unavailable' };
        const raw = await Promise.race([readBoundedBody(response, options.maxResponseBytes ?? 16_384, controller.signal), abortPromise]);
        const parsed = trainingSummarySchema.safeParse(JSON.parse(raw));
        return parsed.success && parsed.data.personId === personUuid.parse(personId) ? { status: 'available', summary: parsed.data } : { status: 'unavailable' };
      } catch { return { status: 'unavailable' }; }
      finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener('abort', abortFromExternal);
      }
    },
  };
}
