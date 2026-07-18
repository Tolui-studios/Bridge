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
  url: 'https://fwjxjgehzenefrwdwyxt.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3anhqZ2VoemVuZWZyd2R3eXh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNTYzODYsImV4cCI6MjA5OTkzMjM4Nn0.VLIOmAySR-o5zC0VY4vzw91NfCKk5oh2pzdcf4E9fsU'
}

/** New games get their private repo created here (needs `gh` CLI, authed). */
export const STUDIO_GITHUB_ORG = 'Tolui-studios'
