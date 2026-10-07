# main protection

Desired: required PR, one approving independent review, dismiss stale reviews, last-push approval, conversation resolution, no force-push/deletion, enforced for admins. CI status checks added when the stable CI workflow exists (2J-004); never invent successful checks. CODEOWNERS points to owner for routing, not independent approval.

Apply with: `gh api --method PUT repos/2jfitnesscenter/REPO/branches/main/protection --input protection.json`. If private-repository plan rejects protection, owner must enable a supporting GitHub plan or equivalent ruleset before production. Until then main protection is procedural only; avoid direct pushes and require manual PR approval. Do not change repository visibility to bypass this limitation.

Observed 2026-10-07: GitHub API returned HTTP 403: Upgrade to GitHub Pro or make this repository public. Repository remains private. main protection is NOT enabled. Owner has ADMIN access; default is main.
