create table if not exists public.live_market_state (
  id boolean primary key default true check (id),
  price numeric not null,
  updated_at timestamptz not null default now()
);

insert into public.live_market_state (id, price, updated_at)
select true, price, updated_at
from public.market_state
where id = true
on conflict (id) do nothing;

create table if not exists public.live_market_ticks (
  id bigint generated always as identity primary key,
  price numeric not null,
  created_at timestamptz not null default now()
);

insert into public.live_market_ticks (price, created_at)
select price, created_at
from public.market_ticks
where not exists (select 1 from public.live_market_ticks)
order by id;

alter table public.live_market_state enable row level security;
alter table public.live_market_ticks enable row level security;
revoke all on public.live_market_state, public.live_market_ticks from public, anon, authenticated;

create or replace function public.advance_live_market()
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.market_settings%rowtype;
  v_previous_price numeric;
  v_updated_at timestamptz;
  v_price numeric;
begin
  select * into v_settings
  from public.market_settings
  where id = true;

  select price, updated_at into v_previous_price, v_updated_at
  from public.live_market_state
  where id = true
  for update;

  if not found then
    raise exception 'The Live market is not initialized';
  end if;

  v_price := v_previous_price;
  if now() - v_updated_at >= make_interval(secs => (0.9 / v_settings.chart_speed)::double precision) then
    v_price := greatest(
      100,
      v_previous_price
        + ((random() - 0.5) * v_settings.volatility * 8)
        + (v_settings.drift * 0.4)
    );

    update public.live_market_state
    set price = v_price, updated_at = now()
    where id = true;

    insert into public.live_market_ticks (price) values (v_price);

    delete from public.live_market_ticks
    where id not in (
      select id from public.live_market_ticks order by id desc limit 92
    );
  end if;

  return v_price;
end;
$$;

revoke all on function public.advance_live_market() from public, anon, authenticated;

create or replace function public.get_live_market_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.market_settings%rowtype;
  v_price numeric;
  v_previous_price numeric;
  v_ticks jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_price := public.advance_live_market();

  select * into v_settings
  from public.market_settings
  where id = true;

  select coalesce(
    jsonb_agg(jsonb_build_object('price', ticks.price) order by ticks.id),
    '[]'::jsonb
  )
  into v_ticks
  from (
    select id, price
    from public.live_market_ticks
    order by id desc
    limit 92
  ) as ticks;

  select price into v_previous_price
  from (
    select id, price
    from public.live_market_ticks
    order by id desc
    limit 2
  ) as recent_ticks
  order by id
  limit 1;

  return jsonb_build_object(
    'price', v_price,
    'previousPrice', coalesce(v_previous_price, v_price),
    'ticks', v_ticks,
    'settings', jsonb_build_object(
      'volatility', v_settings.volatility,
      'drift', v_settings.drift,
      'chartSpeed', v_settings.chart_speed,
      'payout', v_settings.payout
    )
  );
end;
$$;

create or replace function public.place_wallet_trade(
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
     or p_stake < 1
     or p_stake <> round(p_stake, 2) then
    raise exception 'Invalid wallet position. The minimum stake is $1.00.';
  end if;

  insert into public.wallet_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select balance_usd into v_balance
  from public.wallet_accounts
  where user_id = v_user_id
  for update;

  if p_stake > v_balance then
    raise exception 'Insufficient wallet balance. The stake cannot exceed available funds.';
  end if;

  perform public.advance_live_market();
  select price into v_price
  from public.live_market_state
  where id = true;
  if not found then
    raise exception 'The Live market is unavailable; no funds were reserved.';
  end if;

  select payout into v_payout
  from public.market_settings
  where id = true;
  if not found then
    raise exception 'The shared market payout setting is unavailable; no funds were reserved.';
  end if;
  if v_balance + round(p_stake * v_payout / 100, 2) > 999999999999.99 then
    raise exception 'This position could exceed the wallet balance limit if it wins.';
  end if;

  update public.wallet_accounts
  set balance_usd = balance_usd - p_stake,
      updated_at = now()
  where user_id = v_user_id
  returning balance_usd into v_balance;

  insert into public.wallet_trades (
    user_id, choice, stake_usd, payout_percent, entry_price, duration_seconds, expires_at
  )
  values (
    v_user_id, p_choice, p_stake, v_payout, v_price,
    p_duration_seconds, now() + make_interval(secs => p_duration_seconds)
  )
  returning id into v_trade_id;

  insert into public.wallet_trade_ledger (
    user_id, trade_id, entry_type, amount_delta_usd, balance_after_usd
  )
  values (v_user_id, v_trade_id, 'stake_reserved', -p_stake, v_balance);

  return v_trade_id;
end;
$$;

create or replace function public.get_wallet_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_balance numeric(14, 2);
  v_rate numeric(12, 4);
  v_transactions jsonb;
  v_wallet_trades jsonb;
  v_trade public.wallet_trades%rowtype;
  v_price numeric;
  v_final_digit smallint;
  v_won boolean;
  v_result numeric(14, 2);
  v_ledger_amount numeric(14, 2);
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into public.wallet_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select balance_usd into v_balance
  from public.wallet_accounts
  where user_id = v_user_id
  for update;

  v_price := public.advance_live_market();

  if v_price is null and exists (
    select 1 from public.wallet_trades
    where user_id = v_user_id and status = 'open' and expires_at <= now()
  ) then
    raise exception 'The Live market price is unavailable; expired wallet positions could not be settled.';
  end if;

  if v_price is not null then
    for v_trade in
      select * from public.wallet_trades
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
        when v_won then round(v_trade.stake_usd * v_trade.payout_percent / 100, 2)
        else -v_trade.stake_usd
      end;

      update public.wallet_trades
      set status = case when v_won then 'won' else 'lost' end,
          result_usd = v_result,
          final_price = v_price,
          final_digit = v_final_digit,
          settled_at = now()
      where id = v_trade.id;

      if v_won then
        v_ledger_amount := v_trade.stake_usd + v_result;
        update public.wallet_accounts
        set balance_usd = balance_usd + v_ledger_amount,
            updated_at = now()
        where user_id = v_user_id
        returning balance_usd into v_balance;

        insert into public.wallet_trade_ledger (
          user_id, trade_id, entry_type, amount_delta_usd, balance_after_usd
        )
        values (v_user_id, v_trade.id, 'win_payout', v_ledger_amount, v_balance);
      else
        insert into public.wallet_trade_ledger (
          user_id, trade_id, entry_type, amount_delta_usd, balance_after_usd
        )
        values (v_user_id, v_trade.id, 'loss_settlement', 0, v_balance);
      end if;
    end loop;
  end if;

  select usd_to_kes into v_rate
  from public.wallet_settings
  where id = true;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', transactions.id,
      'type', transactions.transaction_type,
      'amount', transactions.amount_usd,
      'fee', transactions.fee_usd,
      'payout', transactions.payout_usd,
      'status', transactions.status,
      'reference', transactions.reference_code,
      'instructions', transactions.payment_instructions,
      'destination', transactions.withdrawal_destination,
      'note', transactions.review_note,
      'time', floor(extract(epoch from transactions.created_at) * 1000),
      'reviewedAt', floor(extract(epoch from transactions.reviewed_at) * 1000)
    ) order by transactions.created_at desc),
    '[]'::jsonb
  )
  into v_transactions
  from (
    select * from public.wallet_transactions
    where user_id = v_user_id
    order by created_at desc
    limit 100
  ) as transactions;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', trades.id,
      'choice', trades.choice,
      'stake', trades.stake_usd,
      'payout', trades.payout_percent,
      'status', trades.status,
      'result', trades.result_usd,
      'time', floor(extract(epoch from trades.created_at) * 1000),
      'duration', trades.duration_seconds,
      'entryPrice', trades.entry_price,
      'finalPrice', trades.final_price,
      'finalDigit', trades.final_digit,
      'expiresAt', floor(extract(epoch from trades.expires_at) * 1000),
      'settledAt', floor(extract(epoch from trades.settled_at) * 1000)
    ) order by trades.created_at desc),
    '[]'::jsonb
  )
  into v_wallet_trades
  from (
    select * from public.wallet_trades
    where user_id = v_user_id
    order by created_at desc
    limit 100
  ) as trades;

  return jsonb_build_object(
    'balance', coalesce(v_balance, 0),
    'usdToKes', coalesce(v_rate, 128),
    'transactions', v_transactions,
    'walletTrades', v_wallet_trades
  );
end;
$$;

revoke all on function public.place_wallet_trade(text, numeric, integer) from public, anon;
revoke all on function public.get_wallet_snapshot() from public, anon;
revoke all on function public.get_live_market_snapshot() from public, anon;

grant execute on function public.place_wallet_trade(text, numeric, integer) to authenticated;
grant execute on function public.get_wallet_snapshot() to authenticated;
grant execute on function public.get_live_market_snapshot() to authenticated;
