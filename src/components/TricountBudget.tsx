import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import confetti from 'canvas-confetti';
import { 
  Receipt, 
  Plus, 
  ArrowRightLeft, 
  CheckCircle2, 
  X,
} from 'lucide-react';
import { Expense, ExpenseCategory, Friend, DebtSettlement } from '../types';

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

function parseEuroAmount(raw: string) {
  const normalized = raw.replace(/\s/g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : NaN;
}

const SETTLEMENT_PREFIX = '[RÈGLEMENT]';

export const TricountBudget: React.FC<TricountBudgetProps> = ({
  expenses,
  friends,
  currentFriendId,
  onAddExpense,
  onDeleteExpense
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('courses');
  const [paidBy, setPaidBy] = useState(currentFriendId);
  const [splitWith, setSplitWith] = useState<string[]>(() => friends.map((f) => f.id));
  const [formError, setFormError] = useState('');
  const [expenseToDelete, setExpenseToDelete] = useState<Expense | null>(null);

  const openAddModal = () => {
    const friendIds = friends.map((f) => f.id);
    setDesc('');
    setAmount('');
    setCategory('courses');
    setPaidBy(friendIds.includes(currentFriendId) ? currentFriendId : friendIds[0] || '');
    setSplitWith(friendIds.length ? friendIds : []);
    setFormError('');
    setShowAddModal(true);
  };

  useEffect(() => {
    if (!showAddModal) return;
    const friendIds = friends.map((f) => f.id);
    if (!friendIds.length) return;
    setPaidBy((prev) => (friendIds.includes(prev) ? prev : currentFriendId));
    setSplitWith((prev) => {
      const kept = prev.filter((id) => friendIds.includes(id));
      return kept.length ? kept : friendIds;
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

  const parsedAmount = useMemo(() => parseEuroAmount(amount), [amount]);
  const shareCount = Math.max(1, splitWith.length);
  const sharePerPerson = Number.isFinite(parsedAmount) && parsedAmount > 0
    ? parsedAmount / shareCount
    : 0;

  // Compute Total Spent
  const settlementExpenses = expenses.filter((expense) => expense.description.startsWith(SETTLEMENT_PREFIX));
  const recentSettlementExpenses = settlementExpenses.slice(0, 3);
  const regularExpenses = expenses.filter((expense) => !expense.description.startsWith(SETTLEMENT_PREFIX));
  const totalSpent = regularExpenses.reduce((acc, curr) => acc + curr.amount, 0);
  const totalPerPerson = friends.length > 0 ? totalSpent / friends.length : 0;

  // Compute Balances and Debt Settlements (Tricount Algorithm)
  const calculateBalances = () => {
    const netBalances: Record<string, number> = {};
    friends.forEach((f) => {
      netBalances[f.id] = 0;
    });

    expenses.forEach((exp) => {
      const payer = exp.paidByFriendId;
      const beneficiaries = exp.splitAmongFriendIds && exp.splitAmongFriendIds.length > 0
        ? exp.splitAmongFriendIds
        : friends.map((f) => f.id);

      const splitAmount = exp.amount / beneficiaries.length;

      // Payer gets credited full amount
      netBalances[payer] = (netBalances[payer] || 0) + exp.amount;

      // Each beneficiary gets debited their share
      beneficiaries.forEach((bId) => {
        netBalances[bId] = (netBalances[bId] || 0) - splitAmount;
      });
    });

    return netBalances;
  };

  const calculateDebtSettlements = (): DebtSettlement[] => {
    const balances = calculateBalances();
    const debtors: { id: string; amount: number }[] = [];
    const creditors: { id: string; amount: number }[] = [];

    Object.entries(balances).forEach(([id, bal]) => {
      if (bal < -0.01) {
        debtors.push({ id, amount: -bal });
      } else if (bal > 0.01) {
        creditors.push({ id, amount: bal });
      }
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
          amount: Number(amountToSettle.toFixed(2))
        });
      }

      debtor.amount -= amountToSettle;
      creditor.amount -= amountToSettle;

      if (debtor.amount < 0.01) i++;
      if (creditor.amount < 0.01) j++;
    }

    return settlements;
  };

  const netBalances = calculateBalances();
  const settlements = calculateDebtSettlements();

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
    setShowAddModal(false);
  };

  const toggleSplitFriend = (fId: string) => {
    if (splitWith.includes(fId)) {
      if (splitWith.length > 1) {
        setSplitWith(splitWith.filter((id) => id !== fId));
      }
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
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });
  };

  return (
    <div className="page-pad space-y-3 sm:space-y-4">
      {/* Top Bento Summary Cards */}
      <div className="bg-zinc-900 text-white rounded-[1.75rem] p-4 shadow-xs relative overflow-hidden sm:rounded-[2rem] sm:p-6">
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-2xl"></div>

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
            {totalSpent.toFixed(2)} <span className="text-lg sm:text-xl font-bold text-zinc-400">€</span>
          </div>
          <p className="text-xs text-zinc-400 font-medium mt-1">Total dépenses du van</p>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-zinc-800 relative z-10">
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Moyenne / pers.</span>
            <p className="text-sm font-extrabold text-emerald-400 font-mono tabular-nums">{totalPerPerson.toFixed(2)} €</p>
          </div>
          <div className="min-w-0">
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-wider">Équipiers</span>
            <p className="text-sm font-extrabold text-white font-mono">{friends.length}</p>
          </div>
        </div>
      </div>

      {/* Tricount Balance Resolver Card ("Qui doit quoi à qui ?") */}
      <div className="bg-white border border-zinc-200 rounded-[1.75rem] p-4 shadow-xs space-y-3 sm:rounded-[2rem] sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <h3 className="min-w-0 font-extrabold text-sm text-zinc-900 flex items-start gap-2 leading-snug">
            <ArrowRightLeft className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
            <span>Équilibrage Tricount</span>
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
              const debtor = friends.find((f) => f.id === st.fromFriendId);
              const creditor = friends.find((f) => f.id === st.toFriendId);

              return (
                <div
                  key={idx}
                  className="p-3 rounded-2xl bg-zinc-50 border border-zinc-200"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                      <img
                        src={debtor?.avatar}
                        alt={debtor?.name}
                        className="w-7 h-7 shrink-0 rounded-full object-cover ring-2 ring-white"
                      />
                      <span className="truncate text-xs font-bold text-zinc-800">{debtor?.name}</span>
                      <span className="shrink-0 text-[10px] text-zinc-400 font-medium">→</span>
                      <img
                        src={creditor?.avatar}
                        alt={creditor?.name}
                        className="w-7 h-7 shrink-0 rounded-full object-cover ring-2 ring-white"
                      />
                      <span className="truncate text-xs font-bold text-zinc-800">{creditor?.name}</span>
                    </div>

                    <span className="shrink-0 text-sm font-black font-mono px-2.5 py-1 rounded-xl border shadow-xs text-emerald-700 bg-white border-zinc-200 tabular-nums">
                      {st.amount.toFixed(2)} €
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => markSettlementPaid(st)}
                    className="mt-2.5 flex w-full min-h-10 items-center justify-center gap-1.5 rounded-xl bg-zinc-900 py-2.5 text-[10px] font-extrabold text-white transition-all hover:bg-zinc-800"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span className="truncate">{debtor?.name || 'Cette personne'} a payé</span>
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
              {settlementExpenses.length > 3 ? '3 dernières' : `${settlementExpenses.length} réglé(s)`}
            </span>
          </div>

          <div className="space-y-2">
            {recentSettlementExpenses.map((payment) => {
              const debtor = friends.find((friend) => friend.id === payment.paidByFriendId);
              const creditor = friends.find((friend) => friend.id === payment.splitAmongFriendIds[0]);
              return (
                <div key={payment.id} className="rounded-2xl border border-emerald-200 bg-white/75 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-emerald-950 truncate">
                        {debtor?.name || 'Équipier'} → {creditor?.name || 'équipier'}
                      </p>
                      <p className="mt-0.5 text-[10px] font-semibold text-emerald-700">Payé le {payment.date}</p>
                    </div>
                    <span className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-sm font-black font-mono text-emerald-700 line-through decoration-2 tabular-nums">
                      {payment.amount.toFixed(2)} €
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

      {/* Friends Net Balance Pill List */}
      <div className="bg-white border border-zinc-200 rounded-[1.75rem] p-4 shadow-xs space-y-3 sm:rounded-[2rem] sm:p-5">
        <h4 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Bilan individuel</h4>
        <div className="grid grid-cols-2 gap-2">
          {friends.map((friend) => {
            const bal = netBalances[friend.id] || 0;
            const isPositive = bal >= 0;

            return (
              <div
                key={friend.id}
                className="p-3 rounded-2xl bg-zinc-50 border border-zinc-100 flex items-center justify-between gap-1.5 min-w-0"
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <img src={friend.avatar} alt={friend.name} className="w-6 h-6 shrink-0 rounded-full object-cover" />
                  <span className="truncate text-xs font-bold text-zinc-800">{friend.name}</span>
                </div>
                <span
                  className={`shrink-0 text-[11px] font-extrabold font-mono tabular-nums ${
                    isPositive ? 'text-emerald-600' : 'text-amber-600'
                  }`}
                >
                  {isPositive ? `+${bal.toFixed(0)}` : bal.toFixed(0)} €
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Expenses History */}
      <div className="bg-white border border-zinc-200 rounded-[1.75rem] p-4 shadow-xs space-y-3 sm:rounded-[2rem] sm:p-5">
        <h3 className="font-extrabold text-sm text-zinc-900">Historique ({regularExpenses.length})</h3>

        {regularExpenses.length === 0 ? (
          <div className="py-6 text-center space-y-3">
            <p className="text-zinc-400 text-xs font-medium">
              Aucune dépense pour l’instant.
            </p>
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

              return (
                <div
                  key={exp.id}
                  className="p-3 rounded-2xl bg-zinc-50 border border-zinc-200 flex items-center justify-between gap-2"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="w-8 h-8 shrink-0 rounded-xl bg-zinc-200 text-zinc-700 flex items-center justify-center font-bold">
                      {categoryIcon}
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-bold text-xs text-zinc-900 truncate">{exp.description}</h4>
                      <p className="text-[10px] text-zinc-500 font-medium truncate">
                        <strong style={{ color: payer?.color }}>{payer?.name}</strong>
                        <span className="font-mono"> · {exp.date}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-sm font-black text-zinc-900 font-mono tabular-nums">{exp.amount.toFixed(2)} €</span>
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
              );
            })}
          </div>
        )}
      </div>

      {typeof document !== 'undefined' && createPortal(
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
              <h3 className="font-extrabold text-base text-zinc-900">Supprimer cette dépense ?</h3>
              <p className="text-[12px] text-zinc-500 font-medium mt-1.5 leading-relaxed">
                « {expenseToDelete.description} » ({expenseToDelete.amount.toFixed(2)} €) sera retirée
                du budget. Les soldes seront recalculés.
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

      {/* Add Expense Modal — Tricount-style */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-[100] bg-zinc-950/45 backdrop-blur-xs flex items-center justify-center p-4 overscroll-none"
          onClick={() => setShowAddModal(false)}
        >
          <div
            data-modal-scroll
            className="w-full max-w-md max-h-[90dvh] overflow-y-auto overscroll-contain bg-white rounded-[2rem] p-5 sm:p-6 shadow-2xl border border-zinc-200 animate-in fade-in zoom-in-95"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-zinc-100 mb-4">
              <div className="min-w-0 flex-1">
                <h3 className="font-extrabold text-base text-zinc-900 leading-snug">Nouvelle dépense</h3>
                <p className="text-[11px] text-zinc-500 font-medium mt-0.5">Nom + prix, comme Tricount</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="touch-target flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-600 -mr-1"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div className="rounded-[1.35rem] bg-zinc-950 text-white p-4 space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Nom de la dépense</span>
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
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Prix</span>
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

                {sharePerPerson > 0 && (
                  <p className="text-[11px] font-semibold text-zinc-400">
                    ≈ {sharePerPerson.toFixed(2)} € / personne · {shareCount} participant{shareCount > 1 ? 's' : ''}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-2">Catégorie</label>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => setCategory(item.id)}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-colors ${
                        category === item.id
                          ? 'bg-zinc-900 text-white'
                          : 'bg-zinc-100 text-zinc-600 ring-1 ring-zinc-200'
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
                          isIncluded
                            ? 'bg-zinc-900 text-white border-zinc-900'
                            : 'bg-zinc-100 text-zinc-500 border-zinc-200'
                        }`}
                      >
                        <span className="flex items-center gap-1.5 min-w-0">
                          <img src={f.avatar} alt="" className="w-5 h-5 rounded-full object-cover shrink-0" />
                          <span className="truncate">{f.id === currentFriendId ? 'Moi' : f.name}</span>
                        </span>
                        {isIncluded && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {formError && (
                <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                  {formError}
                </p>
              )}

              <div className="pt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-3.5 py-3 text-xs font-bold text-zinc-600 hover:bg-zinc-100 rounded-2xl"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-[1.4] px-4 py-3 text-xs font-bold bg-emerald-600 text-white rounded-2xl shadow-xs hover:bg-emerald-500"
                >
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
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
