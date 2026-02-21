create table if not exists public.audit_config (
  id            bigint generated always as identity primary key,
  display_name  text    not null,
  function_name text,
  target_table  text    not null,
  date_column   text    not null,
  date_column_type text not null default 'date'
    check (date_column_type in ('date', 'timestamp')),
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now()
);

alter table public.audit_config enable row level security;

comment on table  public.audit_config is
  'Configuración de tablas a auditar en el comando /audit de Discord.';
comment on column public.audit_config.function_name is
  'Nombre de la edge function relacionada (coincide con function_errors.function_name). Opcional.';
comment on column public.audit_config.date_column_type is
  'date: columna DATE (usa eq). timestamp: columna TIMESTAMPTZ (usa gte/lt de medianoche a medianoche UTC).';

-- -------------------------------------------------------------------------
-- Seed: todas las tablas de sync con su columna de fecha más semántica
-- -------------------------------------------------------------------------
insert into public.audit_config
  (display_name, function_name, target_table, date_column, date_column_type, sort_order)
values
  -- Agora transaccional — filtra por business_day exacto
  ('Facturas Agora',           'sync-agora-invoices',              'agora_invoices',             'business_day',       'date',      10),
  ('Pedidos Venta Agora',      'sync-agora-sales-orders',          'agora_sales_orders',         'business_day',       'date',      20),
  ('Caja Agora',               'sync-agora-cash-transactions',     'agora_cash_transactions',    'business_day',       'date',      30),
  ('Cierres Caja Agora',       'sync-agora-pos-closeouts',         'agora_pos_closeouts',        'business_day',       'date',      40),

  -- Cheerfy — filtra por last_synced_at (registros tocados en el sync del día)
  ('Ventas Cheerfy',           'sync-cheerfy-sales',               'cheerfy_sales',              'last_synced_at',     'timestamp', 50),
  ('Detalle Ventas Cheerfy',   'sync-cheerfy-sales-details',       'cheerfy_sales_details',      'last_synced_at',     'timestamp', 60),
  ('Visitas Cheerfy',          'sync-cheerfy-visits',              'cheerfy_visits',             'last_synced_at',     'timestamp', 70),
  ('Mensajes Cheerfy',         'sync-cheerfy-messages',            'cheerfy_messages',           'last_synced_at',     'timestamp', 80),
  ('Vouchers Cheerfy',         'sync-cheerfy-vouchers',            'cheerfy_vouchers',           'last_synced_at',     'timestamp', 90),
  ('Fidelización Cheerfy',     'sync-cheerfy-loyalty-cards',       'cheerfy_loyalty_cards',      'last_synced_at',     'timestamp', 100),
  ('Cashback Cheerfy',         'sync-cheerfy-cashback',            'cheerfy_cashback',           'last_synced_at',     'timestamp', 110),
  ('Clientes Cheerfy',         'sync-cheerfy-customers',           'cheerfy_customers',          'last_synced_at',     'timestamp', 120),
  ('Ventas x Cliente Cheerfy', 'sync-cheerfy-customer-sales',      'cheerfy_customer_sales',     'last_synced_at',     'timestamp', 130),

  -- Pelusa transaccional — filtra por la fecha de negocio de cada tabla
  ('Fabricaciones Pelusa',     'sync-pelusa-fabricaciones',        'pelusa_fabricaciones',       'fecha_fabricacion',  'timestamp', 140),
  ('Mermas Pelusa',            'sync-pelusa-mermas-detalladas',    'pelusa_mermas_detalladas',   'fecha',              'timestamp', 150),
  ('Reg. Stock Pelusa',        'sync-pelusa-regularizacion-stock', 'pelusa_regularizacion_stock','fecha',              'timestamp', 160),
  ('Traspasos Pelusa',         'sync-pelusa-traspasos-y-ajustes',  'pelusa_traspasos_y_ajustes', 'fecha',              'timestamp', 170);
