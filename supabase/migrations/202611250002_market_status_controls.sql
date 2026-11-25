create table if not exists public.market_control (
  id boolean primary key default true check (id),
  is_open boolean not null default true,
  notice text not null default '',
  updated_at timestamptz not null default now(),
  check (char_length(notice) <= 240)
);

insert into public.market_control (id, is_open, notice)
values (true, true, '')
on conflict (id) do nothing;

alter table public.market_control enable row level security;
revoke all on public.market_control from public, anon, authenticated;

create or replace function public.get_market_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.market_control%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_status
  from public.market_control
  where id = true;

  if not found then
    raise exception 'Market status is not configured';
  end if;

  return jsonb_build_object(
    'isOpen', v_status.is_open,
    'notice', v_status.notice,
    'updatedAt', v_status.updated_at
  );
end;
$$;

create or replace function public.set_market_status(
  p_is_open boolean,
  p_notice text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Administrator access required';
  end if;

  if p_is_open is null
     or char_length(coalesce(p_notice, '')) > 240 then
    raise exception 'Invalid market status or maintenance notice';
  end if;

  update public.market_control
  set is_open = p_is_open,
      notice = btrim(coalesce(p_notice, '')),
      updated_at = now()
  where id = true;

  if not found then
    raise exception 'Market status is not configured';
  end if;
end;
$$;

create or replace function public.reject_positions_when_market_suspended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_open boolean;
  v_notice text;
begin
  select is_open, notice into v_is_open, v_notice
  from public.market_control
  where id = true
  for share;

  if not found or not v_is_open then
    raise exception 'Market is suspended: %',
      coalesce(nullif(v_notice, ''), 'new positions are unavailable');
  end if;

  return new;
end;
$$;

drop trigger if exists demo_trades_market_open_guard on public.demo_trades;
create trigger demo_trades_market_open_guard
  before insert on public.demo_trades
  for each row execute function public.reject_positions_when_market_suspended();

drop trigger if exists wallet_trades_market_open_guard on public.wallet_trades;
create trigger wallet_trades_market_open_guard
  before insert on public.wallet_trades
  for each row execute function public.reject_positions_when_market_suspended();

revoke all on function public.get_market_status() from public, anon;
revoke all on function public.set_market_status(boolean, text) from public, anon;
revoke all on function public.reject_positions_when_market_suspended() from public, anon, authenticated;

grant execute on function public.get_market_status() to authenticated;
grant execute on function public.set_market_status(boolean, text) to authenticated;
