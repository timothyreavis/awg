export interface BudgetedSection<T> {
  section: string;
  items: T[];
  omitted: number;
}

export function charBudget(flagsBudget: number | undefined): number | undefined {
  if (flagsBudget === undefined || !Number.isFinite(flagsBudget) || flagsBudget <= 0) return undefined;
  return Math.max(200, Math.floor(flagsBudget));
}

export function budgetSections<T>(
  sections: Array<{ section: string; items: T[] }>,
  budget: number | undefined,
  renderItem: (item: T) => string
): Array<BudgetedSection<T>> {
  if (!budget) return sections.map((section) => ({ ...section, omitted: 0 }));
  let used = 0;
  return sections.map((section) => {
    const kept: T[] = [];
    for (const item of section.items) {
      const cost = Math.max(24, renderItem(item).length, JSON.stringify(item).length);
      if (used + cost > budget) break;
      kept.push(item);
      used += cost;
    }
    return { section: section.section, items: kept, omitted: section.items.length - kept.length };
  });
}

export function truncateText(value: string, max = 180): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}...`;
}
