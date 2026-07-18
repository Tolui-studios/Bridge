# Team Sync setup (Supabase)

Bridge's multi-operator mode uses one small Supabase project as the studio's coordination layer: presence (who is on which project), canonical goals, the shared per-project team note, and live agent session summaries. Code never flows through it — repos, agents, and worktrees stay on each person's machine and merge via git/GitHub.

One person does steps 1–4 once; every teammate then does step 5 in their own Bridge.

## 1. Create the project

- supabase.com → New project (free tier is fine). Any region.
- Copy from **Project Settings → API**: the **Project URL** and the **anon public** key.

## 2. Run this SQL (SQL Editor → New query → paste → Run)

```sql
-- Shared game index: one row per repo, keyed by normalized remote URL.
create table public.games (
  key text primary key,
  name text not null,
  updated_at timestamptz not null default now()
);

-- Canonical goals content per game (full GOALS.md markdown).
create table public.goals (
  game_key text primary key references public.games(key) on delete cascade,
  content text not null,
  version bigint not null default 1,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- Shared team note per game.
create table public.notes (
  game_key text primary key references public.games(key) on delete cascade,
  content text not null default '',
  version bigint not null default 1,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- Mirrored agent session summaries (no transcripts).
create table public.sessions (
  id uuid primary key,
  game_key text not null,
  owner text not null,
  summary jsonb not null,
  updated_at timestamptz not null default now()
);

-- Team roster + activity heartbeat (drives the green/yellow/red dots).
create table public.members (
  name text primary key,
  last_active timestamptz not null default now()
);

-- Keep updated_at fresh automatically.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger goals_touch before update on public.goals for each row execute function public.touch_updated_at();
create trigger notes_touch before update on public.notes for each row execute function public.touch_updated_at();
create trigger sessions_touch before update on public.sessions for each row execute function public.touch_updated_at();

-- Team-only access: any signed-in team account, nobody else.
alter table public.games enable row level security;
alter table public.goals enable row level security;
alter table public.notes enable row level security;
alter table public.sessions enable row level security;
alter table public.members enable row level security;
create policy "team all" on public.games for all to authenticated using (true) with check (true);
create policy "team all" on public.goals for all to authenticated using (true) with check (true);
create policy "team all" on public.notes for all to authenticated using (true) with check (true);
create policy "team all" on public.sessions for all to authenticated using (true) with check (true);
create policy "team all" on public.members for all to authenticated using (true) with check (true);

-- Realtime change feeds.
alter publication supabase_realtime add table public.games;
alter publication supabase_realtime add table public.goals;
alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.members;
```

> **Set the project up before the `games`/`members` additions?** Run just this migration in the SQL editor:
>
> ```sql
> create table public.members (
>   name text primary key,
>   last_active timestamptz not null default now()
> );
> alter table public.members enable row level security;
> create policy "team all" on public.members for all to authenticated using (true) with check (true);
> alter publication supabase_realtime add table public.games;
> alter publication supabase_realtime add table public.members;
> ```

## 3. Turn off public signups

**Authentication → Sign In / Up → disable "Allow new users to sign up".** Accounts are created by you only — that is what makes the data team-only.

## 4. Create one account per teammate

**Authentication → Users → Add user** (email + password, auto-confirm on). 3 users, 5 users — same steps, same cost (free tier realtime limits are far above a small studio).

## 5. Bake the server into the build (once)

Open `src/shared/teamDefaults.ts` and paste the Project URL + anon public key. Commit and push. The repo is private and the anon key is made to live in clients — the accounts + RLS are the security boundary, not this key.

## 6. Each teammate signs in

Sidebar → **Team** → *Sign in to team* → **email + password, nothing else.** The login persists; Bridge reconnects automatically on every launch. (An *Advanced* toggle in the sign-in dialog can still point one machine at a different server — useful for testing.)

## What syncs, what doesn't

| Synced live | Stays local |
|---|---|
| Who is focused on which project (presence chips + occupancy banner) | Code, repos, worktrees (merge via git/PRs) |
| Goals (check-bar) — canonical copy on the server, `GOALS.md` written locally as a projection | Agent execution + full transcripts |
| Team note per project | Claude login/billing (per user) |
| Agent session summaries (owner, task, status, turns, cost) | Vault path + registry (per machine) |

Notes:
- A game syncs only if its repo has an `origin` remote (that URL is its shared identity). Local-only folders (like the fixture) stay local-only.
- Agent branches are prefixed per user (`agent-<username>-1`) so pushes never collide.
- The anon key is not a secret in the usual sense (it is designed to ship in clients) — access control comes from the accounts + RLS. Still, keep the project private and don't commit the key anywhere.
