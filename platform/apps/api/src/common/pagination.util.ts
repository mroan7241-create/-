/** يطابق paginate_ القديم — pageSize محصور [1,100]، افتراضي 25. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function normalizePagination(params: PaginationParams): { page: number; pageSize: number; skip: number; take: number } {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(params.pageSize ?? DEFAULT_PAGE_SIZE)));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function toPaginatedResult<T>(items: T[], total: number, page: number, pageSize: number): PaginatedResult<T> {
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
