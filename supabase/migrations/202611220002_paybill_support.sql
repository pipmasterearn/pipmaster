alter table public.wallet_settings
  add column if not exists paybill_number text not null default '522533',
  add column if not exists paybill_account_number text not null default '8126239',
  add column if not exists paybill_account_name text not null default 'PIPMASTER';

update public.wallet_transactions as transactions
set payment_instructions = coalesce(transactions.payment_instructions, '{}'::jsonb)
  || jsonb_build_object(
    'paybillNumber', settings.paybill_number,
    'paybillAccountNumber', settings.paybill_account_number,
    'paybillAccountName', settings.paybill_account_name
  )
from public.wallet_settings as settings
where settings.id = true
  and transactions.transaction_type = 'deposit'
  and transactions.status = 'awaiting_payment'
  and transactions.payment_instructions ->> 'paybillNumber' is null;

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
  v_instructions jsonb;
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

  v_instructions := jsonb_build_object(
    'bankName', v_settings.bank_name,
    'accountName', v_settings.account_name,
    'accountNumber', v_settings.account_number,
    'branchName', v_settings.branch_name,
    'swiftCode', v_settings.swift_code,
    'instructions', v_settings.deposit_instructions,
    'usdToKes', v_settings.usd_to_kes,
    'paybillNumber', v_settings.paybill_number,
    'paybillAccountNumber', v_settings.paybill_account_number,
    'paybillAccountName', v_settings.paybill_account_name
  );

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
    v_instructions
  )
  returning id into v_transaction_id;

  return jsonb_build_object(
    'transactionId', v_transaction_id,
    'instructions', v_instructions
  );
end;
$$;

create or replace function public.update_wallet_settings_with_paybill(
  p_bank_name text,
  p_account_name text,
  p_account_number text,
  p_branch_name text,
  p_swift_code text,
  p_deposit_instructions text,
  p_usd_to_kes numeric,
  p_paybill_number text,
  p_paybill_account_number text,
  p_paybill_account_name text
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
  if nullif(btrim(p_paybill_number), '') is null
     or nullif(btrim(p_paybill_account_number), '') is null
     or nullif(btrim(p_paybill_account_name), '') is null then
    raise exception 'Paybill number, account number, and account name are required';
  end if;
  if length(coalesce(p_bank_name, '')) > 120
     or length(coalesce(p_account_name, '')) > 120
     or length(coalesce(p_account_number, '')) > 120
     or length(coalesce(p_branch_name, '')) > 120
     or length(coalesce(p_swift_code, '')) > 32
     or length(coalesce(p_deposit_instructions, '')) > 2000
     or length(p_paybill_number) > 120
     or length(p_paybill_account_number) > 120
     or length(p_paybill_account_name) > 120 then
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
      paybill_number = btrim(p_paybill_number),
      paybill_account_number = btrim(p_paybill_account_number),
      paybill_account_name = btrim(p_paybill_account_name),
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
      'usdToKes', v_settings.usd_to_kes,
      'paybillNumber', v_settings.paybill_number,
      'paybillAccountNumber', v_settings.paybill_account_number,
      'paybillAccountName', v_settings.paybill_account_name
    ),
    'requests', v_requests
  );
end;
$$;

revoke all on function public.update_wallet_settings_with_paybill(
  text, text, text, text, text, text, numeric, text, text, text
) from public, anon;
grant execute on function public.update_wallet_settings_with_paybill(
  text, text, text, text, text, text, numeric, text, text, text
) to authenticated;
