/* Printable checklists driven entirely by data/items.json. Browser + Node harness. */
(function (root, factory) {
  const progress = typeof module === 'object' && module.exports ? require('./cub-progress.js') : root.CubProgress;
  const api = factory(progress);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CubFormGenerator = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P) {
  'use strict';
  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch])); }
  function lines(value) { return esc(value).replace(/\n/g, '<br>'); }
  function dateOf(record) { return P.recordDate(record); }
  function allDates(flat, ids) { return (ids || []).map(id => dateOf(flat && flat[id])).filter(Boolean).sort(); }
  function rangeText(flat, ids, empty) {
    const dates = allDates(flat, ids);
    if (!dates.length) return empty || '未記錄';
    return dates.length === 1 ? dates[0] : `${dates[0]} 至 ${dates[dates.length - 1]}`;
  }
  function personalValue(label, context) {
    const member = context.member || {};
    if (/^姓名/.test(label)) return member.name || '';
    if (/成員編號|YMIS/i.test(label)) return member.ymis || '';
    if (/所屬單位（旅）|幼童軍團|童軍旅|Unit|Group/i.test(label)) return context.troopName || '';
    if (/所屬單位（區）|童軍區|District/i.test(label)) return member.district || '';
    if (/地域|Region/i.test(label)) return member.region || '';
    if (/出生日期|DOB/i.test(label)) return member.dob || member.birthDate || '';
    if (/年齡|Age/i.test(label)) return member.age || '';
    if (/就讀年級/.test(label)) return member.primaryLevel || '';
    if (/性別/.test(label)) return member.gender || '';
    if (/身份證|護照/.test(label)) return member.idFirst4 || '';
    if (/家長／監護人姓名/.test(label)) return member.guardianName || '';
    if (/家長／監護人關係/.test(label)) return member.guardianRelationship || '';
    if (/家長／監護人聯絡電話/.test(label)) return member.guardianPhone || '';
    if (/家長／監護人電郵/.test(label)) return member.guardianEmail || '';
    if (/負責領袖姓名/.test(label)) return member.leaderName || '';
    if (/負責領袖職位/.test(label)) return member.leaderPosition || '';
    if (/負責領袖聯絡電話/.test(label)) return member.leaderPhone || '';
    if (/負責領袖電郵/.test(label)) return member.leaderEmail || '';
    if (/地址|Address/i.test(label)) return member.address || '';
    if (/電話|Phone/i.test(label)) return member.phone || '';
    return '';
  }
  function fieldRows(fields, context) {
    return (fields || []).map(label => `<tr><th>${esc(label)}</th><td><span class="form-value">${esc(personalValue(label, context))}</span>&nbsp;</td></tr>`).join('');
  }
  function heading(form, context) {
    const code = form.officialCode ? `（${form.officialCode}${form.version ? `　${form.version}` : ''}）` : '';
    const organisation = form.official ? '香港童軍總會　Scout Association of Hong Kong（官方原表填寫核對；本頁不是官方複本）' : 'CubBadge 非官方核對工具（不是香港童軍總會表格）';
    return `<div class="form-heading"><div>${organisation}</div><h1>${esc(form.title)}${esc(code)}</h1><p class="form-notice">${esc(form.notice || '')}</p>${context.member ? `<p><b>${esc(context.member.name || '')}</b>　YMIS：${esc(context.member.ymis || '')}　${esc(context.troopName || '')}</p>` : ''}</div>`;
  }
  function links(form) {
    const out = [];
    if (form.downloadUrl) out.push(`<a href="${esc(form.downloadUrl)}" target="_blank" rel="noopener noreferrer">下載官方原表／紀錄冊</a>`);
    if (form.sourceUrl) out.push(`<a href="${esc(form.sourceUrl)}" target="_blank" rel="noopener noreferrer">官方依據</a>`);
    if (form.officialIndexUrl) out.push(`<a href="${esc(form.officialIndexUrl)}" target="_blank" rel="noopener noreferrer">總會表格目錄</a>`);
    return out.length ? `<p class="no-print form-links">${out.join('　')}</p>` : '';
  }
  function printButton() { return '<p class="no-print"><button type="button" onclick="window.print()">列印</button></p>'; }
  function wrap(form, context, body) {
    const notes = (form.eligibilityNotes || []).length ? `<div class="form-warning"><b>資格及過渡提示</b><ul>${form.eligibilityNotes.map(note => `<li>${esc(note)}</li>`).join('')}</ul></div>` : '';
    return `<section class="print-area generated-form" id="officialForm" data-form="${esc(context.formKey)}">${heading(form, context)}${notes}${body}${links(form)}${printButton()}</section>`;
  }

  function resolveSource(source, context) {
    const flat = context.flat || {};
    const legacy = context.data.legacyBadges || [];
    if (!source) return '';
    if (source.type === 'badgeDate') {
      const badge = legacy.find(b => b.id === source.badgeId);
      return rangeText(flat, P.getBadgeItemIds(badge), '未記錄');
    }
    if (source.type === 'segmentDate') {
      const badge = legacy.find(b => b.id === source.badgeId);
      const segment = badge && (badge.segments || []).find(s => s.code === source.segmentCode);
      return rangeText(flat, P.getSegmentItemIds(segment), '未記錄');
    }
    if (source.type === 'itemRange') return rangeText(flat, source.itemIds, '未記錄');
    if (source.type === 'itemGroups') {
      return (source.groups || []).map(group => `${group.label}：${rangeText(flat, group.itemIds, '未記錄')}`).join('<br>');
    }
    return '';
  }

  function generateCurrent(context) {
    const form = context.data.forms[context.formKey];
    const badge = P.findBadge(context.data, form.badgeId);
    if (!badge) throw new Error(`Current form badge not found: ${form.badgeId}`);
    const flat = context.flat || {}, otherFlat = context.otherFlat || {};
    const personal = `<h2>個人資料</h2><table class="print-table">${fieldRows(form.personalFields, context)}</table>`;
    const sections = (badge.segments || []).map(segment => {
      if (segment.activityRequirement) {
        const status = P.getInterestStatus(segment, otherFlat, context.data);
        const names = status.completed.map(item => `${item.catalogueNo}. ${item.name}${dateOf(otherFlat[item.id]) ? `（${dateOf(otherFlat[item.id])}）` : ''}`).join('<br>') || '未記錄';
        const allowed = (segment.activityRequirement.allowedBadgeIds || []).map(id => P.findOtherBadge(context.data, id)).filter(Boolean).map(item => `${item.catalogueNo}. ${item.name}`).join('、');
        return `<h2>${esc(segment.part || '')}、興趣範疇</h2><p>${esc(segment.requirement)}</p><table class="print-table"><tr><th>指定活動徽章</th><td>${esc(allowed)}</td></tr><tr><th>已完成指定活動徽章</th><td>${names}</td></tr><tr><th>不同興趣類別</th><td>${status.categories.length} / ${status.needed}　${status.complete ? '符合' : '尚未符合'}</td></tr></table>`;
      }
      const rows = (segment.items || []).map(item => {
        const done = P.isItemComplete(item, flat, otherFlat);
        const linked = P.completingBadgeIds(item).filter(id => P.hasRecord(otherFlat, id)).map(id => P.findOtherBadge(context.data, id)).filter(Boolean);
        const date = dateOf(flat[item.id]) || linked.map(b => dateOf(otherFlat[b.id])).filter(Boolean).sort().pop() || '';
        return `<tr><td><code>${esc(item.id)}</code></td><td><b>${esc(item.name)}</b><br><small>${lines(item.detail || '')}</small>${linked.length ? `<br><small>相關徽章：${esc(linked.map(b => b.name).join('、'))}</small>` : ''}</td><td>${done ? '✓' : '☐'}</td><td>${esc(date)}</td></tr>`;
      }).join('');
      return `<h2>${esc(segment.part || '甲')}、${esc(segment.name)}</h2><table class="print-table"><thead><tr><th>官方項目</th><th>要求</th><th>完成</th><th>日期</th></tr></thead><tbody>${rows}</tbody></table>`;
    }).join('');
    const progress = P.getBadgeProgress(badge, flat, otherFlat, context.data);
    return wrap(form, context, `${personal}<p><b>系統核對：${progress.done}/${progress.total}（${progress.percent}%）</b>。這個百分比只反映系統已記錄資料，不代替官方評核及批核。</p>${sections}<p class="form-warning">不設模擬官方簽署欄：新制指定表格的正式編號、分部及簽署欄須以總會最新公布為準。</p>`);
  }

  function generateLegacyOfficial(context) {
    const form = context.data.forms[context.formKey];
    const sections = (form.sections || []).map(section => {
      let body = '';
      if (section.fields) body = `<table class="print-table">${fieldRows(section.fields, context)}</table>`;
      if (section.extraRows) {
        body += `<table class="print-table">${section.extraRows.map(row => `<tr><th>${esc(row.label)}</th><td>${row.source ? resolveSource(row.source, context) : esc(row.value || '')}&nbsp;</td></tr>`).join('')}</table>`;
      }
      if (section.rows && section.planning) {
        body += `<table class="print-table"><thead><tr><th>項目</th><th>所選擇考驗之內容</th><th>預計開展日期</th><th>預計完成日期</th></tr></thead><tbody>${section.rows.map(row => `<tr><td>${esc(row.label)}</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join('')}</tbody></table>`;
      } else if (section.rows) {
        body += `<table class="print-table"><thead><tr><th>完成之項目</th><th>系統內舊制紀錄日期</th><th>備註</th></tr></thead><tbody>${section.rows.map(row => `<tr><td>${esc(row.label)}</td><td>${resolveSource(row.source, context)}</td><td>&nbsp;</td></tr>`).join('')}</tbody></table>`;
      }
      if (section.blocks) {
        body += `<div class="signature-grid">${section.blocks.map(block => `<section><h3>${esc(block.title)}</h3>${(block.fields || []).map(field => `<p>${esc(field)}：____________________________</p>`).join('')}</section>`).join('')}</div>`;
      }
      return `<h2>（${esc(section.id)}）${esc(section.title)}</h2>${body}`;
    }).join('');
    return wrap(form, context, sections);
  }

  function generateLegacyRecord(context) {
    const form = context.data.forms[context.formKey];
    const body = (form.sections || []).map(section => `<h2>${esc(section.title)}</h2><ul class="record-checklist">${(section.items || []).map(label => `<li>☐ ${esc(label)}　日期／頁碼：________________　核對：________________</li>`).join('')}</ul>`).join('');
    return wrap(form, context, body);
  }

  function generateCertificate(context) {
    const data = context.data;
    const award = P.findBadge(data, context.badgeId) || P.findOtherBadge(data, context.badgeId);
    if (!award) throw new Error(`Certificate award not found: ${context.badgeId}`);
    const isProgressive = !!award.segments;
    const progress = isProgressive ? P.getBadgeProgress(award, context.flat, context.otherFlat, data) : { done: P.hasRecord(context.otherFlat, award.id) ? 1 : 0, total: 1, percent: P.hasRecord(context.otherFlat, award.id) ? 100 : 0 };
    const dates = isProgressive ? allDates(context.flat, P.getBadgeItemIds(award)) : [dateOf(context.otherFlat && context.otherFlat[award.id])].filter(Boolean);
    const completionDate = dates.sort().pop() || '';
    const title = context.lang === 'en' && award.name_en ? award.name_en : award.name;
    const body = `<div class="certificate"><p>${esc(context.troopName || '')}</p><h1>${esc(title)} — 幼童軍完成證書</h1><p>CUB SCOUT ACHIEVEMENT CERTIFICATE</p><p>謹此嘉許</p><h2>${esc(context.member && context.member.name || '')}</h2><p>YMIS：${esc(context.member && context.member.ymis || '')}</p><p>完成 <b>${esc(title)}</b>，特頒此證，以資嘉許。</p><p>系統紀錄：${progress.done}/${progress.total}（${progress.percent}%）</p><div class="signature-grid"><section>簽發日期<br><br>${esc(completionDate || context.today || '')}</section><section>幼童軍團長簽署<br><br>________________</section><section>證書編號<br><br>________________</section></div><small>旅團內部完成證書，不是總會正式獎章證書；金紫荊獎章正式證書以總會簽發為準。</small></div>`;
    return `<section class="print-area generated-form" id="officialForm" data-form="CERTIFICATE">${body}${printButton()}</section>`;
  }

  function generate(formKey, context) {
    const ctx = { ...context, formKey, data: context.data, flat: context.flat || {}, otherFlat: context.otherFlat || {} };
    if (!ctx.data || !ctx.data.forms) throw new Error('items.json forms data is required');
    if (formKey === 'CERTIFICATE') return generateCertificate(ctx);
    const form = ctx.data.forms[formKey];
    if (!form) throw new Error(`Unknown form: ${formKey}`);
    if (form.kind === 'current-checklist') return generateCurrent(ctx);
    if (form.kind === 'legacy-official-checklist') return generateLegacyOfficial(ctx);
    if (form.kind === 'legacy-record-checklist') return generateLegacyRecord(ctx);
    throw new Error(`Unsupported form kind: ${form.kind}`);
  }

  return { generate, resolveSource, rangeText, _private: { esc, personalValue } };
});
