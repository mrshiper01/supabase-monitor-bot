create table if not exists public.function_runs (
  id bigint generated always as identity primary key,
  project_name text not null,
  function_name text not null,
  business_day date not null,
  record_count integer not null default 0,
  ran_at timestamptz not null default timezone('utc', now())
);

create index if not exists function_runs_business_day_idx
  on public.function_runs (business_day desc);

create index if not exists function_runs_function_name_idx
  on public.function_runs (function_name);

comment on table public.function_runs is
  'Registro de ejecuciones exitosas de funciones edge con conteo de registros procesados.';

comment on column public.function_runs.record_count is
  'Número de registros procesados/traídos por la función para ese día hábil.';

alter table public.function_runs enable row level security;
