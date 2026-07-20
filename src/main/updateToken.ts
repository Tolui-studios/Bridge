/**
 * Read-only GitHub token used ONLY to download release assets, because
 * Tolui-studios/Bridge is a private repo and electron-updater fetches over
 * plain HTTPS with no other credential path.
 *
 * ⚠️ THIS TOKEN SHIPS INSIDE THE INSTALLER AND IS EXTRACTABLE.
 * `app.asar` is a container, not encryption — `npx asar extract` or a plain
 * `strings` over the binary recovers anything in here. Treat it as public.
 *
 * Therefore it MUST be a fine-grained PAT scoped to exactly:
 *   - Resource owner:  Tolui-studios
 *   - Repository access: ONLY "Bridge"  (never "all repositories")
 *   - Permissions:     Contents = Read-only.  Nothing else. No write, no
 *                      metadata beyond the implicit read, no other repo.
 * A classic PAT with `repo` scope grants READ AND WRITE to every private repo
 * in the org — never use one here.
 *
 * The worst case for a leaked fine-grained token above is that someone reads
 * Bridge's source. That is the accepted tradeoff for private-repo updates; if
 * that stops being acceptable, move releases to a public repo and delete this
 * file (see docs/AUTO-UPDATE.md).
 *
 * Expiry: fine-grained PATs expire (max 1 year). When it does, updates stop
 * silently for every installed copy — the updater logs the 401 and gives up.
 * Set a calendar reminder, rotate here, and ship a build.
 *
 * Leave empty to disable auto-update entirely (the updater no-ops and says so).
 */
export const UPDATE_REPO = { owner: "Tolui-studios", repo: "Bridge" };

export const UPDATE_TOKEN =
  "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";
