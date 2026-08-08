-- AAAC run telemetry: phase timing/tokens + per-agent rows

alter table public.aaac_run_phases
  add column if not exists evidence_lines_trimmed integer,
  add column if not exists tokens integer,
  add column if not exists duration_ms bigint,
  add column if not exists context_score numeric,
  add column if not exists swarm_count integer;

create table if not exists public.aaac_run_agents (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references public.aaac_runs (run_id) on delete cascade,
  phase text not null,
  agent_index integer not null,
  subagent_type text,
  description text,
  model text,
  readonly boolean,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms bigint,
  tokens integer,
  context_score numeric,
  cursor_run_id text,
  unique (run_id, phase, agent_index)
);

create index if not exists aaac_run_agents_run_id_phase_idx
  on public.aaac_run_agents (run_id, phase);

alter table public.aaac_run_agents enable row level security;

create policy aaac_run_agents_read_authenticated
  on public.aaac_run_agents for select to authenticated using (true);
