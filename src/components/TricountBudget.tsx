import React, { useEffect, useMemo, useState } from 'react';
import confetti from 'canvas-confetti';
import {
  Receipt,
  Plus,
  ArrowRightLeft,
  CheckCircle2,
  X,
  Pencil,
  BarChart3,
  List,
  Minus,
  Trash2,
  Users,
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
  authorId: string;
  onAddExpense: (newExpense: Omit<Expense, 'id'>) => void | Promise<void>;
  onUpdateExpense: (id: string, data: Omit<Expense, 'id'>) => void | Promise<void>;
  onDeleteExpense: (id: string) => void | Promise<void>;
  onClearAllExpenses: () => void | Promise<void>;
}

type VanPayTab = 'expenses' | 'balances' | 'people' | 'stats';

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

function getPersonExpenseLines(friendId: string, expenses: Expense[], friendIds: string[]) {
  return expenses
    .flatMap((expense) => {
      const participants = getParticipants(expense, friendIds);
      const isPayer = expense.paidByFriendId === friendId;
      if (!participants.includes(friendId) && !isPayer) return [];
      const amounts = getParticipantAmounts(expense, friendIds);
      return [{
        expense,
        isPayer,
        personAmount: amounts[friendId] ?? 0,
      }];
    })
    .sort((a, b) => b.expense.date.localeCompare(a.expense.date));
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
  authorId,
  onAddExpense,
  onUpdateExpense,
  onDeleteExpense,
  onClearAllExpenses,
}) => {
  const [activeTab, setActiveTab] = useState<VanPayTab>('expenses');
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [detailExpense, setDetailExpense] = useState<Expense | null>(null);
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);
  const [isClearingExpenses, setIsClearingExpenses] = useState(false);

  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [category, setCategory] = useState<ExpenseCategory>('courses');
  const [paidBy, setPaidBy] = useState(authorId);
  const [splitType, setSplitType] = useState<SplitType>('equal');
  const [splitWith, setSplitWith] = useState<string[]>(() => friends.map((f) => f.id));
  const [shareCounts, setShareCounts] = useState<Record<string, number>>({});
  const [customAmounts, setCustomAmounts] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [settling, setSettling] = useState(false);
  const [actionError, setActionError] = useState('');

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
    setPaidBy(ids.includes(authorId) ? authorId : ids[0] || '');
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
    setPaidBy((prev) => (ids.includes(prev) ? prev : authorId));
    setSplitWith((prev) => {
      const kept = prev.filter((id) => ids.includes(id));
      return kept.length ? kept : ids;
    });
  }, [friends, authorId, showFormModal]);

  useEffect(() => {
    if (!showFormModal && !editingExpense) {
      setPaidBy(authorId);
    }
  }, [authorId, showFormModal, editingExpense]);

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
  const regularExpenses = normalizedExpenses.filter((expense) => !isSettlementExpense(expense));

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
    id === authorId ? 'Moi' : friendById[id]?.name || 'Équipier';

  const handleClearAllExpenses = async () => {
    if (isClearingExpenses) return;
    if (
      !window.confirm(
        'Supprimer toutes les dépenses VanPay ?\n\nCette action remet les soldes et le total à zéro pour tout l’équipage.'
      )
    ) {
      return;
    }
    if (
      !window.confirm(
        'Dernière confirmation : effacer définitivement toutes les dépenses ?\n\nCette action ne peut pas être annulée.'
      )
    ) {
      return;
    }
    setIsClearingExpenses(true);
    try {
      await onClearAllExpenses();
    } finally {
      setIsClearingExpenses(false);
    }
  };

  const hasAnyExpenses = regularExpenses.length + settlementExpenses.length > 0;

  const handleFormSubmit = async (e: React.FormEvent) => {
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
      currency: 'EUR',
      notes: notes.trim() || undefined,
    };

    setSaving(true);
    try {
      if (editingExpense) {
        await onUpdateExpense(editingExpense.id, payload);
      } else {
        await onAddExpense(payload);
      }
      setShowFormModal(false);
      resetForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Impossible d’enregistrer la dépense.');
    } finally {
      setSaving(false);
    }
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

  const markSettlementPaid = async (settlement: DebtSettlement, celebrate = true) => {
    const debtor = friends.find((friend) => friend.id === settlement.fromFriendId);
    const creditor = friends.find((friend) => friend.id === settlement.toFriendId);
    setActionError('');
    await onAddExpense({
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

  const handleSettleUpConfetti = async () => {
    if (settling || !settlements.length) return;
    setSettling(true);
    setActionError('');
    try {
      for (const settlement of settlements) {
        await markSettlementPaid(settlement, false);
      }
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Impossible d’enregistrer le règlement.');
    } finally {
      setSettling(false);
    }
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
    { id: 'people', label: 'Par pers.', icon: <Users className="w-3.5 h-3.5" /> },
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
          <div className="flex items-center gap-1.5">
            {hasAnyExpenses && (
              <button
                type="button"
                onClick={() => void handleClearAllExpenses()}
                disabled={isClearingExpenses}
                className="relative z-10 min-h-10 px-3 py-2 rounded-2xl bg-red-950/50 hover:bg-red-900/60 text-red-200 font-bold text-[10px] transition-all flex items-center gap-1 disabled:opacity-50 ring-1 ring-red-400/25"
                title="Supprimer toutes les dépenses"
              >
                <Trash2 className="w-3.5 h-3.5 shrink-0" />
                <span>Supprimer tout</span>
              </button>
            )}
            <button
              type="button"
              onClick={openAddModal}
              className="relative z-10 min-h-10 px-3.5 py-2 rounded-2xl bg-white hover:bg-zinc-100 text-zinc-900 font-extrabold text-xs shadow-xs transition-all flex items-center gap-1"
            >
              <Plus className="w-4 h-4 text-emerald-600" /> Dépense
            </button>
          </div>
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
            onClick={() => {
              setActiveTab(tab.id);
              setActionError('');
              setFormError('');
            }}
            className={`flex flex-1 items-center justify-center gap-1 rounded-xl py-2.5 text-[10px] font-extrabold transition-all sm:gap-1.5 sm:text-[11px] ${
              activeTab === tab.id
                ? 'bg-white text-zinc-900 shadow-xs'
                : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {tab.icon}
            <span className="truncate">{tab.label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'expenses' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openAddModal}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-2xl bg-zinc-900 px-4 py-2.5 text-xs font-bold text-white sm:flex-none"
            >
              <Plus className="w-4 h-4 text-emerald-400" /> Ajouter une dépense
            </button>
            {hasAnyExpenses && (
              <button
                type="button"
                onClick={() => void handleClearAllExpenses()}
                disabled={isClearingExpenses}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                Tout supprimer
              </button>
            )}
          </div>

          {normalizedExpenses.length === 0 ? (
            <div className="rounded-[1.75rem] border border-zinc-200 bg-white p-8 text-center shadow-xs sm:rounded-[2rem]">
              <p className="text-xs font-medium text-zinc-400">
                Aucune dépense pour l’instant. Ajoute la première pour lancer VanPay.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {[...normalizedExpenses]
                .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
                .map((expense) => {
                  const settlement = isSettlementExpense(expense);
                  const payer = friendById[expense.paidByFriendId];
                  return (
                    <button
                      key={expense.id}
                      type="button"
                      onClick={() => setDetailExpense(expense)}
                      className={`flex w-full items-center gap-3 rounded-[1.35rem] border px-3.5 py-3 text-left shadow-xs transition-colors ${
                        settlement
                          ? 'border-emerald-100 bg-emerald-50/70'
                          : 'border-zinc-200 bg-white hover:bg-zinc-50'
                      }`}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-base ring-1 ring-zinc-200">
                        {settlement ? '🤝' : getCategoryIcon(expense.category)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-extrabold text-zinc-900">
                          {expenseDescription(expense)}
                        </p>
                        <p className="mt-0.5 truncate text-[10px] font-medium text-zinc-500">
                          {expense.date}
                          {payer ? ` · ${payer.name}` : ''}
                          {settlement ? ' · règlement' : ''}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-black font-mono tabular-nums text-zinc-900">
                        {formatMoney(expense.amount, expense.currency ?? 'EUR')}
                      </span>
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'balances' && (
        <>
          {actionError && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] font-semibold text-amber-900">
              {actionError}
            </div>
          )}
          <div className="bg-white border border-zinc-200 rounded-[1.75rem] p-4 shadow-xs space-y-3 sm:rounded-[2rem] sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <h3 className="min-w-0 font-extrabold text-sm text-zinc-900 flex items-start gap-2 leading-snug">
                <ArrowRightLeft className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
                <span>Qui doit combien à qui</span>
              </h3>
              {settlements.length > 0 && (
                <button
                  type="button"
                  disabled={settling}
                  onClick={() => void handleSettleUpConfetti()}
                  className="self-start shrink-0 touch-chip text-[10px] font-extrabold px-3 py-2 rounded-full bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                >
                  {settling ? 'Enregistrement…' : '✓ Tout marquer payé'}
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
                        disabled={settling}
                        onClick={() => {
                          void (async () => {
                            setSettling(true);
                            try {
                              await markSettlementPaid(st);
                            } catch (err) {
                              setActionError(
                                err instanceof Error ? err.message : 'Impossible d’enregistrer le règlement.'
                              );
                            } finally {
                              setSettling(false);
                            }
                          })();
                        }}
                        className="mt-2.5 flex w-full min-h-10 items-center justify-center gap-1.5 rounded-xl bg-zinc-900 py-2.5 text-[10px] font-extrabold text-white transition-all hover:bg-zinc-800 disabled:opacity-50"
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
        </>
      )}

      {activeTab === 'people' && (
        <div className="space-y-3">
          {personStats.length === 0 ? (
            <div className="bg-white border border-zinc-200 rounded-[1.75rem] p-8 text-center shadow-xs sm:rounded-[2rem]">
              <p className="text-xs font-medium text-zinc-400">Aucune dépense à répartir.</p>
            </div>
          ) : (
            personStats.map(({ friend, paid, share, balance }) => {
              const isCreditor = balance >= -0.005;
              const name = friend.id === authorId ? `Moi (${friend.name})` : friend.name;
              const lines = getPersonExpenseLines(friend.id, regularExpenses, friendIds);

              return (
                <div
                  key={friend.id}
                  className="overflow-hidden rounded-[1.75rem] border border-zinc-200 bg-white shadow-xs sm:rounded-[2rem]"
                >
                  <div className="border-b border-zinc-100 bg-zinc-50/80 p-4">
                    <div className="flex items-start gap-3">
                      <img
                        src={friend.avatar}
                        alt=""
                        className="h-11 w-11 shrink-0 rounded-2xl object-cover ring-2 ring-white"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <h3 className="truncate text-sm font-extrabold text-zinc-900">{name}</h3>
                          <span
                            className={`shrink-0 text-sm font-black font-mono tabular-nums ${
                              isCreditor ? 'text-emerald-700' : 'text-amber-700'
                            }`}
                          >
                            {balance > 0.005 ? '+' : ''}
                            {formatMoney(balance)}
                          </span>
                        </div>
                        <p
                          className={`mt-1 text-[11px] font-semibold ${
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

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-xl bg-white px-2.5 py-2 ring-1 ring-zinc-200">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                          Avancé
                        </p>
                        <p className="mt-0.5 text-xs font-black font-mono text-zinc-900 tabular-nums">
                          {formatMoney(paid)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-white px-2.5 py-2 ring-1 ring-zinc-200">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                          Sa part
                        </p>
                        <p className="mt-0.5 text-xs font-black font-mono text-zinc-900 tabular-nums">
                          {formatMoney(share)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-white px-2.5 py-2 ring-1 ring-zinc-200">
                        <p className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
                          Solde
                        </p>
                        <p
                          className={`mt-0.5 text-xs font-black font-mono tabular-nums ${
                            isCreditor ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {balance > 0.005 ? '+' : ''}
                          {formatMoney(balance)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 sm:p-4">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      Détail ({lines.length})
                    </p>
                    {lines.length === 0 ? (
                      <p className="py-3 text-center text-[11px] font-medium text-zinc-400">
                        Aucune dépense associée.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {lines.map(({ expense, isPayer, personAmount }) => (
                          <div
                            key={expense.id}
                            className="flex items-center gap-2.5 rounded-xl border border-zinc-100 bg-zinc-50/80 px-2.5 py-2"
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-sm ring-1 ring-zinc-200">
                              {getCategoryIcon(expense.category)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[11px] font-bold text-zinc-900">
                                {expenseDescription(expense)}
                              </p>
                              <p className="text-[10px] font-medium text-zinc-500">
                                {expense.date}
                                {isPayer ? (
                                  <span className="ml-1 font-bold text-emerald-700">· a payé</span>
                                ) : (
                                  <span className="ml-1">
                                    · payé par {friendById[expense.paidByFriendId]?.name ?? 'équipier'}
                                  </span>
                                )}
                              </p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-xs font-black font-mono text-zinc-900 tabular-nums">
                                {formatMoney(personAmount, expense.currency)}
                              </p>
                              {isPayer && personAmount !== expense.amount && (
                                <p className="text-[9px] font-medium text-zinc-400">
                                  / {formatMoney(expense.amount, expense.currency)}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
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
              disabled={saving}
              onClick={() => {
                void (async () => {
                  if (!expenseToDelete) return;
                  setSaving(true);
                  try {
                    await onDeleteExpense(expenseToDelete.id);
                    setExpenseToDelete(null);
                  } catch (err) {
                    setActionError(err instanceof Error ? err.message : 'Impossible de supprimer.');
                    setFormError(err instanceof Error ? err.message : 'Impossible de supprimer.');
                  } finally {
                    setSaving(false);
                  }
                })();
              }}
              className="flex-[1.3] rounded-xl bg-red-600 px-4 py-3 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-50"
            >
              {saving ? 'Suppression…' : 'Oui, supprimer'}
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
        onSubmit={(e) => void handleFormSubmit(e)}
        footer={
          <FormModalFooter
            onCancel={() => {
              if (saving) return;
              setShowFormModal(false);
              resetForm();
            }}
            submitLabel={editingExpense ? 'Enregistrer' : 'Ajouter'}
            canSubmit={canSubmitExpense}
            saving={saving}
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
                <div className="mt-0.5 rounded-md border-0 bg-white/10 px-1.5 py-1 text-[11px] font-bold text-white">
                  EUR
                </div>
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
                    {f.id === authorId ? 'Moi' : f.name}
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
                      {f.id === authorId ? 'Moi' : f.name}
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
                            {f.id === authorId ? 'Moi' : f.name}
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
