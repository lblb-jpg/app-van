import React, { useEffect, useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  Receipt,
  Plus,
  ArrowRightLeft,
  CheckCircle2,
  Wallet,
  X,
  Search,
  Pencil,
  BarChart3,
  List,
  Minus,
  ChevronRight,
} from 'lucide-react';
import { Expense, ExpenseCategory, Friend, DebtSettlement, SplitType } from '../types';
import { SimpleFormModal } from './SimpleFormModal';
import {
  CompactFormChip,
  CompactFormField,
  CompactFormHero,
  CompactFormRoot,
  CompactFormSection,
  CompactFormTextInput,
  FormModalFooter,
} from './CompactFormLayout';
import { ModalShell } from './ModalShell';
import {
  buildSplitDetails,
  computeBalances,
  CURRENCIES,
  currencySymbol,
  formatMoney,
  getParticipantAmounts,
  getParticipants,
  normalizeExpensesForFriends,
  parseAmount,
  sumCustomAmounts,
  validateCustomSplit,
} from '../lib/expenseSplit';

interface TricountBudgetProps {
  expenses: Expense[];
  friends: Friend[];
  currentFriendId: string;
  onAddExpense: (newExpense: Omit<Expense, 'id'>) => void;
  onUpdateExpense: (id: string, data: Omit<Expense, 'id'>) => void;
  onDeleteExpense: (id: string) => void;
}

type VanPayTab = 'expenses' | 'balances' | 'stats';

const CATEGORIES: { id: ExpenseCategory; label: string; emoji: string }[] = [
  { id: 'carburant', label: 'Carburant', emoji: '⛽' },
  { id: 'peage', label: 'Péage', emoji: '🛣️' },
  { id: 'courses', label: 'Courses', emoji: '🛒' },
  { id: 'resto', label: 'Resto', emoji: '🍽️' },
  { id: 'activite', label: 'Activité', emoji: '🏄' },
  { id: 'autre', label: 'Autre', emoji: '📦' },
];

const SPLIT_MODES: { id: SplitType; label: string; hint: string }[] = [
  { id: 'equal', label: 'Également', hint: 'Partage égal entre les participants' },
  { id: 'shares', label: 'Par parts', hint: 'Répartition selon le nombre de parts' },
  { id: 'custom', label: 'Montants', hint: 'Montant exact par personne' },
];

const SETTLEMENT_PREFIX = '[RÈGLEMENT]';

function expenseDescription(expense: Expense) {
  return expense.description?.trim() || 'Dépense';
}

function isSettlementExpense(expense: Expense) {
  return expenseDescription(expense).startsWith(SETTLEMENT_PREFIX);
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

function computePersonStats(
  expenses: Expense[],
  friends: Friend[],
  friendIds: string[],
  netBalances: Record<string, number>
) {
  return friends.map((friend) => {
    let paid = 0;
    let share = 0;

    expenses.forEach((exp) => {
      const participants = getParticipants(exp, friendIds);
      const amounts = getParticipantAmounts(exp, friendIds);
      if (exp.paidByFriendId === friend.id) paid += exp.amount;
      if (participants.includes(friend.id)) share += amounts[friend.id] ?? 0;
    });

    return {
      friend,
      paid: Number(paid.toFixed(2)),
      share: Number(share.toFixed(2)),
      balance: Number((netBalances[friend.id] ?? 0).toFixed(2)),
    };
  });
}

function personBalanceHint(balance: number) {
  if (balance > 0.05) return `À recevoir ${formatMoney(balance)}`;
  if (balance < -0.05) return `À rembourser ${formatMoney(Math.abs(balance))}`;
  return 'Équilibré';
}

function getCategoryIcon(cat: ExpenseCategory) {
  return CATEGORIES.find((item) => item.id === cat)?.emoji ?? '📦';
}

function splitTypeLabel(type?: SplitType) {
  return SPLIT_MODES.find((mode) => mode.id === (type ?? 'equal'))?.label ?? 'Également';
}

function todayIso() {
  return new Date().toISOString().split('T')[0];
}

export const TricountBudget: React.FC<TricountBudgetProps> = ({
  expenses,
  friends,
  currentFriendId,
  onAddExpense,
  onUpdateExpense,
  onDeleteExpense,
}) => {
  const [activeTab, setActiveTab] = useState<VanPayTab>('expenses');
  const [searchQuery, setSearchQuery] = useState('');
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);

  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [category, setCategory] = useState<ExpenseCategory>('courses');
  const [paidBy, setPaidBy] = useState(currentFriendId);
  const [splitType, setSplitType] = useState<SplitType>('equal');
  const [splitWith, setSplitWith] = useState<string[]>(() => friends.map((f) => f.id));
  const [shareCounts, setShareCounts] = useState<Record<string, number>>({});
  const [customAmounts, setCustomAmounts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');

  const friendIds = useMemo(() => friends.map((f) => f.id), [friends]);
  const normalizedExpenses = useMemo(
    () => normalizeExpensesForFriends(expenses, friends),
    [expenses, friends]
  );
  const friendById = useMemo(
    () => Object.fromEntries(friends.map((f) => [f.id, f])) as Record<string, Friend>,
    [friends]
  );

  const resetForm = () => {
    const ids = friends.map((f) => f.id);
    setDesc('');
    setAmount('');
    setCurrency('EUR');
    setExpenseDate(todayIso());
    setCategory('courses');
    setPaidBy(ids.includes(currentFriendId) ? currentFriendId : ids[0] || '');
    setSplitType('equal');
    setSplitWith(ids);
    setShareCounts(Object.fromEntries(ids.map((id) => [id, 1])));
    setCustomAmounts({});
    setNotes('');
    setFormError('');
    setEditingExpense(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowFormModal(true);
  };

  const openEditModal = (expense: Expense) => {
    setEditingExpense(expense);
    setDesc(expenseDescription(expense));
    setAmount(String(expense.amount).replace('.', ','));
    setCurrency(expense.currency ?? 'EUR');
    setExpenseDate(expense.date);
    setCategory(expense.category);
    setPaidBy(expense.paidByFriendId);
    setSplitType(expense.splitType ?? 'equal');
    setSplitWith(getParticipants(expense, friendIds));
    setShareCounts(
      Object.fromEntries(
        getParticipants(expense, friendIds).map((id) => [
          id,
          expense.splitDetails?.find((d) => d.friendId === id)?.shares ?? 1,
        ])
      )
    );
    setCustomAmounts(
      Object.fromEntries(
        getParticipants(expense, friendIds).map((id) => [
          id,
          expense.splitDetails?.find((d) => d.friendId === id)?.amount ??
            getParticipantAmounts(expense, friendIds)[id] ??
            0,
        ])
      )
    );
    setNotes(expense.notes ?? '');
    setFormError('');
    setShowFormModal(true);
    setDetailExpense(null);
  };

  useEffect(() => {
    if (!showFormModal) return;
    const ids = friends.map((f) => f.id);
    if (!ids.length) return;
    setPaidBy((prev) => (ids.includes(prev) ? prev : currentFriendId));
    setSplitWith((prev) => {
      const kept = prev.filter((id) => ids.includes(id));
      return kept.length ? kept : ids;
    });
  }, [friends, currentFriendId, showFormModal]);

  const parsedAmount = useMemo(() => parseAmount(amount), [amount]);
  const participantAmounts = useMemo(() => {
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || !splitWith.length) return {};
    const draft: Omit<Expense, 'id'> = {
      description: desc,
      amount: parsedAmount,
      category,
      date: expenseDate,
      paidByFriendId: paidBy,
      splitAmongFriendIds: splitWith,
      splitType,
      splitDetails: buildSplitDetails(splitType, splitWith, parsedAmount, shareCounts, customAmounts),
      currency,
      notes,
    };
    return getParticipantAmounts(draft, friendIds);
  }, [
    parsedAmount,
    splitWith,
    splitType,
    shareCounts,
    customAmounts,
    desc,
    category,
    expenseDate,
    paidBy,
    currency,
    notes,
    friendIds,
  ]);

  const customSum = useMemo(
    () => sumCustomAmounts(customAmounts, splitWith),
    [customAmounts, splitWith]
  );

  const hasDraftAmount =
    Number.isFinite(parsedAmount) && parsedAmount > 0 && splitWith.length > 0 && Boolean(paidBy);

  const settlementExpenses = normalizedExpenses.filter(isSettlementExpense);
  const recentSettlementExpenses = settlementExpenses.slice(0, 3);
  const regularExpenses = normalizedExpenses.filter((expense) => !isSettlementExpense(expense));

  const filteredExpenses = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return regularExpenses;
    return regularExpenses.filter((expense) => {
      const payer = friendById[expense.paidByFriendId]?.name?.toLowerCase() ?? '';
      return (
        expenseDescription(expense).toLowerCase().includes(query) ||
        payer.includes(query) ||
        expense.category.includes(query)
      );
    });
  }, [regularExpenses, searchQuery, friendById]);

  const totalSpent = regularExpenses.reduce((acc, curr) => acc + curr.amount, 0);
  const totalPerPerson = friends.length > 0 ? totalSpent / friends.length : 0;

  const netBalances = useMemo(
    () => computeBalances(normalizedExpenses, friendIds),
    [normalizedExpenses, friendIds]
  );
  const settlements = useMemo(() => computeSettlements(netBalances), [netBalances]);
  const personStats = useMemo(
    () => computePersonStats(regularExpenses, friends, friendIds, netBalances),
    [regularExpenses, friends, friendIds, netBalances]
  );

  const categoryStats = useMemo(() => {
    const totals = new Map<ExpenseCategory, number>();
    regularExpenses.forEach((expense) => {
      totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.amount);
    });
    return CATEGORIES.map((cat) => ({
      ...cat,
      total: totals.get(cat.id) ?? 0,
      percent: totalSpent > 0 ? ((totals.get(cat.id) ?? 0) / totalSpent) * 100 : 0,
    })).filter((item) => item.total > 0);
  }, [regularExpenses, totalSpent]);

  const draftExpenseDebts = useMemo(() => {
    if (!hasDraftAmount) return [] as { fromId: string; toId: string; amount: number }[];
    return splitWith
      .filter((id) => id !== paidBy)
      .map((fromId) => ({
        fromId,
        toId: paidBy,
        amount: participantAmounts[fromId] ?? 0,
      }))
      .filter((debt) => debt.amount > 0);
  }, [hasDraftAmount, splitWith, paidBy, participantAmounts]);

  const displayName = (id: string) =>
    id === currentFriendId ? 'Moi' : friendById[id]?.name || 'Équipier';

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!desc.trim()) {
      setFormError('Donne un nom à la dépense.');
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setFormError('Indique un montant valide (ex: 42,50).');
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
    if (splitType === 'custom' && !validateCustomSplit(parsedAmount, customAmounts, splitWith)) {
      setFormError(
        `La somme des montants (${formatMoney(customSum, currency)}) doit égaler le total (${formatMoney(parsedAmount, currency)}).`
      );
      return;
    }

    const payload: Omit<Expense, 'id'> = {
      description: desc.trim(),
      amount: Number(parsedAmount.toFixed(2)),
      category,
      date: expenseDate,
      paidByFriendId: paidBy,
      splitAmongFriendIds: splitWith,
      splitType,
      splitDetails: buildSplitDetails(splitType, splitWith, parsedAmount, shareCounts, customAmounts),
      currency,
      notes: notes.trim() || undefined,
    };

    if (editingExpense) {
      onUpdateExpense(editingExpense.id, payload);
    } else {
      onAddExpense(payload);
    }

    setShowFormModal(false);
    resetForm();
  };

  const canSubmitExpense =
    Boolean(desc.trim()) &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    Boolean(paidBy) &&
    splitWith.length > 0 &&
    (splitType !== 'custom' || validateCustomSplit(parsedAmount, customAmounts, splitWith));

  const toggleSplitFriend = (fId: string) => {
    if (splitWith.includes(fId)) {
      if (splitWith.length > 1) {
        const next = splitWith.filter((id) => id !== fId);
        setSplitWith(next);
      }
    } else {
      setSplitWith([...splitWith, fId]);
      setShareCounts((prev) => ({ ...prev, [fId]: prev[fId] ?? 1 }));
    }
  };

  const markSettlementPaid = (settlement: DebtSettlement, celebrate = true) => {
    const debtor = friends.find((friend) => friend.id === settlement.fromFriendId);
    const creditor = friends.find((friend) => friend.id === settlement.toFriendId);
    onAddExpense({
      description: `${SETTLEMENT_PREFIX} ${debtor?.name || 'Équipier'} → ${creditor?.name || 'Équipier'}`,
      amount: settlement.amount,
      category: 'autre',
      date: todayIso(),
      paidByFriendId: settlement.fromFriendId,
      splitAmongFriendIds: [settlement.toFriendId],
      splitType: 'custom',
      splitDetails: [{ friendId: settlement.toFriendId, amount: settlement.amount }],
      currency: 'EUR',
    });
    if (celebrate) confetti({ particleCount: 55, spread: 55, origin: { y: 0.7 } });
  };

  const handleSettleUpConfetti = () => {
    settlements.forEach((settlement) => markSettlementPaid(settlement, false));
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  };

  const handleSplitTypeChange = (next: SplitType) => {
    setSplitType(next);
    if (next === 'custom' && Number.isFinite(parsedAmount) && parsedAmount > 0) {
      const draft: Omit<Expense, 'id'> = {
        description: desc,
        amount: parsedAmount,
        category,
        date: expenseDate,
        paidByFriendId: paidBy,
        splitAmongFriendIds: splitWith,
        splitType: 'equal',
        currency,
      };
      const equalAmounts = getParticipantAmounts(draft, friendIds);
      setCustomAmounts(
        Object.fromEntries(splitWith.map((id) => [id, equalAmounts[id] ?? 0]))
      );
    }
  };

  const tabs: { id: VanPayTab; label: string; icon: React.ReactNode }[] = [
    { id: 'expenses', label: 'Dépenses', icon: <List className="w-3.5 h-3.5" /> },
    { id: 'balances', label: 'Soldes', icon: <ArrowRightLeft className="w-3.5 h-3.5" /> },
    { id: 'stats', label: 'Stats', icon: <BarChart3 className="w-3.5 h-3.5" /> },
  ];

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
            onClick={openAddModal}
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

      <div className="flex gap-1 rounded-2xl bg-zinc-100 p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-[11px] font-extrabold transition-all ${
              activeTab === tab.id
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'expenses' && (
        <>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <input
              type="search"
              placeholder="Rechercher une dépense…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-2xl border border-zinc-200 bg-white py-3 pl-10 pr-4 text-xs font-medium text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-500 focus:outline-hidden"
            />
          </div>

          <div className="bg-white border border-zinc-200 rounded-[1.75rem] p-4 shadow-xs space-y-3 sm:rounded-[2rem] sm:p-5">
            <h3 className="font-extrabold text-sm text-zinc-900">
              Historique ({filteredExpenses.length})
            </h3>

            {filteredExpenses.length === 0 ? (
              <div className="py-6 text-center space-y-3">
                <p className="text-zinc-400 text-xs font-medium">
                  {searchQuery ? 'Aucun résultat.' : 'Aucune dépense pour l’instant.'}
                </p>
                {!searchQuery && (
                  <button
                    type="button"
                    onClick={openAddModal}
                    className="inline-flex min-h-11 items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-zinc-900 text-white text-xs font-bold"
                  >
                    <Plus className="w-4 h-4 text-emerald-400" /> Ajouter
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredExpenses.map((exp) => {
                  const payer = friendById[exp.paidByFriendId];
                  const participants = getParticipants(exp, friendIds);
                  const amounts = getParticipantAmounts(exp, friendIds);
                  const symbol = currencySymbol(exp.currency);

                  return (
                    <button
                      key={exp.id}
                      type="button"
                      onClick={() => setDetailExpense(exp)}
                      className="w-full p-3 rounded-2xl bg-zinc-50 border border-zinc-200 space-y-2 text-left hover:border-emerald-200 hover:bg-emerald-50/30 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <div className="w-8 h-8 shrink-0 rounded-xl bg-zinc-200 text-zinc-700 flex items-center justify-center font-bold">
                            {getCategoryIcon(exp.category)}
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-bold text-xs text-zinc-900 truncate">
                              {expenseDescription(exp)}
                            </h4>
                            <p className="text-[10px] text-zinc-500 font-medium truncate">
                              Payé par <strong style={{ color: payer?.color }}>{payer?.name}</strong>
                              <span className="font-mono"> · {exp.date}</span>
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span className="text-sm font-black text-zinc-900 font-mono tabular-nums">
                            {exp.amount.toFixed(2)} {symbol}
                          </span>
                          <ChevronRight className="w-4 h-4 text-zinc-300" />
                        </div>
                      </div>
                      <p className="text-[10px] font-semibold text-zinc-500">
                        {splitTypeLabel(exp.splitType)} · {participants.length} participant
                        {participants.length > 1 ? 's' : ''}
                        {exp.splitType === 'custom' || exp.splitType === 'shares'
                          ? ` · ${Object.values(amounts)
                              .map((v) => v.toFixed(2))
                              .join(' / ')} ${symbol}`
                          : ` · ${(amounts[participants[0]] ?? 0).toFixed(2)} ${symbol} / pers.`}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'balances' && (
        <>
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
                        <strong className="font-mono text-emerald-700">
                          {formatMoney(st.amount)}
                        </strong>{' '}
                        à <strong className="text-zinc-900">{displayName(st.toFriendId)}</strong>
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
                          {formatMoney(st.amount)}
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
                          {formatMoney(payment.amount, payment.currency)}
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

          <div className="bg-white border border-zinc-200 rounded-[1.75rem] p-3 shadow-xs sm:rounded-[2rem] sm:p-4">
            <div className="mb-2 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-emerald-600" />
              <h4 className="font-extrabold text-sm text-zinc-900">Dépenses par personne</h4>
            </div>
            <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-100 bg-zinc-50/80">
              {personStats.map(({ friend, paid, share, balance }) => {
                const isCreditor = balance >= -0.005;
                const name =
                  friend.id === currentFriendId ? `Moi (${friend.name})` : friend.name;

                return (
                  <div
                    key={friend.id}
                    className="flex items-center gap-2.5 px-2.5 py-2.5 sm:px-3"
                  >
                    <img
                      src={friend.avatar}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-full object-cover ring-2 ring-white"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-xs font-extrabold text-zinc-900">{name}</p>
                        <span
                          className={`shrink-0 text-xs font-black font-mono tabular-nums ${
                            isCreditor ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {balance > 0.005 ? '+' : ''}
                          {formatMoney(balance)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[10px] font-medium text-zinc-500">
                        {formatMoney(paid)} avancé · {formatMoney(share)} de part
                      </p>
                      <p
                        className={`mt-0.5 text-[10px] font-semibold ${
                          Math.abs(balance) <= 0.05
                            ? 'text-zinc-400'
                            : isCreditor
                              ? 'text-emerald-600'
                              : 'text-amber-600'
                        }`}
                      >
                        {personBalanceHint(balance)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {activeTab === 'stats' && (
        <div className="bg-white border border-zinc-200 rounded-[1.75rem] p-4 shadow-xs space-y-4 sm:rounded-[2rem] sm:p-5">
          <h3 className="font-extrabold text-sm text-zinc-900 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-600" />
            Dépenses par catégorie
          </h3>

          {categoryStats.length === 0 ? (
            <p className="py-6 text-center text-zinc-400 text-xs font-medium">
              Pas encore de statistiques.
            </p>
          ) : (
            <div className="space-y-3">
              {categoryStats.map((item) => (
                <div key={item.id} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-zinc-800">
                      {item.emoji} {item.label}
                    </span>
                    <span className="font-mono font-black text-zinc-900 tabular-nums">
                      {formatMoney(item.total)} ({item.percent.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-zinc-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.max(4, item.percent)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-100">
            <div className="rounded-xl bg-zinc-50 p-3">
              <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                Dépenses
              </p>
              <p className="mt-1 text-lg font-black font-mono text-zinc-900">{regularExpenses.length}</p>
            </div>
            <div className="rounded-xl bg-zinc-50 p-3">
              <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                Règlements
              </p>
              <p className="mt-1 text-lg font-black font-mono text-zinc-900">
                {settlementExpenses.length}
              </p>
            </div>
          </div>
        </div>
      )}

      <ModalShell
        isOpen={Boolean(detailExpense)}
        onClose={() => setDetailExpense(null)}
        maxWidth="md"
      >
        {detailExpense && (
          <div className="space-y-4 p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{getCategoryIcon(detailExpense.category)}</span>
                  <h3 className="font-extrabold text-base text-[#17352b] truncate">
                    {expenseDescription(detailExpense)}
                  </h3>
                </div>
                <p className="mt-1 text-[12px] font-medium text-[#68756d]">
                  {detailExpense.date} · Payé par{' '}
                  {friendById[detailExpense.paidByFriendId]?.name ?? 'Équipier'}
                </p>
              </div>
              <span className="shrink-0 text-lg font-black font-mono text-[#17352b] tabular-nums">
                {formatMoney(detailExpense.amount, detailExpense.currency)}
              </span>
            </div>

            <div className="rounded-xl bg-[#f5f1e7] p-3 space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#68756d]">
                Répartition · {splitTypeLabel(detailExpense.splitType)}
              </p>
              {getParticipants(detailExpense, friendIds).map((id) => {
                const share = getParticipantAmounts(detailExpense, friendIds)[id] ?? 0;
                const isPayer = id === detailExpense.paidByFriendId;
                return (
                  <div key={id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[#17352b]">
                      {displayName(id)}
                      {isPayer && (
                        <span className="ml-1 text-[10px] font-bold text-emerald-700">(a payé)</span>
                      )}
                    </span>
                    <span className="font-mono font-black tabular-nums">
                      {formatMoney(share, detailExpense.currency)}
                      {detailExpense.splitType === 'shares' && (
                        <span className="ml-1 text-[10px] text-[#68756d]">
                          · {detailExpense.splitDetails?.find((d) => d.friendId === id)?.shares ?? 1}{' '}
                          part(s)
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            {detailExpense.notes && (
              <p className="text-[12px] text-[#68756d] leading-relaxed">{detailExpense.notes}</p>
            )}

            <div className="flex gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => {
                  openEditModal(detailExpense);
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#17352b] px-4 py-3 text-xs font-bold text-white hover:bg-[#285849]"
              >
                <Pencil className="w-3.5 h-3.5" /> Modifier
              </button>
              <button
                type="button"
                onClick={() => {
                  setExpenseToDelete(detailExpense);
                  setDetailExpense(null);
                }}
                className="rounded-xl px-4 py-3 text-xs font-bold text-red-600 hover:bg-red-50"
              >
                Supprimer
              </button>
            </div>
          </div>
        )}
      </ModalShell>

      <ModalShell
        isOpen={Boolean(expenseToDelete)}
        onClose={() => setExpenseToDelete(null)}
        maxWidth="sm"
      >
        <div className="space-y-4 p-5 sm:p-6">
          <div>
            <h3 className="font-extrabold text-base text-[#17352b]">Supprimer cette dépense ?</h3>
            <p className="mt-1.5 text-[12px] font-medium leading-relaxed text-[#68756d]">
              « {expenseToDelete?.description} » (
              {expenseToDelete ? formatMoney(expenseToDelete.amount, expenseToDelete.currency) : ''})
              sera retirée du budget. Les soldes seront recalculés.
            </p>
          </div>
          <div className="flex gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => setExpenseToDelete(null)}
              className="flex-1 rounded-xl px-3.5 py-3 text-xs font-bold text-[#68756d] hover:bg-[#17352b]/5"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={() => {
                if (expenseToDelete) onDeleteExpense(expenseToDelete.id);
                setExpenseToDelete(null);
              }}
              className="flex-[1.3] rounded-xl bg-red-600 px-4 py-3 text-xs font-bold text-white hover:bg-red-500"
            >
              Oui, supprimer
            </button>
          </div>
        </div>
      </ModalShell>

      <SimpleFormModal
        isOpen={showFormModal}
        onClose={() => {
          setShowFormModal(false);
          resetForm();
        }}
        title={editingExpense ? 'Modifier la dépense' : 'Nouvelle dépense'}
        subtitle="Montant · partage · équipage"
        icon={<Receipt className="h-4 w-4" />}
        titleId="expense-form-title"
        onSubmit={handleFormSubmit}
        footer={
          <FormModalFooter
            onCancel={() => {
              setShowFormModal(false);
              resetForm();
            }}
            submitLabel={editingExpense ? 'Enregistrer' : 'Ajouter'}
            canSubmit={canSubmitExpense}
          />
        }
      >
        <CompactFormRoot>
          <CompactFormHero>
            <CompactFormField label="Nom *" tone="hero">
              <CompactFormTextInput
                tone="hero"
                required
                placeholder="Courses, essence…"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                className="font-extrabold"
              />
            </CompactFormField>
            <div className="flex items-end gap-2">
              <label className="block min-w-0 flex-1">
                <span className="text-[9px] font-bold uppercase tracking-wider text-white/45">
                  Montant *
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  required
                  placeholder="0,00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
                  className="mt-0.5 w-full border-0 bg-transparent text-2xl font-black leading-none tracking-tight text-[#eb6c32] placeholder:text-white/20 focus:outline-hidden"
                />
              </label>
              <label className="block w-[4.5rem] shrink-0">
                <span className="text-[9px] font-bold uppercase tracking-wider text-white/45">
                  Devise
                </span>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="mt-0.5 w-full rounded-md border-0 bg-white/10 px-1.5 py-1 text-[11px] font-bold text-white focus:outline-hidden"
                >
                  {CURRENCIES.map((item) => (
                    <option key={item.code} value={item.code} className="text-zinc-900">
                      {item.code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block w-[7.5rem] shrink-0">
                <span className="text-[9px] font-bold uppercase tracking-wider text-white/45">
                  Date
                </span>
                <input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  className="mt-0.5 w-full rounded-md border-0 bg-white/10 px-1.5 py-1 text-[10px] font-semibold text-white focus:outline-hidden [color-scheme:dark]"
                />
              </label>
            </div>
          </CompactFormHero>

          {hasDraftAmount && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-2.5 py-2">
              <p className="text-[10px] font-semibold leading-snug text-emerald-900">
                {displayName(paidBy)} avance {formatMoney(Number(parsedAmount.toFixed(2)), currency)}
                {draftExpenseDebts.length > 0 && (
                  <span className="font-medium text-emerald-700">
                    {' '}
                    · {draftExpenseDebts.map((debt) =>
                      `${displayName(debt.fromId)} → ${displayName(debt.toId)} ${formatMoney(debt.amount, currency)}`
                    ).join(' · ')}
                  </span>
                )}
              </p>
            </div>
          )}

          <CompactFormSection>
            <div>
              <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#68756d]">
                Catégorie
              </p>
              <div className="grid grid-cols-3 gap-1">
                {CATEGORIES.map((item) => (
                  <CompactFormChip
                    key={item.id}
                    active={category === item.id}
                    onClick={() => setCategory(item.id)}
                  >
                    {item.emoji} {item.label}
                  </CompactFormChip>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#68756d]">
                Payé par
              </p>
              <div className="flex flex-wrap gap-1">
                {friends.map((f) => (
                  <button
                    type="button"
                    key={f.id}
                    onClick={() => setPaidBy(f.id)}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold transition-all ${
                      paidBy === f.id
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-900'
                        : 'border-[#17352b]/8 bg-white text-[#68756d]'
                    }`}
                  >
                    <img src={f.avatar} alt="" className="h-4 w-4 rounded-full object-cover" />
                    {f.id === currentFriendId ? 'Moi' : f.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-[#68756d]">
                Partage
              </p>
              <div className="grid grid-cols-3 gap-1">
                {SPLIT_MODES.map((mode) => (
                  <CompactFormChip
                    key={mode.id}
                    active={splitType === mode.id}
                    onClick={() => handleSplitTypeChange(mode.id)}
                    className="font-extrabold"
                  >
                    {mode.label}
                  </CompactFormChip>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="text-[9px] font-bold uppercase tracking-wider text-[#68756d]">
                  Participants
                </p>
                <button
                  type="button"
                  onClick={() => setSplitWith(friends.map((friend) => friend.id))}
                  className="text-[9px] font-bold text-emerald-700 hover:underline"
                >
                  Tous
                </button>
              </div>
              <div className="flex flex-wrap gap-1">
                {friends.map((f) => {
                  const isIncluded = splitWith.includes(f.id);
                  const personAmount = participantAmounts[f.id] ?? 0;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => toggleSplitFriend(f.id)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold transition-all ${
                        isIncluded
                          ? 'border-[#17352b] bg-white text-[#17352b]'
                          : 'border-transparent bg-white/50 text-[#68756d]/70 line-through'
                      }`}
                    >
                      <img src={f.avatar} alt="" className="h-4 w-4 rounded-full object-cover" />
                      {f.id === currentFriendId ? 'Moi' : f.name}
                      {isIncluded && splitType === 'equal' && personAmount > 0 && (
                        <span className="font-mono text-[9px] text-emerald-700">
                          {formatMoney(personAmount, currency)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {(splitType === 'shares' || splitType === 'custom') && (
                <div className="mt-1.5 space-y-1">
                  {friends
                    .filter((f) => splitWith.includes(f.id))
                    .map((f) => {
                      const personAmount = participantAmounts[f.id] ?? 0;
                      return (
                        <div
                          key={f.id}
                          className="flex items-center gap-1.5 rounded-lg bg-white px-2 py-1 ring-1 ring-[#17352b]/8"
                        >
                          <img src={f.avatar} alt="" className="h-4 w-4 shrink-0 rounded-full object-cover" />
                          <span className="min-w-0 flex-1 truncate text-[10px] font-bold text-[#17352b]">
                            {f.id === currentFriendId ? 'Moi' : f.name}
                          </span>

                          {splitType === 'shares' && (
                            <div className="flex items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setShareCounts((prev) => ({
                                    ...prev,
                                    [f.id]: Math.max(1, (prev[f.id] ?? 1) - 1),
                                  }))
                                }
                                className="flex h-6 w-6 items-center justify-center rounded-md bg-[#f5f1e7]"
                              >
                                <Minus className="h-2.5 w-2.5" />
                              </button>
                              <span className="w-4 text-center text-[10px] font-black font-mono">
                                {shareCounts[f.id] ?? 1}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setShareCounts((prev) => ({
                                    ...prev,
                                    [f.id]: (prev[f.id] ?? 1) + 1,
                                  }))
                                }
                                className="flex h-6 w-6 items-center justify-center rounded-md bg-[#f5f1e7]"
                              >
                                <Plus className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          )}

                          {splitType === 'custom' && (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={String(customAmounts[f.id] ?? 0).replace('.', ',')}
                              onChange={(e) => {
                                const val = parseAmount(e.target.value.replace(/[^\d.,]/g, ''));
                                setCustomAmounts((prev) => ({
                                  ...prev,
                                  [f.id]: Number.isFinite(val) ? val : 0,
                                }));
                              }}
                              className="w-16 rounded-md border border-[#17352b]/10 bg-[#f5f1e7] px-1.5 py-0.5 text-right text-[10px] font-black font-mono"
                            />
                          )}

                          {personAmount > 0 && splitType !== 'custom' && (
                            <span className="shrink-0 font-mono text-[9px] font-black text-emerald-700">
                              {formatMoney(personAmount, currency)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}

              {splitType === 'custom' && hasDraftAmount && (
                <p
                  className={`mt-1 text-[9px] font-bold ${
                    validateCustomSplit(parsedAmount, customAmounts, splitWith)
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }`}
                >
                  Total : {formatMoney(customSum, currency)} / {formatMoney(parsedAmount, currency)}
                </p>
              )}
            </div>

            <CompactFormField label="Note">
              <CompactFormTextInput
                placeholder="Optionnel…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </CompactFormField>
          </CompactFormSection>

          {formError && (
            <p className="rounded-lg border border-amber-100 bg-amber-50 px-2.5 py-1.5 text-[10px] font-semibold text-amber-800">
              {formError}
            </p>
          )}
        </CompactFormRoot>
      </SimpleFormModal>
    </div>
  );
};
