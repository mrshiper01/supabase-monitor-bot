alter table public.function_errors
  add column if not exists business_day date,
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'retrying', 'resolved', 'rejected')),
  add column if not exists retried_at timestamptz;

create index if not exists function_errors_status_idx
  on public.function_errors (status)
  where status = 'pending';

create index if not exists function_errors_business_day_idx
  on public.function_errors (business_day desc);

comment on column public.function_errors.business_day is
  'Día hábil que la función intentaba procesar cuando falló (= occurred_at::date - 1 día)';

comment on column public.function_errors.status is
  'pending: sin acción | retrying: reintento en curso | resolved: backfill exitoso | rejected: ignorado manualmente';
