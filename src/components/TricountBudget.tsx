import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import confetti from 'canvas-confetti';
import {
  Receipt,
  Plus,
  ArrowRightLeft,
  CheckCircle2,
  X,
  Users,
  Wallet,
} from 'lucide-react';
import { Expense, ExpenseCategory, Friend, DebtSettlement } from '../types';
import { StepFormModal } from './StepFormModal';

const ADD_EXPENSE_STEPS = [
  { id: 1, label: 'Montant', hint: 'Nom et prix' },
  { id: 2, label: 'Partage', hint: 'Qui paie et partage' },
] as const;

interface TricountBudgetProps {
  expenses: Expense[];
  friends: Friend[];
  currentFriendId: string;
  onAddExpense: (newExpense: Omit<Expense, 'id'>) => void;
  onDeleteExpense: (id: string) => void;
}

const CATEGORIES: { id: ExpenseCategory; label: string; emoji: string }[] = [
  { id: 'carburant', label: 'Carburant', emoji: '⛽' },
  { id: 'peage', label: 'Péage', emoji: '🛣️' },
  { id: 'courses', label: 'Courses', emoji: '🛒' },
  { id: 'resto', label: 'Resto', emoji: '🍽️' },
  { id: 'activite', label: 'Activité', emoji: '🏄' },
  { id: 'autre', label: 'Autre', emoji: '📦' },
];

const SETTLEMENT_PREFIX = '[RÈGLEMENT]';

function parseEuroAmount(raw: string) {
  const normalized = raw.replace(/\s/g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : NaN;
}

function euro(value: number) {
  return `${value.toFixed(2)} €`;
}

function computeBalances(expenses: Expense[], friendIds: string[]): Record<string, number> {
  const netBalances: Record<string, number> = {};
  friendIds.forEach((id) => {
    netBalances[id] = 0;
  });

  expenses.forEach((exp) => {
    const payer = exp.paidByFriendId;
    const beneficiaries =
      exp.splitAmongFriendIds && exp.splitAmongFriendIds.length > 0
        ? exp.splitAmongFriendIds
        : friendIds;
    if (!beneficiaries.length) return;

    const splitAmount = exp.amount / beneficiaries.length;
    netBalances[payer] = (netBalances[payer] || 0) + exp.amount;
    beneficiaries.forEach((bId) => {
      netBalances[bId] = (netBalances[bId] || 0) - splitAmount;
    });
  });

  return netBalances;
}

function computeSettlements(balances: Record<string, number>): DebtSettlement[] {
  const debtors: { id: string; amount: number }[] = [];
  const creditors: { id: string; amount: number }[] = [];

  Object.entries(balances).forEach(([id, bal]) => {
    if (bal < -0.01) debtors.push({ id, amount: -bal });
    else if (bal > 0.01) creditors.push({ id, amount: bal });
  });

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const settlements: DebtSettlement[] = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amountToSettle = Math.min(debtor.amount, creditor.amount);

    if (amountToSettle > 0.01) {
      settlements.push({
        fromFriendId: debtor.id,
        toFriendId: creditor.id,
        amount: Number(amountToSettle.toFixed(2)),
      });
    }

    debtor.amount -= amountToSettle;
    creditor.amount -= amountToSettle;
    if (debtor.amount < 0.01) i++;
    if (creditor.amount < 0.01) j++;
  }

  return settlements;
}

function computePersonStats(expenses: Expense[], friends: Friend[]) {
  const friendIds = friends.map((f) => f.id);
  return friends.map((friend) => {
    let paid = 0;
    let share = 0;
    let expenseCount = 0;

    expenses.forEach((exp) => {
      const beneficiaries =
        exp.splitAmongFriendIds && exp.splitAmongFriendIds.length > 0
          ? exp.splitAmongFriendIds
          : friendIds;
      if (exp.paidByFriendId === friend.id) {
        paid += exp.amount;
        expenseCount += 1;
      }
      if (beneficiaries.includes(friend.id) && beneficiaries.length > 0) {
        share += exp.amount / beneficiaries.length;
      }
    });

    return {
      friend,
      paid: Number(paid.toFixed(2)),
      share: Number(share.toFixed(2)),
      expenseCount,
      balance: Number((paid - share).toFixed(2)),
    };
  });
}

export const TricountBudget: React.FC<TricountBudgetProps> = ({
  expenses,
  friends,
  currentFriendId,
  onAddExpense,
  onDeleteExpense,
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('courses');
  const [paidBy, setPaidBy] = useState(currentFriendId);
  const [splitWith, setSplitWith] = useState<string[]>(() => friends.map((f) => f.id));
  const [formError, setFormError] = useState('');
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);
  const [addStep, setAddStep] = useState(1);

  const openAddModal = () => {
    const ids = friends.map((f) => f.id);
    setDesc('');
    setAmount('');
    setCategory('courses');
    setPaidBy(ids.includes(currentFriendId) ? currentFriendId : ids[0] || '');
    setSplitWith(ids.length ? ids : []);
    setFormError('');
    setAddStep(1);
    setShowAddModal(true);
  };

  useEffect(() => {
    if (!showAddModal) return;
    const ids = friends.map((f) => f.id);
    if (!ids.length) return;
    setPaidBy((prev) => (ids.includes(prev) ? prev : currentFriendId));
    setSplitWith((prev) => {
      const kept = prev.filter((id) => ids.includes(id));
      return kept.length ? kept : ids;
    });
  }, [friends, currentFriendId, showAddModal]);

  const modalOpen = showAddModal || Boolean(expenseToDelete);

  useEffect(() => {
    if (!modalOpen) return;

    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const scrollY = window.scrollY;
    const previous = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      rootOverflow: root?.style.overflow ?? '',
    };

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    if (root) root.style.overflow = 'hidden';

    const preventBackgroundScroll = (event: TouchEvent | WheelEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-modal-scroll]')) return;
      event.preventDefault();
    };

    document.addEventListener('touchmove', preventBackgroundScroll, { passive: false });
    document.addEventListener('wheel', preventBackgroundScroll, { passive: false });

    return () => {
      document.removeEventListener('touchmove', preventBackgroundScroll);
      document.removeEventListener('wheel', preventBackgroundScroll);
      html.style.overflow = previous.htmlOverflow;
      body.style.overflow = previous.bodyOverflow;
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.left = previous.bodyLeft;
      body.style.right = previous.bodyRight;
      body.style.width = previous.bodyWidth;
      if (root) root.style.overflow = previous.rootOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [modalOpen]);

  const friendIds = useMemo(() => friends.map((f) => f.id), [friends]);
  const friendById = useMemo(
    () => Object.fromEntries(friends.map((f) => [f.id, f])) as Record<string, Friend>,
    [friends]
  );

  const parsedAmount = useMemo(() => parseEuroAmount(amount), [amount]);
  const shareCount = Math.max(1, splitWith.length);
  const sharePerPerson =
    Number.isFinite(parsedAmount) && parsedAmount > 0
      ? Number((parsedAmount / shareCount).toFixed(2))
      : 0;
  const hasDraftAmount =
    Number.isFinite(parsedAmount) && parsedAmount > 0 && splitWith.length > 0 && Boolean(paidBy);

  const settlementExpenses = expenses.filter((expense) =>
    expense.description.startsWith(SETTLEMENT_PREFIX)
  );
  const recentSettlementExpenses = settlementExpenses.slice(0, 3);
  const regularExpenses = expenses.filter(
    (expense) => !expense.description.startsWith(SETTLEMENT_PREFIX)
  );
  const totalSpent = regularExpenses.reduce((acc, curr) => acc + curr.amount, 0);
  const totalPerPerson = friends.length > 0 ? totalSpent / friends.length : 0;

  const netBalances = useMemo(() => computeBalances(expenses, friendIds), [expenses, friendIds]);
  const settlements = useMemo(() => computeSettlements(netBalances), [netBalances]);
  const personStats = useMemo(
    () => computePersonStats(regularExpenses, friends),
    [regularExpenses, friends]
  );

  const draftExpenseDebts = useMemo(() => {
    if (!hasDraftAmount) return [] as { fromId: string; toId: string; amount: number }[];
    const share = Number((parsedAmount / splitWith.length).toFixed(2));
    return splitWith
      .filter((id) => id !== paidBy)
      .map((fromId) => ({ fromId, toId: paidBy, amount: share }));
  }, [hasDraftAmount, parsedAmount, splitWith, paidBy]);

  const draftAfterSettlements = useMemo(() => {
    if (!hasDraftAmount) return null as DebtSettlement[] | null;
    const draft: Expense = {
      id: '__draft__',
      description: desc.trim() || 'Nouvelle dépense',
      amount: Number(parsedAmount.toFixed(2)),
      category,
      date: new Date().toISOString().split('T')[0],
      paidByFriendId: paidBy,
      splitAmongFriendIds: splitWith,
    };
    return computeSettlements(computeBalances([...expenses, draft], friendIds));
  }, [hasDraftAmount, parsedAmount, desc, category, paidBy, splitWith, expenses, friendIds]);

  const payerName = friendById[paidBy]?.name || 'Équipier';

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!desc.trim()) {
      setFormError('Donne un nom à la dépense.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError('Indique un prix valide (ex: 42,50).');
      return;
    }
    if (!paidBy) {
      setFormError('Choisis qui a payé.');
      return;
    }
    if (!splitWith.length) {
      setFormError('Sélectionne au moins une personne pour le partage.');
      return;
    }

    onAddExpense({
      description: desc.trim(),
      amount: Number(parsedAmount.toFixed(2)),
      category,
      date: new Date().toISOString().split('T')[0],
      paidByFriendId: paidBy,
      splitAmongFriendIds: splitWith,
    });

    setDesc('');
    setAmount('');
    setAddStep(1);
    setShowAddModal(false);
  };

  const canAdvanceExpenseStep = (step: number) => {
    if (step === 1) return Boolean(desc.trim()) && Number.isFinite(parsedAmount) && parsedAmount > 0;
    if (step === 2) return Boolean(paidBy) && splitWith.length > 0;
    return true;
  };

  const toggleSplitFriend = (fId: string) => {
    if (splitWith.includes(fId)) {
      if (splitWith.length > 1) setSplitWith(splitWith.filter((id) => id !== fId));
    } else {
      setSplitWith([...splitWith, fId]);
    }
  };

  const markSettlementPaid = (settlement: DebtSettlement, celebrate = true) => {
    const debtor = friends.find((friend) => friend.id === settlement.fromFriendId);
    const creditor = friends.find((friend) => friend.id === settlement.toFriendId);
    onAddExpense({
      description: `${SETTLEMENT_PREFIX} ${debtor?.name || 'Équipier'} → ${creditor?.name || 'Équipier'}`,
      amount: settlement.amount,
      category: 'autre',
      date: new Date().toISOString().split('T')[0],
      paidByFriendId: settlement.fromFriendId,
      splitAmongFriendIds: [settlement.toFriendId],
    });
    if (celebrate) confetti({ particleCount: 55, spread: 55, origin: { y: 0.7 } });
  };

  const handleSettleUpConfetti = () => {
    settlements.forEach((settlement) => markSettlementPaid(settlement, false));
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  };

  const displayName = (id: string) =>
    id === currentFriendId ? 'Moi' : friendById[id]?.name || 'Équipier';

  return (
    <div className="page-pad space-y-3 sm:space-y-4">
      <div className="bg-zinc-900 text-white rounded-[1.75rem] p-4 shadow-xs relative overflow-hidden sm:rounded-[2rem] sm:p-6">
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl" />

        <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 mb-2">
          <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1 font-mono">
            <Receipt className="w-4 h-4 shrink-0" /> VanPay
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openAddModal();
            }}
            className="relative z-10 min-h-10 px-3.5 py-2 rounded-2xl bg-white hover:bg-zinc-100 text-zinc-900 font-extrabold text-xs shadow-xs transition-all flex items-center gap-1"
          >
            <Plus className="w-4 h-4 text-emerald-600" /> Dépense
          </button>
        </div>

        <div className="my-2 relative z-10">
          <div className="text-3xl sm:text-4xl font-black font-mono tabular-nums">
            {totalSpent.toFixed(2)}{' '}
            <span className="text-lg sm:text-xl font-bold text-zinc-400">€</span>
          </div>
          <p className="text-xs text-zinc-400 font-medium mt-1">Total dépenses du van</p>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-zinc-800 relative z-10">
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
              Moyenne / pers.
            </span>
            <p className="text-sm font-extrabold text-emerald-400 font-mono tabular-nums">
              {totalPerPerson.toFixed(2)} €
            </p>
          </div>
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">
              Équipiers
            </span>
            <p className="text-sm font-extrabold text-white font-mono">{friends.length}</p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-[1.75rem] p-4 shadow-xs space-y-3 sm:rounded-[2rem] sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <h3 className="min-w-0 font-extrabold text-sm text-zinc-900 flex items-start gap-2 leading-snug">
            <ArrowRightLeft className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
            <span>Qui doit combien à qui</span>
          </h3>
          {settlements.length > 0 && (
            <button
              type="button"
              onClick={handleSettleUpConfetti}
              className="self-start shrink-0 touch-chip text-[10px] font-extrabold px-3 py-2 rounded-full bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100 transition-colors"
            >
              ✓ Tout marquer payé
            </button>
          )}
        </div>

        {settlements.length === 0 ? (
          <div className="py-4 text-center text-zinc-600 text-xs bg-emerald-50/60 rounded-2xl border border-emerald-100 font-medium">
            ✅ Tout le monde est à jour ! Aucune dette en cours.
          </div>
        ) : (
          <div className="space-y-2">
            {settlements.map((st, idx) => {
              const debtor = friendById[st.fromFriendId];
              const creditor = friendById[st.toFriendId];

              return (
                <div key={idx} className="p-3 rounded-2xl bg-zinc-50 border border-zinc-200">
                  <p className="mb-2 text-[11px] font-semibold leading-snug text-zinc-600">
                    <strong className="text-zinc-900">{displayName(st.fromFriendId)}</strong> doit{' '}
                    <strong className="font-mono text-emerald-700">{euro(st.amount)}</strong> à{' '}
                    <strong className="text-zinc-900">{displayName(st.toFriendId)}</strong>
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                      <img
                        src={debtor?.avatar}
                        alt={debtor?.name}
                        className="w-7 h-7 shrink-0 rounded-full object-cover ring-2 ring-white"
                      />
                      <span className="truncate text-xs font-bold text-zinc-800">
                        {displayName(st.fromFriendId)}
                      </span>
                      <span className="shrink-0 text-[10px] text-zinc-400 font-medium">→</span>
                      <img
                        src={creditor?.avatar}
                        alt={creditor?.name}
                        className="w-7 h-7 shrink-0 rounded-full object-cover ring-2 ring-white"
                      />
                      <span className="truncate text-xs font-bold text-zinc-800">
                        {displayName(st.toFriendId)}
                      </span>
                    </div>
                    <span className="shrink-0 text-sm font-black font-mono px-2.5 py-1 rounded-xl border shadow-xs text-emerald-700 bg-white border-zinc-200 tabular-nums">
                      {euro(st.amount)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => markSettlementPaid(st)}
                    className="mt-2.5 flex w-full min-h-10 items-center justify-center gap-1.5 rounded-xl bg-zinc-900 py-2.5 text-[10px] font-extrabold text-white transition-all hover:bg-zinc-800"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span className="truncate">{displayName(st.fromFriendId)} a payé</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {settlementExpenses.length > 0 && (
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-[1.75rem] p-4 shadow-xs space-y-3 sm:rounded-[2rem] sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="min-w-0 font-extrabold text-sm text-emerald-950 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" /> Paiements effectués
            </h3>
            <span className="shrink-0 text-[10px] font-bold text-emerald-700 bg-white/70 px-2.5 py-1 rounded-full ring-1 ring-emerald-200">
              {settlementExpenses.length > 3
                ? '3 dernières'
                : `${settlementExpenses.length} réglé(s)`}
            </span>
          </div>
          <div className="space-y-2">
            {recentSettlementExpenses.map((payment) => {
              const debtor = friends.find((friend) => friend.id === payment.paidByFriendId);
              const creditor = friends.find(
                (friend) => friend.id === payment.splitAmongFriendIds[0]
              );
              return (
                <div
                  key={payment.id}
                  className="rounded-2xl border border-emerald-200 bg-white/75 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-emerald-950 truncate">
                        {debtor?.name || 'Équipier'} → {creditor?.name || 'équipier'}
                      </p>
                      <p className="mt-0.5 text-[10px] font-semibold text-emerald-700">
                        Payé le {payment.date}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-sm font-black font-mono text-emerald-700 line-through decoration-2 tabular-nums">
                      {euro(payment.amount)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onDeleteExpense(payment.id)}
                    className="mt-2 min-h-9 text-[10px] font-bold text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-red-600"
                  >
                    Annuler ce paiement
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white border border-zinc-200 rounded-[1.75rem] p-4 shadow-xs space-y-3 sm:rounded-[2rem] sm:p-5">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-emerald-600" />
          <h4 className="font-extrabold text-sm text-zinc-900">Dépenses par personne</h4>
        </div>
        <p className="text-[11px] font-medium text-zinc-500 leading-snug">
          Payé = avancé · Part = quote-part · Solde = à recevoir (+) ou à rembourser (−)
        </p>
        <div className="space-y-2">
          {personStats.map(({ friend, paid, share, expenseCount, balance }) => {
            const isPositive = balance >= -0.005;
            return (
              <div
                key={friend.id}
                className="rounded-2xl border border-zinc-100 bg-zinc-50 p-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <img
                      src={friend.avatar}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-full object-cover ring-2 ring-white"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-extrabold text-zinc-900">
                        {friend.id === currentFriendId ? `Moi (${friend.name})` : friend.name}
                      </p>
                      <p className="text-[10px] font-semibold text-zinc-400">
                        {expenseCount} paiement{expenseCount > 1 ? 's' : ''} avancé
                        {expenseCount > 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`shrink-0 rounded-xl px-2.5 py-1 text-[11px] font-black font-mono tabular-nums ${
                      isPositive
                        ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                        : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
                    }`}
                  >
                    {balance > 0.005 ? '+' : ''}
                    {euro(balance)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-white px-2.5 py-2 ring-1 ring-zinc-100">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                      A payé
                    </p>
                    <p className="mt-0.5 text-xs font-black font-mono tabular-nums text-zinc-900">
                      {euro(paid)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-white px-2.5 py-2 ring-1 ring-zinc-100">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                      Sa part
                    </p>
                    <p className="mt-0.5 text-xs font-black font-mono tabular-nums text-zinc-900">
                      {euro(share)}
                    </p>
                  </div>
                </div>
                <p className="text-[10px] font-semibold leading-snug text-zinc-500">
                  {balance > 0.05
                    ? `On lui doit ${euro(balance)}`
                    : balance < -0.05
                      ? `Il/elle doit ${euro(Math.abs(balance))} au groupe`
                      : 'Compte équilibré'}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded-[1.75rem] p-4 shadow-xs space-y-3 sm:rounded-[2rem] sm:p-5">
        <h3 className="font-extrabold text-sm text-zinc-900">
          Historique ({regularExpenses.length})
        </h3>

        {regularExpenses.length === 0 ? (
          <div className="py-6 text-center space-y-3">
            <p className="text-zinc-400 text-xs font-medium">Aucune dépense pour l’instant.</p>
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex min-h-11 items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-zinc-900 text-white text-xs font-bold"
            >
              <Plus className="w-4 h-4 text-emerald-400" /> Ajouter
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {regularExpenses.map((exp) => {
              const payer = friends.find((f) => f.id === exp.paidByFriendId);
              const categoryIcon = getCategoryIcon(exp.category);
              const beneficiaries =
                exp.splitAmongFriendIds?.length > 0 ? exp.splitAmongFriendIds : friendIds;
              const share = exp.amount / Math.max(1, beneficiaries.length);

              return (
                <div
                  key={exp.id}
                  className="p-3 rounded-2xl bg-zinc-50 border border-zinc-200 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <div className="w-8 h-8 shrink-0 rounded-xl bg-zinc-200 text-zinc-700 flex items-center justify-center font-bold">
                        {categoryIcon}
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-xs text-zinc-900 truncate">
                          {exp.description}
                        </h4>
                        <p className="text-[10px] text-zinc-500 font-medium truncate">
                          Payé par <strong style={{ color: payer?.color }}>{payer?.name}</strong>
                          <span className="font-mono"> · {exp.date}</span>
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-sm font-black text-zinc-900 font-mono tabular-nums">
                        {euro(exp.amount)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setExpenseToDelete(exp)}
                        className="touch-target flex items-center justify-center text-zinc-400 hover:text-red-500 rounded-lg transition-colors"
                        title="Supprimer la dépense"
                        aria-label={`Supprimer ${exp.description}`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] font-semibold text-zinc-500">
                    {euro(share)} / pers. · {beneficiaries.length} participant
                    {beneficiaries.length > 1 ? 's' : ''}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <>
            {expenseToDelete && (
              <div
                className="fixed inset-0 z-[100] bg-zinc-950/45 backdrop-blur-xs flex items-center justify-center p-4 overscroll-none"
                onClick={() => setExpenseToDelete(null)}
              >
                <div
                  data-modal-scroll
                  className="w-full max-w-sm bg-white rounded-[2rem] p-5 shadow-2xl border border-zinc-200 animate-in fade-in zoom-in-95 space-y-4"
                  onClick={(event) => event.stopPropagation()}
                >
                  <div>
                    <h3 className="font-extrabold text-base text-zinc-900">
                      Supprimer cette dépense ?
                    </h3>
                    <p className="text-[12px] text-zinc-500 font-medium mt-1.5 leading-relaxed">
                      « {expenseToDelete.description} » ({euro(expenseToDelete.amount)}) sera
                      retirée du budget. Les soldes seront recalculés.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setExpenseToDelete(null)}
                      className="flex-1 px-3.5 py-3 text-xs font-bold text-zinc-600 hover:bg-zinc-100 rounded-2xl"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteExpense(expenseToDelete.id);
                        setExpenseToDelete(null);
                      }}
                      className="flex-[1.3] px-4 py-3 text-xs font-bold bg-red-600 text-white rounded-2xl hover:bg-red-500"
                    >
                      Oui, supprimer
                    </button>
                  </div>
                </div>
              </div>
            )}

            {showAddModal && (
              <StepFormModal
                isOpen={showAddModal}
                onClose={() => {
                  setAddStep(1);
                  setShowAddModal(false);
                }}
                title="Nouvelle dépense"
                subtitle="Le partage se met à jour en direct"
                icon={<Receipt className="w-5 h-5" />}
                iconBgClassName="bg-zinc-950"
                steps={ADD_EXPENSE_STEPS}
                currentStep={addStep}
                onStepClick={setAddStep}
                canAdvanceFromStep={canAdvanceExpenseStep}
                onNext={() => setAddStep(2)}
                onPrevious={() => setAddStep(1)}
                onSubmit={handleCreateSubmit}
                submitLabel="Enregistrer"
                error={formError}
                titleId="add-expense-title"
                usePortal={false}
                sheetClassName="bg-white"
              >
                {addStep === 1 && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-200">
                    <div className="rounded-[1.35rem] bg-zinc-950 text-white p-4 space-y-3">
                      <label className="block space-y-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                          Nom de la dépense *
                        </span>
                        <input
                          type="text"
                          autoFocus
                          required
                          placeholder="Courses Carrefour, plein essence…"
                          value={desc}
                          onChange={(e) => setDesc(e.target.value)}
                          className="w-full bg-transparent text-lg font-extrabold text-white placeholder:text-zinc-600 border-0 border-b border-zinc-700 focus:border-emerald-400 focus:outline-hidden pb-2"
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                          Prix *
                        </span>
                        <div className="flex items-end gap-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            required
                            placeholder="0,00"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
                            className="w-full bg-transparent text-4xl font-black tracking-tight text-emerald-400 placeholder:text-zinc-700 border-0 focus:outline-hidden"
                          />
                          <span className="pb-1 text-xl font-bold text-zinc-500">€</span>
                        </div>
                      </label>
                    </div>
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3.5 py-3">
                      <p className="text-[11px] font-semibold leading-relaxed text-emerald-900">
                        À l’étape suivante, tu choisis qui a payé et comment partager entre l’équipage.
                      </p>
                    </div>
                  </div>
                )}

                {addStep === 2 && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-200">
                    <div className="rounded-2xl border border-zinc-200 bg-zinc-950 p-4 text-white">
                      <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-emerald-300">Récapitulatif</p>
                      <p className="mt-1 truncate text-base font-extrabold">{desc || 'Sans nom'}</p>
                      <p className="mt-0.5 font-mono text-lg font-black text-emerald-400">
                        {hasDraftAmount ? euro(Number(parsedAmount.toFixed(2))) : '—'}
                      </p>
                    </div>

                    {hasDraftAmount && (
                      <div className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50/70 p-3.5 space-y-3">
                        <div>
                          <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800">
                            Pour cette dépense
                          </p>
                          <p className="mt-0.5 text-[11px] font-semibold text-emerald-900/70 leading-snug">
                            {payerName} avance {euro(Number(parsedAmount.toFixed(2)))} · chacun
                            doit {euro(sharePerPerson)}
                          </p>
                        </div>
                        <div className="space-y-1.5">
                          {splitWith.map((id) => {
                            const isPayer = id === paidBy;
                            return (
                              <div
                                key={id}
                                className="flex items-center justify-between gap-2 rounded-xl bg-white/80 px-2.5 py-2 ring-1 ring-emerald-100"
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <img src={friendById[id]?.avatar} alt="" className="h-6 w-6 shrink-0 rounded-full object-cover" />
                                  <span className="truncate text-[11px] font-bold text-zinc-800">{displayName(id)}</span>
                                </div>
                                <span className="shrink-0 text-[10px] font-extrabold text-zinc-600">
                                  {isPayer ? `avance · part ${euro(sharePerPerson)}` : `doit ${euro(sharePerPerson)}`}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                        {draftExpenseDebts.length > 0 ? (
                          <div className="space-y-1.5 border-t border-emerald-200/80 pt-2.5">
                            <p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-800">
                              Qui rembourse {displayName(paidBy)}
                            </p>
                            {draftExpenseDebts.map((debt) => (
                              <div key={`${debt.fromId}-${debt.toId}`} className="flex items-center justify-between gap-2 rounded-xl bg-[#17352b] px-2.5 py-2 text-white">
                                <p className="min-w-0 truncate text-[11px] font-bold">
                                  {displayName(debt.fromId)}
                                  <span className="mx-1 font-semibold text-white/50">→</span>
                                  {displayName(debt.toId)}
                                </p>
                                <span className="shrink-0 font-mono text-xs font-black text-emerald-300 tabular-nums">{euro(debt.amount)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] font-semibold text-emerald-800">
                            {displayName(paidBy)} paie pour soi uniquement — aucune dette créée.
                          </p>
                        )}
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-bold text-zinc-700 mb-2">Catégorie</label>
                      <div className="flex flex-wrap gap-1.5">
                        {CATEGORIES.map((item) => (
                          <button
                            type="button"
                            key={item.id}
                            onClick={() => setCategory(item.id)}
                            className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
                              category === item.id ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200'
                            }`}
                          >
                            {item.emoji} {item.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-zinc-700 mb-2">Payé par</label>
                      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                        {friends.map((f) => (
                          <button
                            type="button"
                            key={f.id}
                            onClick={() => setPaidBy(f.id)}
                            className={`shrink-0 px-3 py-2 rounded-2xl text-xs font-bold flex items-center gap-2 border transition-all ${
                              paidBy === f.id
                                ? 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200'
                                : 'border-zinc-200 bg-zinc-50 text-zinc-700'
                            }`}
                          >
                            <img src={f.avatar} alt="" className="w-6 h-6 rounded-full object-cover" />
                            {f.id === currentFriendId ? 'Moi' : f.name}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-bold text-zinc-700">Partagé entre</label>
                        <button
                          type="button"
                          onClick={() => setSplitWith(friends.map((f) => f.id))}
                          className="text-[10px] font-bold text-emerald-700 hover:underline"
                        >
                          Tout le monde
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {friends.map((f) => {
                          const isIncluded = splitWith.includes(f.id);
                          return (
                            <button
                              type="button"
                              key={f.id}
                              onClick={() => toggleSplitFriend(f.id)}
                              className={`p-2.5 rounded-xl text-xs font-semibold flex items-center justify-between border transition-colors ${
                                isIncluded ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-zinc-100 text-zinc-500 border-zinc-200'
                              }`}
                            >
                              <span className="flex items-center gap-1.5 min-w-0">
                                <img src={f.avatar} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
                                <span className="truncate">{f.id === currentFriendId ? 'Moi' : f.name}</span>
                              </span>
                              {isIncluded && (
                                <span className="shrink-0 text-[9px] font-black text-emerald-300 font-mono">
                                  {sharePerPerson > 0 ? euro(sharePerPerson) : <CheckCircle2 className="w-3.5 h-3.5" />}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </StepFormModal>
            )}
          </>,
          document.body
        )}
    </div>
  );
};

function getCategoryIcon(cat: ExpenseCategory) {
  switch (cat) {
    case 'carburant':
      return '⛽';
    case 'peage':
      return '🛣️';
    case 'courses':
      return '🛒';
    case 'resto':
      return '🍽️';
    case 'activite':
      return '🏄';
    default:
      return '📦';
  }
}
