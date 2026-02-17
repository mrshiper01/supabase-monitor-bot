create table if not exists public.function_errors (
  id bigint generated always as identity primary key,
  project_name text not null,
  function_name text not null,
  error_message text not null,
  error_stack text,
  occurred_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists function_errors_occurred_at_idx
  on public.function_errors (occurred_at desc);

create index if not exists function_errors_function_name_idx
  on public.function_errors (function_name);

alter table public.function_errors enable row level security;
