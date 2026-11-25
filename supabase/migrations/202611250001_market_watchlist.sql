create table if not exists public.market_watchlist (
  user_id uuid not null references auth.users (id) on delete cascade,
  market_symbol text not null check (market_symbol = 'PIPMASTER'),
  created_at timestamptz not null default now(),
  primary key (user_id, market_symbol)
);

alter table public.market_watchlist enable row level security;
revoke all on public.market_watchlist from public, anon, authenticated;
grant select, insert, delete on public.market_watchlist to authenticated;

create policy "Users can read their own market watchlist"
  on public.market_watchlist for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can add markets to their own watchlist"
  on public.market_watchlist for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can remove markets from their own watchlist"
  on public.market_watchlist for delete to authenticated
  using ((select auth.uid()) = user_id);
