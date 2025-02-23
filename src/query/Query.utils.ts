import { ident, literal } from '@scaleleap/pg-format';
import {
  Dictionary,
  Filter,
  QueryPagination,
  QueryTable,
  Sort,
} from '../types';

export function countQuery(
  table: QueryTable,
  options?: {
    filters?: Filter[];
  }
) {
  let query = `select count(*) from ${queryTable(table)}`;
  const { filters } = options ?? {};
  if (filters) {
    query = applyFilters(query, filters);
  }
  return query + ';';
}

export function deleteQuery(
  table: QueryTable,
  filters?: Filter[],
  options?: {
    returning?: boolean;
  }
) {
  if (!filters || filters.length == 0) {
    throw { message: 'no filters for this delete query' };
  }
  let query = `delete from ${queryTable(table)}`;
  const { returning } = options ?? {};
  if (filters) {
    query = applyFilters(query, filters);
  }
  if (returning) {
    query += ' returning *';
  }
  return query + ';';
}

/**
 * TODO: Need a way to handle Postgres array.
 * Right now, we have no way to detect if a key-value is json or Postgres array.
 * Users would have to format Postgres array into string in advance.
 */
export function insertQuery(
  table: QueryTable,
  value: Dictionary<any>,
  options?: {
    returning?: boolean;
  }
) {
  const { returning } = options ?? {};
  const queryColumns = Object.keys(value)
    .map((x) => ident(x))
    .join(',');
  const queryValues = Object.keys(value)
    .map((key) => literal(value[key]))
    .join(',');
  let query = `
  insert into ${queryTable(table)} (${queryColumns}) 
  values (${queryValues})
  `;
  if (returning) {
    query += ' returning *';
  }
  console.log(query);
  return query + ';';
}

export function selectQuery(
  table: QueryTable,
  columns?: string[],
  options?: {
    filters?: Filter[];
    pagination?: QueryPagination;
    sorts?: Sort[];
  }
) {
  let query = '';
  const queryColumn = columns?.map((x) => ident(x)).join(', ') ?? '*';
  query += `select ${queryColumn} from ${queryTable(table)}`;

  const { filters, pagination, sorts } = options ?? {};
  if (filters) {
    query = applyFilters(query, filters);
  }
  if (sorts) {
    query = applySorts(query, sorts);
  }
  if (pagination) {
    const { limit, offset } = pagination ?? {};
    query += ` limit ${literal(limit)} offset ${literal(offset)}`;
  }
  return query + ';';
}

export function updateQuery(
  table: QueryTable,
  value: Dictionary<any>,
  options?: {
    filters?: Filter[];
    returning?: boolean;
  }
) {
  const { filters, returning } = options ?? {};
  if (!filters || filters.length == 0) {
    throw { message: 'no filters for this update query' };
  }
  const queryColumns = Object.keys(value)
    .map((x) => ident(x))
    .join(',');
  let query = `
  update ${queryTable(table)} set (${queryColumns}) = 
  (
    select * from 
    json_populate_record(
      null::${queryTable(table)}, ${literal(JSON.stringify(value))}
    )
  )
  `;
  if (filters) {
    query = applyFilters(query, filters);
  }
  if (returning) {
    query += ' returning *';
  }
  return query + ';';
}

//============================================================
// Filter Utils
//============================================================

function applyFilters(query: string, filters: Filter[]) {
  if (filters.length == 0) return query;
  query += ` where ${filters
    .map((filter) => {
      switch (filter.operator) {
        case 'in':
          return inFilterSql(filter);
        case 'is':
          return isFilterSql(filter);
        default:
          return `${ident(filter.column)} ${filter.operator} ${filterLiteral(
            filter.value
          )}`;
      }
    })
    .join(' and ')}`;
  return query;
}

function inFilterSql(filter: Filter) {
  const values = filter.value.split(',').map((x) => filterLiteral(x.trim()));
  return `${ident(filter.column)} ${filter.operator} (${values.join(',')})`;
}

function isFilterSql(filter: Filter) {
  switch (filter.value) {
    case 'null':
    case 'false':
    case 'true':
    case 'not null':
      return `${ident(filter.column)} ${filter.operator} ${filter.value}`;
    default:
      return `${ident(filter.column)} ${filter.operator} ${filterLiteral(
        filter.value
      )}`;
  }
}

/**
 * Filter value can be string | number
 * However the value receive from input is always string.
 * If it's a number, we have to convert it back to number format.
 */
function filterLiteral(value: string) {
  const maybeNumber = Number(value);
  if (isNaN(maybeNumber)) {
    return literal(value);
  } else {
    return literal(maybeNumber);
  }
}

//============================================================
// Sort Utils
//============================================================

function applySorts(query: string, sorts: Sort[]) {
  if (sorts.length == 0) return query;
  query += ` order by ${sorts
    .map((x) => {
      const order = x.ascending ? 'asc' : 'desc';
      const nullOrder = x.nullsFirst ? 'nulls first' : 'nulls last';
      return `${ident(x.column)} ${order} ${nullOrder}`;
    })
    .join(', ')}`;
  return query;
}

//============================================================
// Misc
//============================================================

function queryTable(table: QueryTable) {
  return `${ident(table.schema)}.${ident(table.name)}`;
}
