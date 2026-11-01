export const communityOnboardingKey = userId => `community-intro:v1:${userId || 'guest'}`
const resolveStorage = storage => typeof storage === 'function' ? storage() : storage

export function communityIntroSeen(storage, userId) {
  try { return resolveStorage(storage).getItem(communityOnboardingKey(userId)) === 'seen' } catch { return false }
}

export function markCommunityIntroSeen(storage, userId) {
  try { resolveStorage(storage).setItem(communityOnboardingKey(userId), 'seen'); return true } catch { return false }
}
