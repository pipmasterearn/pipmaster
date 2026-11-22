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
  where user_id = v_user_id
  for update;

  if not found then
    insert into public.demo_accounts (user_id)
    values (v_user_id)
    on conflict (user_id) do nothing;
    select balance into v_balance
    from public.demo_accounts
    where user_id = v_user_id
    for update;
  end if;

  if v_balance = 0 and not exists (
    select 1 from public.demo_trades
    where user_id = v_user_id and status = 'open'
  ) then
    update public.demo_accounts
    set balance = 10000, updated_at = now()
    where user_id = v_user_id
    returning balance into v_balance;
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

revoke all on function public.get_terminal_snapshot() from public, anon;
grant execute on function public.get_terminal_snapshot() to authenticated;
