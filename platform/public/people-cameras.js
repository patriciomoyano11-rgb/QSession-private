(function (root) {
  'use strict';

  const PAGE_SIZE = 6;

  function createPager() {
    let selected = [];
    let page = 0;
    let signature = '';

    return {
      update(ids, {next = false, pinned = []} = {}) {
        const available = [...new Set(ids)];
        const availableSet = new Set(available);
        const pinnedIds = [...new Set(pinned)].filter(id => availableSet.has(id)).slice(0, PAGE_SIZE);
        const pinnedSet = new Set(pinnedIds);
        const pageable = available.filter(id => !pinnedSet.has(id));
        const capacity = Math.max(0, PAGE_SIZE - pinnedIds.length);
        const nextSignature = JSON.stringify([available, pinnedIds]);
        const pageCount = capacity ? Math.max(1, Math.ceil(pageable.length / capacity)) : 1;

        if (nextSignature !== signature) {
          page = 0;
          signature = nextSignature;
        } else if (next && pageCount > 1) {
          page = (page + 1) % pageCount;
        }

        const start = page * capacity;
        selected = [...pinnedIds, ...pageable.slice(start, start + capacity)];
        return [...selected];
      },
      reset() { selected = []; page = 0; signature = ''; },
    };
  }

  const api = {PAGE_SIZE, createPager};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QSessionPeopleCameras = api;
})(typeof window !== 'undefined' ? window : globalThis);
