export async function fetchPagedItems<T>(
  fetchPage: (page: number) => Promise<{ items: T[]; totalPages: number }>,
  concurrency = 4,
): Promise<T[]> {
  const first = await fetchPage(1);
  const totalPages = Math.max(1, first.totalPages);
  if (totalPages === 1) return first.items;

  const pages: T[][] = new Array(totalPages - 1);
  let nextPage = 2;
  await Promise.all(Array.from({ length: Math.min(concurrency, totalPages - 1) }, async () => {
    while (nextPage <= totalPages) {
      const page = nextPage++;
      pages[page - 2] = (await fetchPage(page)).items;
    }
  }));
  return [first.items, ...pages].flat();
}

/** Small actions read affected records; large batches use existing paged reads, returning only affected records. */
export async function fetchAffectedItems<T extends { id: string }>(ids: readonly string[], fetchItem: (id: string) => Promise<T>, fetchAll?: () => Promise<T[]>): Promise<T[]> {
  const unique = [...new Set(ids)];
  if (unique.length > 8 && fetchAll) {
    const byId = new Map((await fetchAll()).map((item) => [item.id, item]));
    return unique.map((id) => {
      const item = byId.get(id);
      if (!item) throw new Error('تعذّر تحديث جميع الطلبات المتأثرة؛ حدّث القائمة.');
      return item;
    });
  }
  const items: T[] = new Array(unique.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, unique.length) }, async () => {
    while (next < unique.length) {
      const index = next++;
      items[index] = await fetchItem(unique[index]);
    }
  }));
  return items;
}
