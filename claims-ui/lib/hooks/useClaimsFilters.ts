"use client";

import { useQueryState, parseAsString, parseAsInteger } from 'nuqs';
import type { GetClaimsParams } from '@/lib/api';

/**
 * URL-synced filter state for claims list.
 * Converts URL query params to GetClaimsParams and vice versa.
 * Example URL: /claims?status=SETTLED&market_region=UAE&search=CLM&page=2&sort_by=service_date&sort_order=desc&service_date_from=2024-01-01
 */
export function useClaimsFilters() {
  const [status, setStatus] = useQueryState('status', parseAsString.withDefault(''));
  const [market, setMarket] = useQueryState('market_region', parseAsString.withDefault(''));
  const [search, setSearch] = useQueryState('search', parseAsString.withDefault(''));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [sortBy, setSortBy] = useQueryState('sort_by', parseAsString.withDefault('service_date'));
  const [sortOrder, setSortOrder] = useQueryState('sort_order', parseAsString.withDefault('desc'));
  const [serviceDateFrom, setServiceDateFrom] = useQueryState('service_date_from', parseAsString.withDefault(''));
  const [serviceDateTo, setServiceDateTo] = useQueryState('service_date_to', parseAsString.withDefault(''));
  const [receivedDateFrom, setReceivedDateFrom] = useQueryState('received_date_from', parseAsString.withDefault(''));
  const [receivedDateTo, setReceivedDateTo] = useQueryState('received_date_to', parseAsString.withDefault(''));

  const params: GetClaimsParams = {
    status: status || undefined,
    market_region: market || undefined,
    search: search || undefined,
    page: page || 1,
    page_size: 20,
    sort_by: sortBy || 'service_date',
    sort_order: (sortOrder === 'asc' || sortOrder === 'desc') ? sortOrder : 'desc',
    service_date_from: serviceDateFrom || undefined,
    service_date_to: serviceDateTo || undefined,
    received_date_from: receivedDateFrom || undefined,
    received_date_to: receivedDateTo || undefined,
  };

  const updateParams = (partial: Partial<GetClaimsParams>) => {
    if ('status' in partial) setStatus(partial.status || null);
    if ('market_region' in partial) setMarket(partial.market_region || null);
    if ('search' in partial) setSearch(partial.search || null);
    if ('page' in partial) setPage(partial.page || null);
    if ('sort_by' in partial) setSortBy(partial.sort_by || null);
    if ('sort_order' in partial) setSortOrder(partial.sort_order || null);
    if ('service_date_from' in partial) setServiceDateFrom(partial.service_date_from || null);
    if ('service_date_to' in partial) setServiceDateTo(partial.service_date_to || null);
    if ('received_date_from' in partial) setReceivedDateFrom(partial.received_date_from || null);
    if ('received_date_to' in partial) setReceivedDateTo(partial.received_date_to || null);
  };

  return { params, updateParams };
}
