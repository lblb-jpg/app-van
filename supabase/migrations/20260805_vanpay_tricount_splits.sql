-- Migration VanPay / Tricount-style splits (run on existing Supabase projects)
alter table public.expenses add column if not exists split_type text not null default 'equal';
alter table public.expenses add column if not exists currency text not null default 'EUR';
alter table public.expenses add column if not exists notes text;

alter table public.expense_splits add column if not exists share_count numeric(8,2) not null default 1;
alter table public.expense_splits add column if not exists split_amount numeric(12,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'expenses_split_type_check'
  ) then
    alter table public.expenses
      add constraint expenses_split_type_check
      check (split_type in ('equal', 'shares', 'custom'));
  end if;
end $$;
