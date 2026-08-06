import { Expense, Friend, SplitDetail, SplitType } from '../types';
import { CREW_MEMBER_NAMES, getStoredCrewUserMap } from '../services/supabase';
import { buildLegacyIdMap, remapFriendId } from './legacyIds';

export function buildFriendIdResolver(friends: Friend[]) {
  const byId = new Set(friends.map((friend) => friend.id));
  const byName = new Map(friends.map((friend) => [friend.name.trim().toLowerCase(), friend.id]));
  const legacyMap = buildLegacyIdMap(friends, getStoredCrewUserMap());

  return (rawId: string | undefined): string | undefined => {
    if (!rawId) return undefined;
    if (byId.has(rawId)) return rawId;

    const fromLegacy = remapFriendId(rawId, legacyMap, byId);
    if (fromLegacy && byId.has(fromLegacy)) return fromLegacy;

    for (const name of CREW_MEMBER_NAMES) {
      if (name.toLowerCase() === rawId.trim().toLowerCase()) {
        const mapped = getStoredCrewUserMap()[name];
        if (mapped && byId.has(mapped)) return mapped;
      }
    }

    const fromName = byName.get(rawId.trim().toLowerCase());
    if (fromName) return fromName;

    return undefined;
  };
}

export function normalizeExpenseForFriends(expense: Expense, friends: Friend[]): Expense {
  const resolve = buildFriendIdResolver(friends);
  const friendIds = friends.map((friend) => friend.id);
  const paidBy =
    resolve(expense.paidByFriendId) ??
    (friendIds.includes(expense.paidByFriendId) ? expense.paidByFriendId : undefined) ??
    expense.paidByFriendId;

  // Never invent "all crew" when splits are missing — keep empty and skip in balances.
  const hadExplicitParticipants = Boolean(expense.splitAmongFriendIds?.length);
  const participantSource = hadExplicitParticipants
    ? expense.splitAmongFriendIds
    : [];

  const splitAmongFriendIds = participantSource
    .map((id) => resolve(id))
    .filter((id): id is string => Boolean(id))
    .filter((id, index, arr) => arr.indexOf(id) === index);

  const splitDetails = expense.splitDetails?.map(
    (detail): SplitDetail => ({
      ...detail,
      friendId: resolve(detail.friendId) ?? detail.friendId,
    })
  );

  return {
    ...expense,
    paidByFriendId: paidBy,
    splitAmongFriendIds,
    splitDetails,
  };
}

export function normalizeExpensesForFriends(expenses: Expense[], friends: Friend[]): Expense[] {
  if (!friends.length) return expenses;
  return expenses.map((expense) => normalizeExpenseForFriends(expense, friends));
}

export const CURRENCIES = [
  { code: 'EUR', symbol: '€', label: 'Euro' },
  { code: 'USD', symbol: '$', label: 'Dollar US' },
  { code: 'GBP', symbol: '£', label: 'Livre sterling' },
  { code: 'CHF', symbol: 'CHF', label: 'Franc suisse' },
  { code: 'CAD', symbol: 'CA$', label: 'Dollar canadien' },
  { code: 'MAD', symbol: 'MAD', label: 'Dirham marocain' },
] as const;

export function currencySymbol(code?: string) {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? '€';
}

export function formatMoney(value: number, currency = 'EUR') {
  const symbol = currencySymbol(currency);
  const formatted = value.toFixed(2);
  if (symbol.length > 2) return `${formatted} ${symbol}`;
  return `${formatted} ${symbol}`;
}

export function parseAmount(raw: string) {
  const normalized = raw.replace(/\s/g, '').replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? value : NaN;
}

function distributeWithWeights(
  total: number,
  ids: string[],
  weightOf: (id: string) => number
): Record<string, number> {
  if (!ids.length) return {};
  const weights = ids.map((id) => ({ id, w: Math.max(0, weightOf(id)) }));
  const totalWeight = weights.reduce((sum, item) => sum + item.w, 0);
  if (totalWeight <= 0) {
    const equal = distributeEqual(total, ids);
    return equal;
  }

  const raw = weights.map(({ id, w }) => ({ id, amount: (total * w) / totalWeight }));
  const floored = raw.map((item) => ({
    id: item.id,
    amount: Math.floor(item.amount * 100) / 100,
  }));
  let remainderCents = Math.round((total - floored.reduce((sum, item) => sum + item.amount, 0)) * 100);
  const byFrac = raw
    .map((item, index) => ({
      index,
      frac: item.amount - floored[index].amount,
    }))
    .sort((a, b) => b.frac - a.frac);

  for (let i = 0; remainderCents > 0 && i < byFrac.length; i += 1) {
    floored[byFrac[i].index].amount += 0.01;
    remainderCents -= 1;
  }

  return Object.fromEntries(floored.map((item) => [item.id, Number(item.amount.toFixed(2))]));
}

export function distributeEqual(total: number, ids: string[]): Record<string, number> {
  return distributeWithWeights(total, ids, () => 1);
}

export function getParticipants(expense: Pick<Expense, 'splitAmongFriendIds'>, _allFriendIds: string[]) {
  return expense.splitAmongFriendIds?.length ? expense.splitAmongFriendIds : [];
}

export function getParticipantAmounts(
  expense: Pick<Expense, 'amount' | 'splitType' | 'splitDetails' | 'splitAmongFriendIds'>,
  allFriendIds: string[]
): Record<string, number> {
  const participants = getParticipants(expense, allFriendIds);
  if (!participants.length) return {};

  const splitType: SplitType = expense.splitType ?? 'equal';
  const details = expense.splitDetails ?? [];

  if (splitType === 'custom') {
    const result: Record<string, number> = {};
    participants.forEach((id) => {
      const detail = details.find((d) => d.friendId === id);
      result[id] = detail?.amount ?? 0;
    });
    return result;
  }

  if (splitType === 'shares') {
    return distributeWithWeights(expense.amount, participants, (id) => {
      const detail = details.find((d) => d.friendId === id);
      return detail?.shares ?? 1;
    });
  }

  return distributeEqual(expense.amount, participants);
}

export function computeBalances(expenses: Expense[], friendIds: string[]): Record<string, number> {
  const netBalances: Record<string, number> = {};
  friendIds.forEach((id) => {
    netBalances[id] = 0;
  });

  expenses.forEach((expense) => {
    const participants = getParticipants(expense, friendIds);
    if (!participants.length) return;

    const amounts = getParticipantAmounts(expense, friendIds);
    const payer = expense.paidByFriendId;
    netBalances[payer] = (netBalances[payer] ?? 0) + expense.amount;
    participants.forEach((id) => {
      netBalances[id] = (netBalances[id] ?? 0) - (amounts[id] ?? 0);
    });
  });

  return netBalances;
}

export function buildSplitDetails(
  splitType: SplitType,
  participants: string[],
  total: number,
  shares: Record<string, number>,
  customAmounts: Record<string, number>
): SplitDetail[] {
  if (splitType === 'equal') {
    return participants.map((friendId) => ({ friendId }));
  }
  if (splitType === 'shares') {
    return participants.map((friendId) => ({
      friendId,
      shares: Math.max(1, shares[friendId] ?? 1),
    }));
  }
  const distributed = distributeEqual(total, participants);
  return participants.map((friendId) => ({
    friendId,
    amount: customAmounts[friendId] ?? distributed[friendId] ?? 0,
  }));
}

export function validateCustomSplit(total: number, amounts: Record<string, number>, participants: string[]) {
  const sum = participants.reduce((acc, id) => acc + (amounts[id] ?? 0), 0);
  return Math.abs(sum - total) < 0.02;
}

export function sumCustomAmounts(amounts: Record<string, number>, participants: string[]) {
  return Number(
    participants.reduce((acc, id) => acc + (amounts[id] ?? 0), 0).toFixed(2)
  );
}
