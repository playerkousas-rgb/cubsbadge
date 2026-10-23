/* Shared, data-driven Cub Scout progress rules. Browser: window.CubProgress; Node: require(). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function leafItems(badge) {
    const out = [];
    for (const segment of badge && badge.segments || []) {
      for (const item of segment.items || []) {
        if (item.subItems && item.subItems.length) out.push(...item.subItems);
        else out.push(item);
      }
    }
    return out;
  }

  function getBadgeItemIds(badge) { return leafItems(badge).map(item => item.id); }
  function getAllItemIds(data) { return (data && data.badges || []).flatMap(getBadgeItemIds); }
  function getSegmentItemIds(segment) {
    return (segment && segment.items || []).flatMap(item => item.subItems && item.subItems.length ? item.subItems.map(sub => sub.id) : [item.id]);
  }
  function findBadge(data, id) { return (data && data.badges || []).find(badge => badge.id === id); }
  function findLegacyBadge(data, id) { return (data && data.legacyBadges || []).find(badge => badge.id === id); }
  function findOtherBadge(data, id) { return (data && data.otherBadges || []).find(badge => badge.id === id); }
  function findLegacyOtherBadge(data, id) { return (data && data.legacyOtherBadges || []).find(badge => badge.id === id); }
  function recordDate(record) { return record && typeof record === 'object' ? record.date || '' : record || ''; }
  function recordLevel(record) {
    if (record && typeof record === 'object') {
      const direct = Number(record.level);
      if (Number.isInteger(direct) && direct >= 1 && direct <= 3) return direct;
      const match = /\[CUB_LEVEL=([1-3])\]/.exec(String(record.note || ''));
      if (match) return Number(match[1]);
    }
    return 1;
  }
  function hasRecord(records, id) {
    return !!(records && Object.prototype.hasOwnProperty.call(records, id) && records[id] !== null && records[id] !== undefined && records[id] !== '');
  }

  function completingBadgeIds(item) {
    const ids = [];
    if (item.requiredBadgeId) ids.push(item.requiredBadgeId);
    if (Array.isArray(item.alternativeBadgeIds)) ids.push(...item.alternativeBadgeIds);
    return [...new Set(ids)];
  }

  function isItemComplete(item, flat, otherFlat) {
    if (hasRecord(flat, item.id)) return true;
    return completingBadgeIds(item).some(id => hasRecord(otherFlat, id));
  }

  function getInterestStatus(segment, otherFlat, data) {
    const requirement = segment && segment.activityRequirement;
    if (!requirement) return null;
    const allowed = new Set(requirement.allowedBadgeIds || []);
    const stageMatch = /^P([2-4])(?:-|$)/.exec(String(segment && segment.code || ''));
    const stage = stageMatch ? `P${stageMatch[1]}` : '';
    const eligible = (data && data.otherBadges || []).filter(badge => allowed.has(badge.id) && hasRecord(otherFlat, badge.id));
    const stages = (data && data.badges || []).filter(badge => /^P[2-4]$/.test(badge.id)).sort((a,b) => a.id.localeCompare(b.id));
    const completed = [], excluded = [];
    eligible.forEach(badge => {
      let useHere = true, reason = '';
      if (stage) {
        const allowedStages = stages.filter(candidate => (candidate.segments || []).some(candidateSegment => {
          const candidateRequirement = candidateSegment.activityRequirement;
          return candidateRequirement && (candidateRequirement.allowedBadgeIds || []).includes(badge.id);
        })).map(candidate => candidate.id);
        const stageIndex = allowedStages.indexOf(stage);
        const level = recordLevel(otherFlat[badge.id]);
        const uses = badge.levels ? Math.min(level, allowedStages.length) : 1;
        useHere = stageIndex >= 0 && stageIndex < uses;
        if (!useHere) reason = badge.levels
          ? '此級別已在較早階段使用；須考取更高級別或選其他徽章。'
          : '此徽章已在較早階段使用，不可重複計算。';
      }
      if (useHere) completed.push(badge);
      else excluded.push({ badge, reason });
    });
    const categories = [...new Set(completed.map(badge => badge.category))];
    const needed = requirement.distinctCategories || 2;
    return {
      done: categories.length >= needed ? 1 : 0,
      total: 1,
      complete: categories.length >= needed,
      categories,
      needed,
      eligible,
      completed,
      excluded,
      missing: Math.max(0, needed - categories.length)
    };
  }

  function getBadgeProgress(badge, flat, otherFlat, data) {
    const items = leafItems(badge || {});
    let done = items.filter(item => isItemComplete(item, flat, otherFlat)).length;
    let total = items.length;
    const interests = [];
    for (const segment of badge && badge.segments || []) {
      const status = getInterestStatus(segment, otherFlat, data);
      if (status) { interests.push(status); done += status.done; total += status.total; }
    }
    return { done, total, percent: total ? Math.round(done / total * 100) : 0, interests };
  }

  function getOverallProgress(data, flat, otherFlat) {
    let done = 0, total = 0;
    for (const badge of data && data.badges || []) {
      const progress = getBadgeProgress(badge, flat, otherFlat, data);
      done += progress.done; total += progress.total;
    }
    return { done, total, percent: total ? Math.round(done / total * 100) : 0 };
  }

  function buildLegacyIndex(data) {
    const index = new Map();
    for (const badge of data && data.legacyBadges || []) {
      index.set(badge.id, { id: badge.id, name: badge.name, badge: badge.name, kind: 'badge' });
      for (const segment of badge.segments || []) {
        index.set(segment.code, { id: segment.code, name: segment.name, badge: badge.name, kind: 'segment' });
        for (const item of leafItems({ segments: [segment] })) {
          index.set(item.id, { id: item.id, name: item.name, badge: badge.name, kind: 'item' });
        }
      }
    }
    for (const badge of data && data.legacyOtherBadges || []) {
      index.set(badge.id, { id: badge.id, name: badge.name, badge: '舊制活動徽章及其他獎章', kind: 'other' });
    }
    for (const row of data && data.legacyTransition && data.legacyTransition.quickTransfers || []) {
      index.set(row.recordId, { id: row.recordId, name: row.label || `${row.old} → ${row.new}`, badge: '2026過渡等同紀錄', kind: 'transition' });
    }
    return index;
  }

  function partitionRecords(data, flat, otherFlat) {
    const currentIds = new Set(getAllItemIds(data));
    const currentOtherIds = new Set((data && data.otherBadges || []).map(badge => badge.id));
    const legacyIndex = buildLegacyIndex(data);
    const current = [], legacy = [], unknown = [];
    const visit = (records, isOther) => {
      for (const [id, value] of Object.entries(records || {})) {
        const knownCurrent = isOther ? currentOtherIds.has(id) : currentIds.has(id);
        const row = { id, value, date: recordDate(value), isOther, label: '舊版紀錄／不計完成度' };
        if (knownCurrent) current.push(row);
        else if (legacyIndex.has(id) || /^(?:L\d|ACT[-_]|LEGACY-CUB-)/.test(id)) legacy.push({ ...row, ...(legacyIndex.get(id) || { name: id, badge: '舊制' }) });
        else unknown.push({ ...row, name: id, badge: '未能識別的紀錄', label: '舊版／未知紀錄／不計完成度' });
      }
    };
    visit(flat, false); visit(otherFlat, true);
    return { current, legacy, unknown };
  }

  function getPermissionGroups(data) {
    return [
      ...(data && data.badges || []).map(badge => ({ id: badge.id, name: badge.name, name_en: badge.name_en, icon: badge.icon, kind: 'progressive' })),
      ...(data && data.otherBadges && data.otherBadges.length ? [{ id: 'ACT', name: '活動徽章及其他徽章', name_en: 'Activity and other badges', icon: '⭐', kind: 'other' }] : [])
    ];
  }

  return {
    leafItems, getBadgeItemIds, getAllItemIds, getSegmentItemIds,
    findBadge, findLegacyBadge, findOtherBadge, findLegacyOtherBadge,
    recordDate, recordLevel, hasRecord, completingBadgeIds, isItemComplete,
    getInterestStatus, getBadgeProgress, getOverallProgress,
    buildLegacyIndex, partitionRecords, getPermissionGroups
  };
});
