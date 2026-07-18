/**
 * Studio-wide team sync server, baked into the build so teammates only ever
 * enter email + password.
 *
 * One-time setup (after creating the Supabase project per docs/TEAM-SYNC.md):
 * paste the Project URL and anon public key here and commit. This repo is
 * private to the studio, and the anon key is designed to live in clients —
 * access control comes from the team accounts + row level security, not from
 * hiding this key. The Connect modal's Advanced section can still override
 * these per machine.
 */
export const TEAM_DEFAULTS = {
  url: '',
  anonKey: ''
}
