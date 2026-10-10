import { z } from 'zod';

const opaqueId = z.string().min(1).max(200).refine((value) => value.trim() === value, 'Identifier must be canonical');
export const platformSubjectSchema = z.object({
  v: z.literal(1), personId: z.string().uuid(), clientId: z.string().uuid().optional(), staffId: z.string().uuid().optional(),
  capabilities: z.array(z.enum(['client', 'staff'])).optional(), status: z.enum(['active', 'revoked']),
}).strict().superRefine((subject, context) => {
  if (!subject.clientId && !subject.staffId) context.addIssue({ code: 'custom', message: 'A subject must have at least one Platform facet.' });
  if (subject.capabilities && new Set(subject.capabilities).size !== subject.capabilities.length) context.addIssue({ code: 'custom', message: 'Capabilities must be unique.' });
});
export const linkProposalSchema = z.object({
  v: z.literal(1), personId: z.string().uuid(), candidate: z.object({ trainingUserId: opaqueId }).strict().optional(),
  method: z.literal('explicit_admin'), requestId: z.string().uuid(),
}).strict();
export const accessGrantSchema = z.object({ v: z.literal(1), personId: z.string().uuid(), trainingAccess: z.enum(['enabled', 'blocked', 'unknown']), asOf: z.string().datetime().optional() }).strict();
export const trainingSummarySchema = z.object({
  v: z.literal(1), personId: z.string().uuid(), asOf: z.string().datetime(),
  activity: z.object({ lastActivityAt: z.string().datetime().nullable() }).strict().optional(),
  program: z.object({ activeCount: z.number().int().nonnegative() }).strict().optional(),
  coach: z.object({ assigned: z.boolean() }).strict().optional(),
}).strict();

export type PlatformSubject = z.infer<typeof platformSubjectSchema>;
export type LinkProposal = z.infer<typeof linkProposalSchema>;
export type AccessGrant = z.infer<typeof accessGrantSchema>;
export type TrainingSummary = z.infer<typeof trainingSummarySchema>;

export type TrainingAdapter = {
  getSummary(personId: string): Promise<{ status: 'disabled' | 'unavailable' | 'available'; summary?: TrainingSummary }>;
};

/** Fail-soft read adapter. It makes no network request unless explicitly enabled and configured. */
export function createTrainingAdapter(options: { enabled?: boolean; baseUrl?: string; fetcher?: typeof fetch; signRequest?: (url: URL, timestamp: string) => Promise<Record<string, string>>; timeoutMs?: number } = {}): TrainingAdapter {
  return {
    async getSummary(personId) {
      if (!options.enabled || !options.baseUrl || !options.fetcher || !options.signRequest) return { status: 'disabled' };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2_000);
      try {
        const url = new URL(`/api/platform/v1/persons/${encodeURIComponent(personId)}/summary`, options.baseUrl);
        const timestamp = new Date().toISOString();
        const signedHeaders = await options.signRequest(url, timestamp);
        const response = await options.fetcher(url, { method: 'GET', signal: controller.signal, headers: { accept: 'application/json', ...signedHeaders } });
        if (!response.ok) return { status: 'unavailable' };
        const parsed = trainingSummarySchema.safeParse(await response.json());
        return parsed.success && parsed.data.personId === personId ? { status: 'available', summary: parsed.data } : { status: 'unavailable' };
      } catch {
        return { status: 'unavailable' };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
