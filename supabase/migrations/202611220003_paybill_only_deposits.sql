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
  v_has_bank_transfer boolean;
  v_has_paybill boolean;
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

  v_has_bank_transfer :=
    nullif(btrim(coalesce(v_settings.bank_name, '')), '') is not null
    and nullif(btrim(coalesce(v_settings.account_name, '')), '') is not null
    and nullif(btrim(coalesce(v_settings.account_number, '')), '') is not null
    and nullif(btrim(coalesce(v_settings.deposit_instructions, '')), '') is not null;
  v_has_paybill :=
    nullif(btrim(coalesce(v_settings.paybill_number, '')), '') is not null
    and nullif(btrim(coalesce(v_settings.paybill_account_number, '')), '') is not null
    and nullif(btrim(coalesce(v_settings.paybill_account_name, '')), '') is not null;

  if not v_has_bank_transfer and not v_has_paybill then
    raise exception 'Deposit instructions are not available yet. Ask the administrator to configure Paybill or bank transfer details.';
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

revoke all on function public.request_wallet_deposit(numeric) from public, anon;
grant execute on function public.request_wallet_deposit(numeric) to authenticated;
