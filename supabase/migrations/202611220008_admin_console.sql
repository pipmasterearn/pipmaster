create table if not exists public.strategy_catalog (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9_-]{1,39}$'),
  name text not null unique check (length(btrim(name)) between 1 and 80),
  algorithm_key text not null check (algorithm_key in ('Pulse', 'Sentry', 'Orbit', 'LAMIA', 'INSTA', 'SKPOT', 'VULJA')),
  strategy_type text not null default '' check (length(strategy_type) <= 80),
  description text not null default '' check (length(description) <= 300),
  tier text not null default 'Standard' check (length(tier) <= 40),
  icon text not null default '◈' check (length(icon) <= 8),
  color text not null default '#61b8ed' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  price_usd numeric(12, 2) not null default 0 check (price_usd between 0 and 100000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.strategy_catalog
  (id, name, algorithm_key, strategy_type, description, tier, icon, color)
values
  ('pulse', 'Pulse', 'Pulse', 'Momentum crossover', 'Short momentum signals', 'Balanced', '↗', '#9d8aff'),
  ('sentry', 'Sentry', 'Sentry', 'Trend confirmation', 'Multiple indicators aligned', 'Conservative', '◉', '#54d5b6'),
  ('orbit', 'Orbit', 'Orbit', 'Range movement', 'Looks for price movement near recent range', 'Experimental', '◎', '#f6b95d'),
  ('lamia', 'LAMIA', 'LAMIA', 'Quick Trade', 'Three-tick momentum signal', 'Fast', '↗', '#ff8c72'),
  ('insta', 'INSTA', 'INSTA', 'Instant Trade', 'Last-tick direction signal', 'Instant', '⚡', '#f5cf61'),
  ('skpot', 'SKPOT', 'SKPOT', 'Scalping', 'Fast and slow average crossover', 'Short-term', '⌁', '#61b8ed'),
  ('vulja', 'VULJA', 'VULJA', 'Strategy Trade', 'Trend and momentum confirmation', 'Confirmed', '✦', '#df87da')
on conflict (id) do nothing;

create table if not exists public.strategy_purchases (
  user_id uuid not null references auth.users (id) on delete restrict,
  strategy_id text not null references public.strategy_catalog (id) on delete restrict,
  purchase_price_usd numeric(12, 2) not null check (purchase_price_usd >= 0),
  balance_after_usd numeric(14, 2) not null check (balance_after_usd >= 0),
  purchased_at timestamptz not null default now(),
  primary key (user_id, strategy_id)
);

create index if not exists strategy_purchases_strategy_purchased
  on public.strategy_purchases (strategy_id, purchased_at desc);

alter table public.strategy_catalog enable row level security;
alter table public.strategy_purchases enable row level security;
revoke all on public.strategy_catalog, public.strategy_purchases from public, anon, authenticated;

create table if not exists public.admin_business_expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null check (length(btrim(category)) between 1 and 60),
  description text not null default '' check (length(description) <= 500),
  amount_usd numeric(14, 2) not null check (amount_usd > 0),
  expense_date date not null default current_date,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'void')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists admin_business_expenses_date
  on public.admin_business_expenses (expense_date desc, created_at desc);
alter table public.admin_business_expenses enable row level security;
revoke all on public.admin_business_expenses from public, anon, authenticated;

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (length(title) between 1 and 120),
  message text not null check (length(message) between 1 and 500),
  notification_type text not null default 'system' check (length(notification_type) <= 40),
  entity_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists app_notifications_user_created
  on public.app_notifications (user_id, created_at desc);
create index if not exists app_notifications_user_unread
  on public.app_notifications (user_id, created_at desc)
  where read_at is null;
alter table public.app_notifications enable row level security;
revoke all on public.app_notifications from public, anon, authenticated;

create or replace function public.get_strategy_catalog()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_catalog jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', bots.id,
      'name', bots.name,
      'strategyKey', bots.algorithm_key,
      'type', bots.strategy_type,
      'description', bots.description,
      'tier', bots.tier,
      'icon', bots.icon,
      'color', bots.color,
      'price', bots.price_usd,
      'owned', bots.price_usd = 0 or purchases.user_id is not null
    ) order by bots.name),
    '[]'::jsonb
  )
  into v_catalog
  from public.strategy_catalog as bots
  left join public.strategy_purchases as purchases
    on purchases.strategy_id = bots.id
   and purchases.user_id = v_user_id
  where bots.is_active;

  return v_catalog;
end;
$$;

create or replace function public.save_admin_strategy(
  p_id text,
  p_name text,
  p_algorithm_key text,
  p_strategy_type text,
  p_description text,
  p_tier text,
  p_icon text,
  p_color text,
  p_price_usd numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Administrator access required';
  end if;
  if p_id is null or p_id !~ '^[a-z0-9][a-z0-9_-]{1,39}$'
     or p_name is null or length(btrim(p_name)) not between 1 and 80
     or p_algorithm_key is null
     or p_algorithm_key not in ('Pulse', 'Sentry', 'Orbit', 'LAMIA', 'INSTA', 'SKPOT', 'VULJA')
     or length(coalesce(p_strategy_type, '')) > 80
     or length(coalesce(p_description, '')) > 300
     or length(coalesce(p_tier, '')) > 40
     or length(coalesce(p_icon, '')) > 8
     or p_color is null or p_color !~ '^#[0-9A-Fa-f]{6}$'
     or p_price_usd is null or p_price_usd < 0 or p_price_usd > 100000 then
    raise exception 'Invalid bot details or price';
  end if;

  insert into public.strategy_catalog (
    id, name, algorithm_key, strategy_type, description, tier, icon, color, price_usd
  )
  values (
    p_id, btrim(p_name), p_algorithm_key, btrim(coalesce(p_strategy_type, '')),
    btrim(coalesce(p_description, '')), btrim(coalesce(p_tier, 'Standard')),
    coalesce(nullif(btrim(p_icon), ''), '◈'), lower(p_color), p_price_usd
  )
  on conflict (id) do update
  set name = excluded.name,
      algorithm_key = excluded.algorithm_key,
      strategy_type = excluded.strategy_type,
      description = excluded.description,
      tier = excluded.tier,
      icon = excluded.icon,
      color = excluded.color,
      price_usd = excluded.price_usd,
      updated_at = now();
end;
$$;

create or replace function public.set_admin_strategy_active(p_id text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Administrator access required';
  end if;
  if p_id is null or p_active is null then
    raise exception 'A bot and availability status are required';
  end if;
  update public.strategy_catalog
  set is_active = p_active, updated_at = now()
  where id = p_id;
  if not found then
    raise exception 'Bot was not found';
  end if;
end;
$$;

create or replace function public.purchase_strategy(p_strategy_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_price numeric(12, 2);
  v_balance numeric(14, 2);
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select price_usd into v_price
  from public.strategy_catalog
  where id = p_strategy_id and is_active
  for update;
  if not found then
    raise exception 'This bot is no longer available';
  end if;

  if exists (
    select 1 from public.strategy_purchases
    where user_id = v_user_id and strategy_id = p_strategy_id
  ) then
    return jsonb_build_object('owned', true, 'alreadyOwned', true, 'price', v_price);
  end if;

  insert into public.wallet_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select balance_usd into v_balance
  from public.wallet_accounts
  where user_id = v_user_id
  for update;

  if v_balance < v_price then
    raise exception 'Insufficient wallet balance to unlock this bot';
  end if;

  update public.wallet_accounts
  set balance_usd = balance_usd - v_price,
      updated_at = now()
  where user_id = v_user_id
  returning balance_usd into v_balance;

  insert into public.strategy_purchases (user_id, strategy_id, purchase_price_usd, balance_after_usd)
  values (v_user_id, p_strategy_id, v_price, v_balance);

  return jsonb_build_object('owned', true, 'alreadyOwned', false, 'price', v_price, 'balance', v_balance);
end;
$$;

create or replace function public.get_admin_transactions(
  p_status text default 'all',
  p_type text default 'all',
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total bigint;
  v_items jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Administrator access required';
  end if;
  if p_status is null or p_status not in ('all', 'awaiting_payment', 'pending', 'confirmed', 'rejected')
     or p_type is null or p_type not in ('all', 'deposit', 'withdrawal')
     or p_offset is null or p_offset < 0 or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Invalid transaction page request';
  end if;

  select count(*) into v_total
  from public.wallet_transactions as transactions
  where (p_status = 'all' or transactions.status = p_status)
    and (p_type = 'all' or transactions.transaction_type = p_type);

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', page.id,
      'userId', page.user_id,
      'email', page.email,
      'fullName', page.full_name,
      'type', page.transaction_type,
      'amount', page.amount_usd,
      'fee', page.fee_usd,
      'payout', page.payout_usd,
      'status', page.status,
      'reference', page.reference_code,
      'destination', page.withdrawal_destination,
      'instructions', page.payment_instructions,
      'note', page.review_note,
      'time', floor(extract(epoch from page.created_at) * 1000),
      'reviewedAt', floor(extract(epoch from page.reviewed_at) * 1000)
    ) order by page.created_at desc),
    '[]'::jsonb
  )
  into v_items
  from (
    select transactions.*, users.email, profiles.full_name
    from public.wallet_transactions as transactions
    join auth.users as users on users.id = transactions.user_id
    left join public.profiles as profiles on profiles.user_id = transactions.user_id
    where (p_status = 'all' or transactions.status = p_status)
      and (p_type = 'all' or transactions.transaction_type = p_type)
    order by transactions.created_at desc
    offset p_offset
    limit p_limit
  ) as page;

  return jsonb_build_object('items', v_items, 'total', v_total, 'offset', p_offset, 'limit', p_limit);
end;
$$;

create or replace function public.get_admin_users(
  p_search text default '',
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search text := lower(btrim(coalesce(p_search, '')));
  v_total bigint;
  v_items jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Administrator access required';
  end if;
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Invalid user page request';
  end if;

  select count(*) into v_total
  from auth.users as users
  left join public.profiles as profiles on profiles.user_id = users.id
  where v_search = ''
     or lower(coalesce(users.email, '')) like '%' || v_search || '%'
     or lower(coalesce(profiles.full_name, '')) like '%' || v_search || '%'
     or lower(coalesce(profiles.username, '')) like '%' || v_search || '%';

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', page.id,
      'email', page.email,
      'fullName', page.full_name,
      'username', page.username,
      'role', page.role,
      'balance', page.balance_usd,
      'createdAt', floor(extract(epoch from page.created_at) * 1000)
    ) order by page.created_at desc),
    '[]'::jsonb
  )
  into v_items
  from (
    select users.id, users.email, users.created_at,
      profiles.full_name, profiles.username, profiles.role,
      coalesce(wallet.balance_usd, 0) as balance_usd
    from auth.users as users
    left join public.profiles as profiles on profiles.user_id = users.id
    left join public.wallet_accounts as wallet on wallet.user_id = users.id
    where v_search = ''
       or lower(coalesce(users.email, '')) like '%' || v_search || '%'
       or lower(coalesce(profiles.full_name, '')) like '%' || v_search || '%'
       or lower(coalesce(profiles.username, '')) like '%' || v_search || '%'
    order by users.created_at desc
    offset p_offset
    limit p_limit
  ) as page;

  return jsonb_build_object('items', v_items, 'total', v_total, 'offset', p_offset, 'limit', p_limit);
end;
$$;

create or replace function public.add_admin_expense(
  p_category text,
  p_description text,
  p_amount_usd numeric,
  p_expense_date date default current_date,
  p_status text default 'unpaid'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Administrator access required';
  end if;
  if p_category is null or length(btrim(p_category)) not between 1 and 60
     or length(coalesce(p_description, '')) > 500
     or p_amount_usd is null or p_amount_usd <= 0
     or p_expense_date is null
     or p_status is null or p_status not in ('unpaid', 'paid') then
    raise exception 'Enter a valid expense record';
  end if;

  insert into public.admin_business_expenses (
    category, description, amount_usd, expense_date, status, created_by, paid_at
  )
  values (
    btrim(p_category), btrim(coalesce(p_description, '')), p_amount_usd,
    p_expense_date, p_status, auth.uid(),
    case when p_status = 'paid' then now() else null end
  )
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.set_admin_expense_status(p_expense_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Administrator access required';
  end if;
  if p_expense_id is null or p_status is null or p_status not in ('unpaid', 'paid', 'void') then
    raise exception 'Invalid expense update';
  end if;
  update public.admin_business_expenses
  set status = p_status,
      paid_at = case
        when p_status = 'paid' then coalesce(paid_at, now())
        else null
      end,
      updated_at = now()
  where id = p_expense_id;
  if not found then
    raise exception 'Expense record was not found';
  end if;
end;
$$;

create or replace function public.get_admin_overview()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_registered bigint;
  v_total_wallet numeric(14, 2);
  v_confirmed_deposits numeric(14, 2);
  v_paid_withdrawals numeric(14, 2);
  v_pending_withdrawals numeric(14, 2);
  v_open_exposure numeric(14, 2);
  v_paid_expenses numeric(14, 2);
  v_unpaid_expenses numeric(14, 2);
  v_bot_sales numeric(14, 2);
  v_pending_count bigint;
  v_completed_count bigint;
  v_rejected_count bigint;
  v_pending_deposit_total numeric(14, 2);
  v_expenses jsonb;
  v_strategies jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Administrator access required';
  end if;

  select count(*) into v_registered from auth.users;
  select coalesce(sum(balance_usd), 0) into v_total_wallet from public.wallet_accounts;
  select coalesce(sum(amount_usd), 0) into v_confirmed_deposits
  from public.wallet_transactions
  where transaction_type = 'deposit' and status = 'confirmed';
  select coalesce(sum(payout_usd), 0) into v_paid_withdrawals
  from public.wallet_transactions
  where transaction_type = 'withdrawal' and status = 'confirmed';
  select coalesce(sum(amount_usd), 0) into v_pending_withdrawals
  from public.wallet_transactions
  where transaction_type = 'withdrawal' and status = 'pending';
  select coalesce(sum(stake_usd * (1 + payout_percent / 100)), 0)
  into v_open_exposure
  from public.wallet_trades
  where status = 'open';
  select coalesce(sum(amount_usd), 0) into v_paid_expenses
  from public.admin_business_expenses
  where status = 'paid';
  select coalesce(sum(amount_usd), 0) into v_unpaid_expenses
  from public.admin_business_expenses
  where status = 'unpaid';
  select coalesce(sum(purchase_price_usd), 0) into v_bot_sales
  from public.strategy_purchases;
  select count(*), coalesce(sum(amount_usd) filter (where transaction_type = 'deposit'), 0)
  into v_pending_count, v_pending_deposit_total
  from public.wallet_transactions
  where status in ('pending', 'awaiting_payment');
  select count(*) into v_completed_count
  from public.wallet_transactions where status = 'confirmed';
  select count(*) into v_rejected_count
  from public.wallet_transactions where status = 'rejected';

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', expenses.id,
      'category', expenses.category,
      'description', expenses.description,
      'amount', expenses.amount_usd,
      'date', expenses.expense_date,
      'status', expenses.status,
      'createdAt', floor(extract(epoch from expenses.created_at) * 1000),
      'paidAt', floor(extract(epoch from expenses.paid_at) * 1000)
    ) order by expenses.expense_date desc, expenses.created_at desc),
    '[]'::jsonb
  )
  into v_expenses
  from (
    select * from public.admin_business_expenses
    order by expense_date desc, created_at desc
    limit 100
  ) as expenses;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', bots.id,
      'name', bots.name,
      'strategyKey', bots.algorithm_key,
      'type', bots.strategy_type,
      'description', bots.description,
      'tier', bots.tier,
      'icon', bots.icon,
      'color', bots.color,
      'price', bots.price_usd,
      'active', bots.is_active,
      'purchases', coalesce(sales.purchase_count, 0),
      'sales', coalesce(sales.sales_usd, 0)
    ) order by bots.name),
    '[]'::jsonb
  )
  into v_strategies
  from public.strategy_catalog as bots
  left join (
    select strategy_id, count(*) as purchase_count, sum(purchase_price_usd) as sales_usd
    from public.strategy_purchases
    group by strategy_id
  ) as sales on sales.strategy_id = bots.id;

  return jsonb_build_object(
    'summary', jsonb_build_object(
      'registeredUsers', v_registered,
      'totalWalletBalances', v_total_wallet,
      'confirmedDeposits', v_confirmed_deposits,
      'paidWithdrawalPayouts', v_paid_withdrawals,
      'pendingWithdrawalReserves', v_pending_withdrawals,
      'openTradeMaximumExposure', v_open_exposure,
      'paidExpenses', v_paid_expenses,
      'unpaidExpenses', v_unpaid_expenses,
      'botSales', v_bot_sales,
      'pendingTransactions', v_pending_count,
      'pendingDepositAmount', v_pending_deposit_total,
      'completedTransactions', v_completed_count,
      'rejectedTransactions', v_rejected_count,
      'estimatedNetRetained', v_confirmed_deposits - v_paid_withdrawals
        - v_total_wallet - v_pending_withdrawals - v_open_exposure - v_paid_expenses - v_unpaid_expenses
    ),
    'strategies', v_strategies,
    'expenses', v_expenses
  );
end;
$$;

create or replace function public.get_notifications_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_notifications jsonb;
  v_unread bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  select count(*) into v_unread
  from public.app_notifications
  where user_id = v_user_id and read_at is null;
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', items.id,
      'title', items.title,
      'message', items.message,
      'type', items.notification_type,
      'entityId', items.entity_id,
      'time', floor(extract(epoch from items.created_at) * 1000),
      'readAt', floor(extract(epoch from items.read_at) * 1000)
    ) order by items.created_at desc),
    '[]'::jsonb
  )
  into v_notifications
  from (
    select * from public.app_notifications
    where user_id = v_user_id
    order by created_at desc
    limit 50
  ) as items;
  return jsonb_build_object('unreadCount', v_unread, 'items', v_notifications);
end;
$$;

create or replace function public.analyze_bot_market(p_strategy_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_algorithm_key text;
  v_price numeric(12, 2);
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select algorithm_key, price_usd
  into v_algorithm_key, v_price
  from public.strategy_catalog
  where id = p_strategy_id and is_active;
  if not found then
    raise exception 'This bot is not available';
  end if;
  if v_price > 0 and not exists (
    select 1 from public.strategy_purchases
    where user_id = v_user_id and strategy_id = p_strategy_id
  ) then
    raise exception 'Unlock this bot before generating its signal';
  end if;

  return public.analyze_market(v_algorithm_key);
end;
$$;

create or replace function public.analyze_scanner_market()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  return public.analyze_market('scanner');
end;
$$;

revoke all on function public.analyze_market(text) from authenticated;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  update public.app_notifications
  set read_at = coalesce(read_at, now())
  where id = p_notification_id and user_id = auth.uid();
  if not found then
    raise exception 'Notification was not found';
  end if;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  update public.app_notifications
  set read_at = now()
  where user_id = auth.uid() and read_at is null;
end;
$$;

create or replace function public.publish_admin_announcement(p_title text, p_message text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created integer;
begin
  if not exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Administrator access required';
  end if;
  if p_title is null or length(btrim(p_title)) not between 1 and 120
     or p_message is null or length(btrim(p_message)) not between 1 and 500 then
    raise exception 'Announcement title and message are required';
  end if;

  insert into public.app_notifications (user_id, title, message, notification_type)
  select users.id, btrim(p_title), btrim(p_message), 'announcement'
  from auth.users as users;
  get diagnostics v_created = row_count;
  return v_created;
end;
$$;

create or replace function public.notify_wallet_transaction_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.app_notifications (user_id, title, message, notification_type, entity_id)
    values (
      new.user_id,
      case when new.transaction_type = 'deposit' then 'Deposit request created' else 'Withdrawal request submitted' end,
      case when new.transaction_type = 'deposit'
        then 'Complete the payment and submit its reference for admin review.'
        else 'Your withdrawal request is awaiting admin review.'
      end,
      'wallet',
      new.id
    );
    if new.transaction_type = 'withdrawal' and new.status = 'pending' then
      insert into public.app_notifications (user_id, title, message, notification_type, entity_id)
      select profiles.user_id, 'Withdrawal request needs review',
        'A user submitted a withdrawal request for ' || to_char(new.amount_usd, 'FM999999999990.00') || ' USD.',
        'admin-wallet', new.id
      from public.profiles
      where profiles.role = 'admin';
    end if;
    return new;
  end if;

  if old.status is distinct from new.status then
    if new.status in ('confirmed', 'rejected') then
      insert into public.app_notifications (user_id, title, message, notification_type, entity_id)
      values (
        new.user_id,
        case when new.status = 'confirmed' then 'Wallet request completed' else 'Wallet request rejected' end,
        case
          when new.transaction_type = 'deposit' and new.status = 'confirmed'
            then 'Your deposit was verified and credited to your wallet.'
          when new.transaction_type = 'withdrawal' and new.status = 'confirmed'
            then 'Your withdrawal was marked complete. Check the review note for payout details.'
          else coalesce(nullif(new.review_note, ''), 'Open your wallet activity for request details.')
        end,
        'wallet',
        new.id
      );
    end if;

    if new.transaction_type = 'deposit' and new.status = 'pending' then
      insert into public.app_notifications (user_id, title, message, notification_type, entity_id)
      select profiles.user_id, 'Deposit payment submitted',
        'A deposit reference is ready for verification.',
        'admin-wallet', new.id
      from public.profiles
      where profiles.role = 'admin';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists notify_wallet_transaction_change on public.wallet_transactions;
create trigger notify_wallet_transaction_change
  after insert or update of status on public.wallet_transactions
  for each row execute procedure public.notify_wallet_transaction_change();

create or replace function public.notify_wallet_trade_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'open' and new.status in ('won', 'lost') then
    insert into public.app_notifications (user_id, title, message, notification_type, entity_id)
    values (
      new.user_id,
      case when new.status = 'won' then 'Live position won' else 'Live position settled' end,
      case when new.status = 'won'
        then 'Your Live position paid ' || to_char(new.result_usd, 'FM999999999990.00') || ' USD profit.'
        else 'Your Live position settled with a loss of ' || to_char(abs(new.result_usd), 'FM999999999990.00') || ' USD.'
      end,
      'wallet-trade',
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_wallet_trade_settlement on public.wallet_trades;
create trigger notify_wallet_trade_settlement
  after update of status on public.wallet_trades
  for each row execute procedure public.notify_wallet_trade_settlement();

create or replace function public.notify_demo_trade_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'open' and new.status = 'closed' then
    insert into public.app_notifications (user_id, title, message, notification_type, entity_id)
    values (
      new.user_id,
      case when new.result > 0 then 'Demo position won' else 'Demo position settled' end,
      case when new.result > 0
        then 'Your Demo position paid ' || to_char(new.result, 'FM999999999990.00') || ' USD profit.'
        else 'Your Demo position settled with a loss of ' || to_char(abs(new.result), 'FM999999999990.00') || ' USD.'
      end,
      'demo-trade',
      new.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists notify_demo_trade_settlement on public.demo_trades;
create trigger notify_demo_trade_settlement
  after update of status on public.demo_trades
  for each row execute procedure public.notify_demo_trade_settlement();

create or replace function public.notify_strategy_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select name into v_name from public.strategy_catalog where id = new.strategy_id;
  insert into public.app_notifications (user_id, title, message, notification_type)
  values (
    new.user_id,
    'Bot unlocked',
    coalesce(v_name, 'Your bot') || ' is now available in your strategy list.',
    'bot-purchase'
  );
  insert into public.app_notifications (user_id, title, message, notification_type)
  select profiles.user_id, 'Bot purchase recorded',
    coalesce(v_name, 'A bot') || ' was unlocked for ' || to_char(new.purchase_price_usd, 'FM999999999990.00') || ' USD.',
    'admin-bot-purchase'
  from public.profiles
  where profiles.role = 'admin' and profiles.user_id <> new.user_id;
  return new;
end;
$$;

drop trigger if exists notify_strategy_purchase on public.strategy_purchases;
create trigger notify_strategy_purchase
  after insert on public.strategy_purchases
  for each row execute procedure public.notify_strategy_purchase();

create or replace function public.notify_new_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.app_notifications (user_id, title, message, notification_type)
  values (
    new.user_id,
    'Welcome to PIPMASTER',
    'Your account is ready. Wallet requests, trade results, and account updates will appear here.',
    'account'
  );
  insert into public.app_notifications (user_id, title, message, notification_type)
  select profiles.user_id, 'New user registered',
    coalesce(nullif(new.full_name, ''), 'A new user') || ' joined PIPMASTER.',
    'admin-user'
  from public.profiles
  where profiles.role = 'admin' and profiles.user_id <> new.user_id;
  return new;
end;
$$;

drop trigger if exists notify_new_profile on public.profiles;
create trigger notify_new_profile
  after insert on public.profiles
  for each row execute procedure public.notify_new_profile();

revoke all on function public.get_strategy_catalog() from public, anon;
revoke all on function public.save_admin_strategy(text, text, text, text, text, text, text, text, numeric) from public, anon;
revoke all on function public.set_admin_strategy_active(text, boolean) from public, anon;
revoke all on function public.purchase_strategy(text) from public, anon;
revoke all on function public.get_admin_transactions(text, text, integer, integer) from public, anon;
revoke all on function public.get_admin_users(text, integer, integer) from public, anon;
revoke all on function public.add_admin_expense(text, text, numeric, date, text) from public, anon;
revoke all on function public.set_admin_expense_status(uuid, text) from public, anon;
revoke all on function public.get_admin_overview() from public, anon;
revoke all on function public.analyze_bot_market(text) from public, anon;
revoke all on function public.analyze_scanner_market() from public, anon;
revoke all on function public.get_notifications_snapshot() from public, anon;
revoke all on function public.mark_notification_read(uuid) from public, anon;
revoke all on function public.mark_all_notifications_read() from public, anon;
revoke all on function public.publish_admin_announcement(text, text) from public, anon;

grant execute on function public.get_strategy_catalog() to authenticated;
grant execute on function public.save_admin_strategy(text, text, text, text, text, text, text, text, numeric) to authenticated;
grant execute on function public.set_admin_strategy_active(text, boolean) to authenticated;
grant execute on function public.purchase_strategy(text) to authenticated;
grant execute on function public.get_admin_transactions(text, text, integer, integer) to authenticated;
grant execute on function public.get_admin_users(text, integer, integer) to authenticated;
grant execute on function public.add_admin_expense(text, text, numeric, date, text) to authenticated;
grant execute on function public.set_admin_expense_status(uuid, text) to authenticated;
grant execute on function public.get_admin_overview() to authenticated;
grant execute on function public.analyze_bot_market(text) to authenticated;
grant execute on function public.analyze_scanner_market() to authenticated;
grant execute on function public.get_notifications_snapshot() to authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.publish_admin_announcement(text, text) to authenticated;
