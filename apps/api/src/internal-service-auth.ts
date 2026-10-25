import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { canonicalizeTrainingServiceRequest } from './training-integration.js';
import type { createDatabase } from './db.js';

type DB = ReturnType<typeof createDatabase>['client'];
export type InternalServiceCaller = 'home' | 'bunker';
export interface InternalServiceKey { readonly caller: InternalServiceCaller; readonly secret: string }
export type InternalServiceKeys = Readonly<Record<string, InternalServiceKey>>;

export const INTERNAL_SERVICE_AUTH_CLOCK_SKEW_SECONDS = 30;
const replayRetentionSeconds = 120;
const keyIdPattern = /^[A-Za-z0-9._-]{1,80}$/;
const signaturePattern = /^[A-Za-z0-9_-]{43}$/;

/** Parse server-only key configuration. Secrets are canonical base64url and never returned. */
export function parseInternalServiceKeys(value: string | undefined): InternalServiceKeys {
  if (!value) return Object.freeze({});
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('PLATFORM_INTERNAL_SERVICE_KEYS must be a JSON object');
  const keys: Record<string, InternalServiceKey> = {};
  for (const [keyId, candidate] of Object.entries(parsed)) {
    if (!keyIdPattern.test(keyId) || !candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Invalid internal service key configuration');
    const item = candidate as Record<string, unknown>;
    if (!['home', 'bunker'].includes(String(item.caller)) || typeof item.secret !== 'string') throw new Error('Invalid internal service key configuration');
    const secretBytes = Buffer.from(item.secret, 'base64url');
    if (secretBytes.length < 32 || secretBytes.toString('base64url') !== item.secret) throw new Error('Internal service keys must be canonical base64url values of at least 32 bytes');
    keys[keyId] = Object.freeze({ caller: item.caller as InternalServiceCaller, secret: item.secret });
  }
  return Object.freeze(keys);
}

export interface VerifiedInternalServiceRequest { readonly caller: InternalServiceCaller; readonly keyId: string; readonly requestId: string }

/** Verifies the existing 2J-SERVICE-AUTH-V1 canonical request and atomically consumes its nonce. */
export async function verifyInternalServiceRequest(
  request: FastifyRequest,
  db: DB,
  keys: InternalServiceKeys,
  options: { now?: Date; expectedMethod: 'GET' | 'POST'; expectedPath: string; /** Exact request bytes; required for POST so the body digest is part of the signature. */ body?: Uint8Array } ,
): Promise<VerifiedInternalServiceRequest | { readonly unavailable: true } | null> {
  try {
    const keyId = singleHeader(request.headers['x-2j-key-id']);
    const timestamp = singleHeader(request.headers['x-2j-timestamp']);
    const requestId = singleHeader(request.headers['x-2j-request-id']);
    const signature = singleHeader(request.headers['x-2j-signature']);
    if (!keyIdPattern.test(keyId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) || !signaturePattern.test(signature)) return null;
    const key = keys[keyId];
    if (!key) return null;
    if (request.method !== options.expectedMethod || request.raw.url !== options.expectedPath) return null;
    if (options.expectedMethod === 'GET') {
      const contentLength = request.headers['content-length'];
      if ((contentLength !== undefined && contentLength !== '0') || request.headers['transfer-encoding'] !== undefined) return null;
    } else if (!options.body || request.headers['transfer-encoding'] !== undefined) return null;
    const now = options.now ?? new Date();
    const parsedTimestamp = new Date(timestamp);
    if (!Number.isFinite(parsedTimestamp.getTime()) || parsedTimestamp.toISOString() !== timestamp || Math.abs(now.getTime() - parsedTimestamp.getTime()) > INTERNAL_SERVICE_AUTH_CLOCK_SKEW_SECONDS * 1000) return null;
    const canonical = canonicalizeTrainingServiceRequest({ keyId, timestamp, requestId, method: request.method, path: options.expectedPath, body: options.expectedMethod === 'POST' ? options.body! : new Uint8Array() });
    const expected = createHmac('sha256', Buffer.from(key.secret, 'base64url')).update(Buffer.from(canonical, 'utf8')).digest();
    const supplied = Buffer.from(signature, 'base64url');
    if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return null;
    const requestUuid = requestId.toLowerCase();
    let accepted: boolean;
    try {
      accepted = await db.begin(async (tx) => {
        await tx`DELETE FROM platform_service_request_replays WHERE expires_at <= ${now.toISOString()}::timestamptz`;
        const inserted = await tx`INSERT INTO platform_service_request_replays(request_id,key_id,received_at,expires_at) VALUES (${requestUuid}::uuid,${keyId},${now.toISOString()}::timestamptz,${new Date(now.getTime() + replayRetentionSeconds * 1000).toISOString()}::timestamptz) ON CONFLICT (request_id) DO NOTHING RETURNING request_id`;
        return inserted.length === 1;
      });
    } catch { return { unavailable:true }; }
    if (!accepted) return null;
    return { caller: key.caller, keyId, requestId: requestUuid };
  } catch {
    return null;
  }
}

function singleHeader(value: string | string[] | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : Array.isArray(value) && value.length === 1 ? value[0] ?? fallback : fallback;
}

export function signedRequestSignature(secret: string, input: { keyId: string; timestamp: string; requestId: string; method: string; path: string; body?: Uint8Array }): string {
  const canonical = canonicalizeTrainingServiceRequest({ ...input, body: input.body ?? new Uint8Array() });
  return createHmac('sha256', Buffer.from(secret, 'base64url')).update(Buffer.from(canonical, 'utf8')).digest('base64url');
}
