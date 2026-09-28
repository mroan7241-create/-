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
