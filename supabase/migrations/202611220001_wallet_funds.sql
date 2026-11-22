create table if not exists public.wallet_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance_usd numeric(14, 2) not null default 0 check (balance_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.wallet_accounts (user_id)
select user_id from public.profiles
on conflict (user_id) do nothing;

create table if not exists public.wallet_settings (
  id boolean primary key default true check (id),
  bank_name text not null default '',
  account_name text not null default '',
  account_number text not null default '',
  branch_name text not null default '',
  swift_code text not null default '',
  deposit_instructions text not null default '',
  usd_to_kes numeric(12, 4) not null default 128 check (usd_to_kes between 1 and 100000),
  updated_at timestamptz not null default now()
);

insert into public.wallet_settings (id) values (true)
on conflict (id) do nothing;

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  transaction_type text not null check (transaction_type in ('deposit', 'withdrawal')),
  amount_usd numeric(14, 2) not null check (amount_usd > 0),
  fee_usd numeric(14, 2) not null default 0 check (fee_usd >= 0),
  payout_usd numeric(14, 2) not null default 0 check (payout_usd >= 0),
  status text not null default 'pending' check (status in ('awaiting_payment', 'pending', 'confirmed', 'rejected')),
  reference_code text,
  payment_instructions jsonb,
  withdrawal_destination jsonb,
  review_note text not null default '',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fee_usd <= amount_usd),
  check (payout_usd <= amount_usd)
);

create unique index if not exists wallet_transactions_reference_unique
  on public.wallet_transactions (lower(reference_code))
  where reference_code is not null;

create index if not exists wallet_transactions_user_created
  on public.wallet_transactions (user_id, created_at desc);
create index if not exists wallet_transactions_pending
  on public.wallet_transactions (created_at)
  where status = 'pending';

create table if not exists public.wallet_ledger_entries (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete restrict,
  transaction_id uuid not null references public.wallet_transactions (id) on delete restrict,
  entry_type text not null check (entry_type in (
    'deposit_credit',
    'deposit_rejected',
    'withdrawal_reserved',
    'withdrawal_paid',
    'withdrawal_released'
  )),
  amount_delta_usd numeric(14, 2) not null,
  balance_after_usd numeric(14, 2) not null check (balance_after_usd >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists wallet_ledger_user_created
  on public.wallet_ledger_entries (user_id, created_at desc);

alter table public.wallet_accounts enable row level security;
alter table public.wallet_settings enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.wallet_ledger_entries enable row level security;

revoke all on public.wallet_accounts, public.wallet_settings,
  public.wallet_transactions, public.wallet_ledger_entries from anon, authenticated;
grant select on public.wallet_accounts, public.wallet_transactions,
  public.wallet_ledger_entries to authenticated;

drop policy if exists "Users can read their wallet account" on public.wallet_accounts;
create policy "Users can read their wallet account"
  on public.wallet_accounts for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their wallet transactions" on public.wallet_transactions;
create policy "Users can read their wallet transactions"
  on public.wallet_transactions for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their wallet ledger" on public.wallet_ledger_entries;
create policy "Users can read their wallet ledger"
  on public.wallet_ledger_entries for select to authenticated
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

  insert into public.wallet_accounts (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
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
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into public.wallet_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select balance_usd into v_balance
  from public.wallet_accounts
  where user_id = v_user_id;

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

  return jsonb_build_object(
    'balance', coalesce(v_balance, 0),
    'usdToKes', coalesce(v_rate, 128),
    'transactions', v_transactions
  );
end;
$$;

create or replace function public.request_wallet_deposit(
  p_amount_usd numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_settings public.wallet_settings%rowtype;
  v_transaction_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_amount_usd is null or p_amount_usd < 2 or p_amount_usd > 7692
     or p_amount_usd <> round(p_amount_usd, 2) then
    raise exception 'Deposits must be between $2.00 and $7,692.00';
  end if;
  select * into v_settings
  from public.wallet_settings
  where id = true;
  if btrim(v_settings.bank_name) = ''
     or btrim(v_settings.account_name) = ''
     or btrim(v_settings.account_number) = ''
     or btrim(v_settings.deposit_instructions) = '' then
    raise exception 'Deposit instructions are not available yet';
  end if;

  insert into public.wallet_transactions (
    user_id,
    transaction_type,
    amount_usd,
    status,
    payout_usd,
    payment_instructions
  )
  values (
    v_user_id,
    'deposit',
    p_amount_usd,
    'awaiting_payment',
    p_amount_usd,
    jsonb_build_object(
      'bankName', v_settings.bank_name,
      'accountName', v_settings.account_name,
      'accountNumber', v_settings.account_number,
      'branchName', v_settings.branch_name,
      'swiftCode', v_settings.swift_code,
      'instructions', v_settings.deposit_instructions,
      'usdToKes', v_settings.usd_to_kes
    )
  )
  returning id into v_transaction_id;

  return jsonb_build_object(
    'transactionId', v_transaction_id,
    'instructions', jsonb_build_object(
      'bankName', v_settings.bank_name,
      'accountName', v_settings.account_name,
      'accountNumber', v_settings.account_number,
      'branchName', v_settings.branch_name,
      'swiftCode', v_settings.swift_code,
      'instructions', v_settings.deposit_instructions,
      'usdToKes', v_settings.usd_to_kes
    )
  );
end;
$$;

create or replace function public.submit_wallet_deposit_reference(
  p_transaction_id uuid,
  p_reference_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_reference text := nullif(btrim(p_reference_code), '');
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_transaction_id is null or v_reference is null or length(v_reference) > 120 then
    raise exception 'Enter the transaction reference from your bank transfer';
  end if;

  update public.wallet_transactions
  set reference_code = v_reference,
      status = 'pending',
      updated_at = now()
  where id = p_transaction_id
    and user_id = v_user_id
    and transaction_type = 'deposit'
    and status = 'awaiting_payment';

  if not found then
    raise exception 'Deposit request is no longer waiting for a payment reference';
  end if;
end;
$$;

create or replace function public.request_wallet_withdrawal(
  p_amount_usd numeric,
  p_bank_name text,
  p_account_name text,
  p_account_number text,
  p_branch_name text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_balance numeric(14, 2);
  v_fee numeric(14, 2);
  v_payout numeric(14, 2);
  v_transaction_id uuid;
  v_weekday integer;
  v_local_time time;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_amount_usd is null or p_amount_usd < 5
     or p_amount_usd <> round(p_amount_usd, 2) then
    raise exception 'The minimum withdrawal is $5.00';
  end if;
  if nullif(btrim(p_bank_name), '') is null
     or nullif(btrim(p_account_name), '') is null
     or nullif(btrim(p_account_number), '') is null
     or length(p_bank_name) > 120
     or length(p_account_name) > 120
     or length(p_account_number) > 120
     or length(coalesce(p_branch_name, '')) > 120 then
    raise exception 'Enter valid bank, account holder, and account number details';
  end if;

  v_weekday := extract(isodow from (now() at time zone 'Africa/Nairobi'))::integer;
  v_local_time := (now() at time zone 'Africa/Nairobi')::time;
  if v_weekday in (6, 7)
     and (v_local_time < time '09:00' or v_local_time >= time '13:00') then
    raise exception 'Weekend withdrawal requests are available from 9:00 AM to 1:00 PM EAT';
  end if;

  insert into public.wallet_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select balance_usd into v_balance
  from public.wallet_accounts
  where user_id = v_user_id
  for update;

  if p_amount_usd > v_balance then
    raise exception 'Withdrawal amount exceeds your available balance';
  end if;

  v_fee := round(p_amount_usd * 0.0768, 2);
  v_payout := p_amount_usd - v_fee;
  if v_payout <= 0 then
    raise exception 'Withdrawal amount after fee must be greater than zero';
  end if;

  update public.wallet_accounts
  set balance_usd = balance_usd - p_amount_usd,
      updated_at = now()
  where user_id = v_user_id
  returning balance_usd into v_balance;

  insert into public.wallet_transactions (
    user_id,
    transaction_type,
    amount_usd,
    fee_usd,
    payout_usd,
    withdrawal_destination
  )
  values (
    v_user_id,
    'withdrawal',
    p_amount_usd,
    v_fee,
    v_payout,
    jsonb_build_object(
      'bankName', btrim(p_bank_name),
      'accountName', btrim(p_account_name),
      'accountNumber', btrim(p_account_number),
      'branchName', btrim(coalesce(p_branch_name, ''))
    )
  )
  returning id into v_transaction_id;

  insert into public.wallet_ledger_entries (
    user_id, transaction_id, entry_type, amount_delta_usd, balance_after_usd, created_by
  )
  values (
    v_user_id, v_transaction_id, 'withdrawal_reserved', -p_amount_usd, v_balance, v_user_id
  );

  return v_transaction_id;
end;
$$;

create or replace function public.update_wallet_settings(
  p_bank_name text,
  p_account_name text,
  p_account_number text,
  p_branch_name text,
  p_swift_code text,
  p_deposit_instructions text,
  p_usd_to_kes numeric
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
  if p_usd_to_kes is null or p_usd_to_kes < 1 or p_usd_to_kes > 100000 then
    raise exception 'Exchange rate must be between 1 and 100,000 KSh per USD';
  end if;
  if length(coalesce(p_bank_name, '')) > 120
     or length(coalesce(p_account_name, '')) > 120
     or length(coalesce(p_account_number, '')) > 120
     or length(coalesce(p_branch_name, '')) > 120
     or length(coalesce(p_swift_code, '')) > 32
     or length(coalesce(p_deposit_instructions, '')) > 2000 then
    raise exception 'Payment settings exceed the allowed field length';
  end if;

  update public.wallet_settings
  set bank_name = btrim(coalesce(p_bank_name, '')),
      account_name = btrim(coalesce(p_account_name, '')),
      account_number = btrim(coalesce(p_account_number, '')),
      branch_name = btrim(coalesce(p_branch_name, '')),
      swift_code = btrim(coalesce(p_swift_code, '')),
      deposit_instructions = btrim(coalesce(p_deposit_instructions, '')),
      usd_to_kes = p_usd_to_kes,
      updated_at = now()
  where id = true;
end;
$$;

create or replace function public.get_wallet_admin_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.wallet_settings%rowtype;
  v_requests jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'admin'
  ) then
    raise exception 'Administrator access required';
  end if;

  select * into v_settings from public.wallet_settings where id = true;
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'id', requests.id,
      'userId', requests.user_id,
      'email', users.email,
      'fullName', profiles.full_name,
      'type', requests.transaction_type,
      'amount', requests.amount_usd,
      'fee', requests.fee_usd,
      'payout', requests.payout_usd,
      'reference', requests.reference_code,
      'destination', requests.withdrawal_destination,
      'instructions', requests.payment_instructions,
      'time', floor(extract(epoch from requests.created_at) * 1000)
    ) order by requests.created_at),
    '[]'::jsonb
  )
  into v_requests
  from public.wallet_transactions as requests
  join auth.users as users on users.id = requests.user_id
  left join public.profiles as profiles on profiles.user_id = requests.user_id
  where requests.status = 'pending';

  return jsonb_build_object(
    'settings', jsonb_build_object(
      'bankName', v_settings.bank_name,
      'accountName', v_settings.account_name,
      'accountNumber', v_settings.account_number,
      'branchName', v_settings.branch_name,
      'swiftCode', v_settings.swift_code,
      'depositInstructions', v_settings.deposit_instructions,
      'usdToKes', v_settings.usd_to_kes
    ),
    'requests', v_requests
  );
end;
$$;

create or replace function public.review_wallet_transaction(
  p_transaction_id uuid,
  p_approve boolean,
  p_review_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_transaction public.wallet_transactions%rowtype;
  v_balance numeric(14, 2);
  v_note text := left(btrim(coalesce(p_review_note, '')), 500);
begin
  if not exists (
    select 1 from public.profiles
    where user_id = v_user_id and role = 'admin'
  ) then
    raise exception 'Administrator access required';
  end if;
  if p_transaction_id is null or p_approve is null then
    raise exception 'A transaction and decision are required';
  end if;

  select * into v_transaction
  from public.wallet_transactions
  where id = p_transaction_id
  for update;
  if not found or v_transaction.status <> 'pending' then
    raise exception 'This wallet request is no longer pending';
  end if;

  select balance_usd into v_balance
  from public.wallet_accounts
  where user_id = v_transaction.user_id
  for update;
  if not found then
    raise exception 'Wallet account was not found';
  end if;

  if v_transaction.transaction_type = 'deposit' then
    if p_approve then
      update public.wallet_accounts
      set balance_usd = balance_usd + v_transaction.amount_usd,
          updated_at = now()
      where user_id = v_transaction.user_id
      returning balance_usd into v_balance;

      insert into public.wallet_ledger_entries (
        user_id, transaction_id, entry_type, amount_delta_usd, balance_after_usd, created_by
      )
      values (
        v_transaction.user_id, v_transaction.id, 'deposit_credit',
        v_transaction.amount_usd, v_balance, v_user_id
      );
    else
      insert into public.wallet_ledger_entries (
        user_id, transaction_id, entry_type, amount_delta_usd, balance_after_usd, created_by
      )
      values (
        v_transaction.user_id, v_transaction.id, 'deposit_rejected', 0, v_balance, v_user_id
      );
    end if;
  elsif p_approve then
    insert into public.wallet_ledger_entries (
      user_id, transaction_id, entry_type, amount_delta_usd, balance_after_usd, created_by
    )
    values (
      v_transaction.user_id, v_transaction.id, 'withdrawal_paid', 0, v_balance, v_user_id
    );
  else
    update public.wallet_accounts
    set balance_usd = balance_usd + v_transaction.amount_usd,
        updated_at = now()
    where user_id = v_transaction.user_id
    returning balance_usd into v_balance;

    insert into public.wallet_ledger_entries (
      user_id, transaction_id, entry_type, amount_delta_usd, balance_after_usd, created_by
    )
    values (
      v_transaction.user_id, v_transaction.id, 'withdrawal_released',
      v_transaction.amount_usd, v_balance, v_user_id
    );
  end if;

  update public.wallet_transactions
  set status = case when p_approve then 'confirmed' else 'rejected' end,
      review_note = v_note,
      reviewed_by = v_user_id,
      reviewed_at = now(),
      updated_at = now()
  where id = v_transaction.id;
end;
$$;

revoke all on function public.get_wallet_snapshot() from public, anon;
revoke all on function public.request_wallet_deposit(numeric) from public, anon;
revoke all on function public.submit_wallet_deposit_reference(uuid, text) from public, anon;
revoke all on function public.request_wallet_withdrawal(numeric, text, text, text, text) from public, anon;
revoke all on function public.update_wallet_settings(text, text, text, text, text, text, numeric) from public, anon;
revoke all on function public.get_wallet_admin_snapshot() from public, anon;
revoke all on function public.review_wallet_transaction(uuid, boolean, text) from public, anon;

grant execute on function public.get_wallet_snapshot() to authenticated;
grant execute on function public.request_wallet_deposit(numeric) to authenticated;
grant execute on function public.submit_wallet_deposit_reference(uuid, text) to authenticated;
grant execute on function public.request_wallet_withdrawal(numeric, text, text, text, text) to authenticated;
grant execute on function public.update_wallet_settings(text, text, text, text, text, text, numeric) to authenticated;
grant execute on function public.get_wallet_admin_snapshot() to authenticated;
grant execute on function public.review_wallet_transaction(uuid, boolean, text) to authenticated;
