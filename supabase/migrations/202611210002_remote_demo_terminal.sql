create table if not exists public.market_settings (
  id boolean primary key default true check (id),
  volatility numeric not null default 0.62 check (volatility between 0.1 and 1),
  drift numeric not null default 0 check (drift between -0.5 and 0.5),
  chart_speed numeric not null default 1 check (chart_speed between 0.5 and 2),
  payout numeric not null default 82 check (payout between 1 and 95),
  updated_at timestamptz not null default now()
);

insert into public.market_settings (id) values (true)
on conflict (id) do nothing;

create table if not exists public.market_state (
  id boolean primary key default true check (id),
  price numeric not null default 3842.61,
  updated_at timestamptz not null default now()
);

insert into public.market_state (id) values (true)
on conflict (id) do nothing;

create table if not exists public.market_ticks (
  id bigint generated always as identity primary key,
  price numeric not null,
  created_at timestamptz not null default now()
);

insert into public.market_ticks (price, created_at)
select 3842.61, now() - (interval '1 second' * tick)
from generate_series(91, 0, -1) as ticks(tick)
where not exists (select 1 from public.market_ticks);

create table if not exists public.demo_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance numeric(14, 2) not null default 10000 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.demo_accounts (user_id)
select user_id from public.profiles
on conflict (user_id) do nothing;

create table if not exists public.demo_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  choice text not null check (choice in ('even', 'odd', 'over', 'under')),
  stake numeric(14, 2) not null check (stake > 0),
  payout numeric not null check (payout between 1 and 95),
  status text not null default 'open' check (status in ('open', 'closed')),
  result numeric(14, 2) not null default 0,
  entry_price numeric not null,
  final_digit smallint,
  duration_seconds integer not null check (duration_seconds in (10, 30, 60, 300)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  settled_at timestamptz
);

create index if not exists demo_trades_user_created
  on public.demo_trades (user_id, created_at desc);
create index if not exists demo_trades_open_expiry
  on public.demo_trades (user_id, expires_at)
  where status = 'open';

alter table public.market_settings enable row level security;
alter table public.market_state enable row level security;
alter table public.market_ticks enable row level security;
alter table public.demo_accounts enable row level security;
alter table public.demo_trades enable row level security;

revoke all on public.market_settings, public.market_state, public.market_ticks,
  public.demo_accounts, public.demo_trades from anon, authenticated;
grant select on public.market_settings to authenticated;
grant select on public.demo_accounts, public.demo_trades to authenticated;

drop policy if exists "Authenticated users can read market settings" on public.market_settings;
create policy "Authenticated users can read market settings"
  on public.market_settings for select to authenticated using (true);

drop policy if exists "Users can read their demo account" on public.demo_accounts;
create policy "Users can read their demo account"
  on public.demo_accounts for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their demo trades" on public.demo_trades;
create policy "Users can read their demo trades"
  on public.demo_trades for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'username', '')
  )
  on conflict (user_id) do nothing;

  insert into public.demo_accounts (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create or replace function public.get_terminal_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_settings public.market_settings%rowtype;
  v_price numeric;
  v_previous_price numeric;
  v_tick_time timestamptz;
  v_balance numeric;
  v_ticks jsonb;
  v_trades jsonb;
  v_trade public.demo_trades%rowtype;
  v_final_digit smallint;
  v_won boolean;
  v_result numeric(14, 2);
  v_should_tick boolean;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select * into v_settings
  from public.market_settings
  where id = true;

  select price, updated_at into v_previous_price, v_tick_time
  from public.market_state
  where id = true
  for update;

  v_should_tick := now() - v_tick_time
    >= make_interval(secs => (0.9 / v_settings.chart_speed)::double precision);
  v_price := v_previous_price;

  if v_should_tick then
    v_price := greatest(
      100,
      v_previous_price
        + ((random() - 0.5) * v_settings.volatility * 8)
        + (v_settings.drift * 0.4)
    );

    update public.market_state
    set price = v_price, updated_at = now()
    where id = true;

    insert into public.market_ticks (price) values (v_price);

    delete from public.market_ticks
    where id not in (
      select id from public.market_ticks order by id desc limit 92
    );
  end if;

  for v_trade in
    select * from public.demo_trades
    where user_id = v_user_id
      and status = 'open'
      and expires_at <= now()
    order by expires_at
    for update
  loop
    v_final_digit := mod(floor(abs(v_price * 100))::integer, 10);
    v_won := case v_trade.choice
      when 'even' then mod(v_final_digit, 2) = 0
      when 'odd' then mod(v_final_digit, 2) = 1
      when 'over' then v_price > v_trade.entry_price
      else v_price < v_trade.entry_price
    end;
    v_result := case
      when v_won then round(v_trade.stake * v_trade.payout / 100, 2)
      else -v_trade.stake
    end;

    update public.demo_trades
    set status = 'closed',
        result = v_result,
        final_digit = v_final_digit,
        settled_at = now()
    where id = v_trade.id;

    if v_won then
      update public.demo_accounts
      set balance = balance + v_trade.stake + v_result,
          updated_at = now()
      where user_id = v_user_id;
    end if;
  end loop;

  select balance into v_balance
  from public.demo_accounts
  where user_id = v_user_id;

  if not found then
    insert into public.demo_accounts (user_id)
    values (v_user_id)
    on conflict (user_id) do nothing;
    select balance into v_balance
    from public.demo_accounts
    where user_id = v_user_id;
  end if;

  select coalesce(
    jsonb_agg(jsonb_build_object('price', ticks.price) order by ticks.id),
    '[]'::jsonb
  )
  into v_ticks
  from (
    select id, price from public.market_ticks order by id desc limit 92
  ) as ticks;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', trades.id,
      'choice', trades.choice,
      'stake', trades.stake,
      'payout', trades.payout,
      'status', trades.status,
      'result', trades.result,
      'time', floor(extract(epoch from trades.created_at) * 1000),
      'duration', trades.duration_seconds,
      'entryPrice', trades.entry_price,
      'expiresAt', floor(extract(epoch from trades.expires_at) * 1000)
    ) order by trades.created_at desc),
    '[]'::jsonb
  )
  into v_trades
  from (
    select * from public.demo_trades
    where user_id = v_user_id
    order by created_at desc
    limit 100
  ) as trades;

  return jsonb_build_object(
    'price', v_price,
    'previousPrice', v_previous_price,
    'ticks', v_ticks,
    'settings', jsonb_build_object(
      'volatility', v_settings.volatility,
      'drift', v_settings.drift,
      'chartSpeed', v_settings.chart_speed,
      'payout', v_settings.payout
    ),
    'demoBalance', coalesce(v_balance, 10000),
    'trades', v_trades
  );
end;
$$;

create or replace function public.place_demo_trade(
  p_choice text,
  p_stake numeric,
  p_duration_seconds integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_balance numeric(14, 2);
  v_price numeric;
  v_payout numeric;
  v_trade_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_choice is null
     or p_choice not in ('even', 'odd', 'over', 'under')
     or p_duration_seconds is null
     or p_duration_seconds not in (10, 30, 60, 300)
     or p_stake is null
     or p_stake <= 0 then
    raise exception 'Invalid demo trade';
  end if;

  insert into public.demo_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select balance into v_balance
  from public.demo_accounts
  where user_id = v_user_id
  for update;

  if p_stake > v_balance then
    raise exception 'Stake exceeds available demo balance';
  end if;

  select price into v_price from public.market_state where id = true;
  select payout into v_payout from public.market_settings where id = true;

  update public.demo_accounts
  set balance = balance - p_stake, updated_at = now()
  where user_id = v_user_id;

  insert into public.demo_trades (
    user_id, choice, stake, payout, entry_price, duration_seconds, expires_at
  )
  values (
    v_user_id, p_choice, p_stake, v_payout, v_price,
    p_duration_seconds, now() + make_interval(secs => p_duration_seconds)
  )
  returning id into v_trade_id;

  return v_trade_id;
end;
$$;

create or replace function public.reset_demo_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  delete from public.demo_trades where user_id = v_user_id;
  insert into public.demo_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do update
    set balance = 10000, updated_at = now();
end;
$$;

create or replace function public.clear_demo_history()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if exists (
    select 1 from public.demo_trades
    where user_id = v_user_id and status = 'open'
  ) then
    raise exception 'Wait for open positions to settle before clearing history';
  end if;

  delete from public.demo_trades
  where user_id = v_user_id and status = 'closed';
end;
$$;

create or replace function public.update_market_settings(
  p_volatility numeric,
  p_drift numeric,
  p_chart_speed numeric,
  p_payout numeric
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

  update public.market_settings
  set volatility = p_volatility,
      drift = p_drift,
      chart_speed = p_chart_speed,
      payout = p_payout,
      updated_at = now()
  where id = true;
end;
$$;

create or replace function public.analyze_market(p_strategy text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prices numeric[];
  v_count integer;
  v_current numeric;
  v_fast numeric;
  v_slow numeric;
  v_mean numeric;
  v_momentum numeric;
  v_strength integer;
  v_signal numeric;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_strategy is null
     or p_strategy not in ('scanner', 'Pulse', 'Sentry', 'Orbit') then
    raise exception 'Unknown market analysis strategy';
  end if;

  select array_agg(sample.price order by sample.id desc)
  into v_prices
  from (
    select id, price from public.market_ticks order by id desc limit 30
  ) as sample;

  v_count := coalesce(array_length(v_prices, 1), 0);
  if v_count < 2 then
    raise exception 'Not enough market data to analyze';
  end if;

  v_current := v_prices[1];
  v_fast := (select avg(valueset.value) from unnest(v_prices[1:least(5, v_count)]) as valueset(value));
  v_slow := (select avg(valueset.value) from unnest(v_prices[1:least(15, v_count)]) as valueset(value));
  v_mean := (select avg(valueset.value) from unnest(v_prices) as valueset(value));
  v_momentum := v_current - v_prices[least(6, v_count)];
  v_signal := case p_strategy
    when 'Pulse' then v_momentum
    when 'Sentry' then v_fast - v_slow
    when 'Orbit' then v_mean - v_current
    else v_momentum
  end;
  v_strength := least(100, greatest(0, round(abs(v_momentum) / greatest(v_current, 1) * 16000)::integer));

  if p_strategy = 'scanner' then
    return jsonb_build_object(
      'strength', v_strength,
      'direction', case when v_fast > v_slow then 'Upward momentum' else 'Downward momentum' end,
      'advice', case
        when v_momentum / greatest(v_current, 1) > 0.00001 then 'Signals lean upward'
        when v_momentum / greatest(v_current, 1) < -0.00001 then 'Signals lean downward'
        else 'No clear directional setup'
      end
    );
  end if;

  if abs(v_signal / greatest(v_current, 1)) < 0.000002 then
    return jsonb_build_object('signal', null);
  end if;

  return jsonb_build_object(
    'signal', case when v_signal > 0 then 'over' else 'under' end,
    'strength', least(99, greatest(1, round(abs(v_signal) / greatest(v_current, 1) * 100000)::integer))
  );
end;
$$;

revoke all on function public.get_terminal_snapshot() from public, anon;
revoke all on function public.place_demo_trade(text, numeric, integer) from public, anon;
revoke all on function public.reset_demo_account() from public, anon;
revoke all on function public.clear_demo_history() from public, anon;
revoke all on function public.update_market_settings(numeric, numeric, numeric, numeric) from public, anon;
revoke all on function public.analyze_market(text) from public, anon;

grant execute on function public.get_terminal_snapshot() to authenticated;
grant execute on function public.place_demo_trade(text, numeric, integer) to authenticated;
grant execute on function public.reset_demo_account() to authenticated;
grant execute on function public.clear_demo_history() to authenticated;
grant execute on function public.update_market_settings(numeric, numeric, numeric, numeric) to authenticated;
grant execute on function public.analyze_market(text) to authenticated;
