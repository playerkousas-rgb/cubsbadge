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

  // ---------------------------------------------------------------------------
  // 級別（level）：官方 7 枚活動徽章分初／中／高三級 —— A18、A26、A27、A29、A33、A35、A39。
  // 傳輸／儲存值：'E' 初級、'I' 中級、'A' 高級；'' = 整枚徽章（無級別的舊資料）。
  // 伺服器回傳有級別的紀錄時用後綴鍵（otherBadges[ymis]['A26-E']），舊資料仍然用 'A26'。
  // ---------------------------------------------------------------------------
  const LEVEL_CODES = ['E', 'I', 'A'];
  function normalizeLevelCode(value) {
    if (value === null || value === undefined || value === '') return '';
    const raw = String(value).trim().toUpperCase();
    if (LEVEL_CODES.indexOf(raw) >= 0) return raw;
    const n = Number(value);
    if (Number.isInteger(n) && n >= 1 && n <= 3) return LEVEL_CODES[n - 1];
    const map = {
      '初': 'E', '初級': 'E', 'BASIC': 'E', 'ELEMENTARY': 'E',
      '中': 'I', '中級': 'I', 'INTERMEDIATE': 'I',
      '高': 'A', '高級': 'A', 'ADVANCED': 'A'
    };
    return map[raw] || '';
  }
  function recordLevelCode(record) {
    if (record && typeof record === 'object') {
      const direct = normalizeLevelCode(record.level);
      if (direct) return direct;
      // 舊版把級別藏在備註標記 [CUB_LEVEL=n]（當時未有級別欄）
      const match = /\[CUB_LEVEL=([1-3])\]/.exec(String(record.note || ''));
      if (match) return LEVEL_CODES[Number(match[1]) - 1];
    }
    return '';
  }
  function recordLevel(record) {
    const code = recordLevelCode(record);
    return code ? LEVEL_CODES.indexOf(code) + 1 : 1;
  }
  function levelKey(id, code) { return code ? `${id}-${code}` : String(id); }
  function hasKey(records, key) {
    return !!(records && Object.prototype.hasOwnProperty.call(records, key)
      && records[key] !== null && records[key] !== undefined && records[key] !== '');
  }
  function hasRecord(records, id) {
    if (hasKey(records, id)) return true;
    return LEVEL_CODES.some(code => hasKey(records, `${id}-${code}`));
  }
  // 一枚徽章的各級紀錄：{ E: rec, I: rec, A: rec, '': 整枚徽章 }
  // 無級別但有 [CUB_LEVEL=n] 標記的舊紀錄會歸入對應級別。
  function levelRecords(records, id) {
    const out = {};
    if (!records) return out;
    LEVEL_CODES.forEach(code => { if (hasKey(records, `${id}-${code}`)) out[code] = records[`${id}-${code}`]; });
    if (hasKey(records, id)) {
      const code = recordLevelCode(records[id]);
      if (code) { if (out[code] === undefined) out[code] = records[id]; }
      else out[''] = records[id];
    }
    return out;
  }
  // 最高已取級別（1–3）；無紀錄亦回 1（與舊版 recordLevel 行為一致）。
  function highestLevel(records, id) {
    const recs = levelRecords(records, id);
    return LEVEL_CODES.reduce((max, code) => (recs[code] !== undefined ? Math.max(max, LEVEL_CODES.indexOf(code) + 1) : max), 1);
  }
  function baseBadgeId(id) {
    const match = /^(A\d{2})-(E|I|A)$/.exec(String(id || ''));
    return match ? match[1] : String(id || '');
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
        const level = highestLevel(otherFlat, badge.id);
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
        // 其他獎章：後綴鍵（A26-E）屬於現行目錄，不應誤判為舊版／未知紀錄
        const knownCurrent = isOther ? (currentOtherIds.has(id) || currentOtherIds.has(baseBadgeId(id))) : currentIds.has(id);
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
    LEVEL_CODES, normalizeLevelCode, recordLevelCode, levelKey, levelRecords, highestLevel, baseBadgeId,
    recordDate, recordLevel, hasRecord, completingBadgeIds, isItemComplete,
    getInterestStatus, getBadgeProgress, getOverallProgress,
    buildLegacyIndex, partitionRecords, getPermissionGroups
  };
});
