/** Keep every loaded row searchable/selectable, but bound the DOM rendered at once. */
export function paginateLogGroups<T extends { key: string; items: unknown[] }>(groups: T[], rowLimit = 150, groupLimit = 20): T[][] {
  const pages: T[][] = [];
  let page: T[] = [], rows = 0;
  for (const group of groups) {
    for (let offset = 0; offset < group.items.length; offset += rowLimit) {
      const items = group.items.slice(offset, offset + rowLimit);
      if (page.length && (rows + items.length > rowLimit || page.length >= groupLimit)) {
        pages.push(page); page = []; rows = 0;
      }
      page.push(group.items.length <= rowLimit ? group : { ...group, key: `${group.key}|part:${offset}`, items });
      rows += items.length;
    }
  }
  if (page.length) pages.push(page);
  return pages;
}
