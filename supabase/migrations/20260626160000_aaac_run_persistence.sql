-- AAAC Run persistence for analytics dashboard (sync from local run.json + artifacts)

create table if not exists public.aaac_runs (
  run_id text primary key,
  workspace_root text,
  origin text,
  session_id text,
  conversation_id text,
  command text not null,
  verb text,
  object text,
  domain text,
  intent text,
  orchestrator text,
  status text not null,
  phase text,
  phase_kind text,
  awaiting_approval boolean not null default false,
  blocked_reason text,
  pending jsonb not null default '[]'::jsonb,
  completed jsonb not null default '[]'::jsonb,
  execution jsonb,
  confidence jsonb,
  gates jsonb,
  swarm jsonb,
  context jsonb,
  capabilities_resolved jsonb,
  capability_runtime jsonb,
  capability_runtime_approved boolean not null default false,
  capability_evidence_processed boolean not null default false,
  capability_evidence_outcomes jsonb,
  enforcement jsonb,
  manifest jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  synced_at timestamptz not null default now()
);

create index if not exists aaac_runs_status_idx on public.aaac_runs (status);
create index if not exists aaac_runs_command_idx on public.aaac_runs (command);
create index if not exists aaac_runs_updated_at_idx on public.aaac_runs (updated_at desc);
create index if not exists aaac_runs_session_id_idx on public.aaac_runs (session_id);
create index if not exists aaac_runs_conversation_id_idx on public.aaac_runs (conversation_id);

create table if not exists public.aaac_run_events (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references public.aaac_runs (run_id) on delete cascade,
  event_seq integer not null,
  at timestamptz not null,
  phase text,
  phase_kind text,
  skill text,
  event text not null,
  detail text,
  level text,
  unique (run_id, event_seq)
);

create index if not exists aaac_run_events_run_id_at_idx
  on public.aaac_run_events (run_id, at);

create table if not exists public.aaac_run_decisions (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references public.aaac_runs (run_id) on delete cascade,
  decision_seq integer not null,
  at timestamptz not null,
  phase text,
  decision text not null,
  reason text,
  evidence text,
  unique (run_id, decision_seq)
);

create table if not exists public.aaac_run_phases (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references public.aaac_runs (run_id) on delete cascade,
  phase text not null,
  artifact_bytes integer,
  compaction_applied boolean,
  estimated_utilization numeric,
  unique (run_id, phase)
);

create table if not exists public.aaac_run_artifacts (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references public.aaac_runs (run_id) on delete cascade,
  rel_path text not null,
  content_type text,
  byte_size integer,
  body text,
  storage_url text,
  updated_at timestamptz not null default now(),
  unique (run_id, rel_path)
);

create table if not exists public.aaac_run_capabilities (
  id uuid primary key default gen_random_uuid(),
  run_id text not null references public.aaac_runs (run_id) on delete cascade,
  capability_id text not null,
  providers jsonb,
  runtime jsonb,
  evidence_outcome jsonb,
  unique (run_id, capability_id)
);

create table if not exists public.aaac_sessions (
  session_id text primary key,
  run_id text references public.aaac_runs (run_id) on delete set null,
  origin text,
  workspace_root text,
  command text,
  phase text,
  status text,
  started_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.aaac_runs enable row level security;
alter table public.aaac_run_events enable row level security;
alter table public.aaac_run_decisions enable row level security;
alter table public.aaac_run_phases enable row level security;
alter table public.aaac_run_artifacts enable row level security;
alter table public.aaac_run_capabilities enable row level security;
alter table public.aaac_sessions enable row level security;

create policy "Authenticated read aaac_runs"
  on public.aaac_runs for select to authenticated using (true);

create policy "Authenticated read aaac_run_events"
  on public.aaac_run_events for select to authenticated using (true);

create policy "Authenticated read aaac_run_decisions"
  on public.aaac_run_decisions for select to authenticated using (true);

create policy "Authenticated read aaac_run_phases"
  on public.aaac_run_phases for select to authenticated using (true);

create policy "Authenticated read aaac_run_artifacts"
  on public.aaac_run_artifacts for select to authenticated using (true);

create policy "Authenticated read aaac_run_capabilities"
  on public.aaac_run_capabilities for select to authenticated using (true);

create policy "Authenticated read aaac_sessions"
  on public.aaac_sessions for select to authenticated using (true);
