// app.js — 정리기 화면. 계산은 clean.js 가 하고, 이 파일은 보여 주고 받기만 한다.
// 서버로 무엇을 보내는 코드가 없다. 같은 사이트의 rules/ 처방 파일을 «읽기»만 한다.
(function () {
  'use strict';
  const C = window.Cleaner;
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR') : esc(n));

  const state = { fileName: '', base: '', sheet: null, table: null, rules: null, result: null };

  function show(el, on) { el.classList.toggle('hidden', !on); }
  function fact(k, v, cls) { return `<div class="fact ${cls || ''}"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`; }
  function table(head, rows, opt) {
    const o = opt || {};
    const th = head.map((h) => `<th>${esc(h)}</th>`).join('');
    const tr = rows.map((r, i) => {
      const cls = o.rowClass ? o.rowClass(r, i) : '';
      return `<tr class="${cls}">${r.map((v, j) => `<td class="${o.numCols && o.numCols.includes(j) ? 'num-cell' : ''}">${o.html && o.html.includes(j) ? v : esc(v)}</td>`).join('')}</tr>`;
    }).join('');
    return `<div class="tablewrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
  }
  function error(el, msg) { el.innerHTML = `<div class="err">${esc(msg)}</div>`; show(el, true); }

  // ---------- 1. 파일 넣기 ----------
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });
  // 화면 아무 데나 떨어뜨려도 브라우저가 파일을 열어 버리지 않게 막는다.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  $('#file-input').addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); e.target.value = ''; });

  async function loadFile(file) {
    resetFrom('rules');
    state.fileName = file.name;
    state.base = file.name.replace(/\.[^.]+$/, '');
    const info = $('#file-info');
    try {
      state.buf = await file.arrayBuffer();
      const wb = C.readWorkbook(XLSX, state.buf);
      state.sheet = wb;
      state.table = wb.table;
      renderFileInfo();
    } catch (err) {
      error(info, `파일을 읽지 못했습니다: ${err.message}`);
      return;
    }
    await findRules();
  }

  function renderFileInfo(sheetNote) {
    const t = state.table;
    const wb = state.sheet;
    const notes = [];
    if (wb.sheetNames.length > 1) notes.push(`시트가 ${wb.sheetNames.length}개입니다 (${wb.sheetNames.join(', ')}). «${wb.sheetName}» 시트를 봅니다.`);
    if (sheetNote) notes.push(sheetNote);
    if (t.blankRows) notes.push(`빈 줄 ${t.blankRows}개는 건너뜁니다.`);
    if (t.wideRows && t.wideRows.length) notes.push(`헤더보다 칸이 많은 행이 ${t.wideRows.length}개 있습니다 (${t.wideRows.slice(0, 5).join(', ')}행…). 넘치는 칸은 보지 않습니다.`);
    const info = $('#file-info');
    info.innerHTML = `
      <div class="facts">
        ${fact('파일', `<span class="small">${esc(state.fileName)}</span>`)}
        ${fact('줄 수 (헤더 빼고)', fmt(t.rows.length))}
        ${fact('칸 수', fmt(t.header.length))}
      </div>
      <div class="chips">${t.header.map((h) => `<span class="chip">${esc(h)}</span>`).join('')}</div>
      ${notes.map((n) => `<p class="muted small">${esc(n)}</p>`).join('')}`;
    show(info, true);
  }

  // ---------- 2. 처방 ----------
  async function findRules() {
    show($('#step-rules'), true);
    const want = `${state.base}.json`;
    let why = '';
    try {
      const list = await (await fetch('rules/목록.json', { cache: 'no-store' })).json();
      const name = (list.처방_파일 || []).find((f) => f === want);
      if (name) {
        const res = await fetch(`rules/${encodeURIComponent(name)}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`rules/${name}을 읽지 못했습니다 (${res.status})`);
        useRules(await res.json(), `rules/${name}`);
        return;
      }
      why = `rules/ 폴더에 «${want}»가 없습니다. 이 사이트에 있는 처방: ${(list.처방_파일 || []).join(', ') || '없음'}`;
    } catch (err) {
      why = `rules/ 폴더를 읽지 못했습니다 (${err.message}). 이 화면을 파일로 바로 열었다면 처방 파일을 직접 골라 주세요.`;
    }
    $('#rules-missing-why').textContent = why;
    show($('#rules-missing'), true);
    show($('#rules-view'), false);
  }

  $('#rules-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      useRules(JSON.parse(await f.text()), f.name);
    } catch (err) {
      error($('#rules-view'), `처방 파일을 읽지 못했습니다: ${err.message}`);
    }
  });

  function useRules(rules, from) {
    resetFrom('clean');
    const view = $('#rules-view');
    if (rules.시트 && state.sheet.sheetNames.includes(rules.시트) && rules.시트 !== state.sheet.sheetName) {
      // 처방이 가리키는 시트로 다시 읽는다.
      state.sheet = C.readWorkbook(XLSX, state.buf, rules.시트);
      state.table = state.sheet.table;
      renderFileInfo(`처방에 적힌 «${rules.시트}» 시트로 다시 읽었습니다.`);
    }
    const problems = C.checkRules(rules, state.table.header);
    if (problems.length) {
      error(view, `이 처방 파일(${from})은 이 엑셀에 쓸 수 없습니다.\n- ${problems.join('\n- ')}`);
      show($('#rules-missing'), true);
      $('#rules-missing-why').textContent = '다른 처방 파일을 골라 주세요.';
      return;
    }
    state.rules = rules;
    show($('#rules-missing'), false);
    const order = rules.처리_순서 || rules.처방.map((r) => r.id);
    const rows = order.map((id, i) => {
      const r = rules.처방.find((x) => x.id === id);
      return [i + 1, r.id, (r.칸 || []).join(', '), r.do || '', r.why || '', r.owner || rules.owner || ''];
    });
    view.innerHTML = `
      <p class="muted">처방 파일: <strong>${esc(from)}</strong>${rules.owner ? ` · 정한 사람 ${esc(rules.owner)}` : ''}${rules.정한_날 ? ` · ${esc(rules.정한_날)}` : ''}</p>
      <p class="muted small">위에서부터 차례로 적용합니다. 모르는 값은 고치지 않고 «${esc(rules.표시_칸 || '_표시')}» 칸에 까닭을 적습니다.</p>
      ${table(['순서', '처방', '보는 칸', '하는 일', '이유', '정한 사람'], rows)}
      ${(rules.확인_필요 || []).length ? `<div class="warn">아직 정하지 않은 것이 ${rules.확인_필요.length}개 있습니다. 그 부분은 고치지 않습니다.</div>` : ''}`;
    show(view, true);
    show($('#step-clean'), true);
  }

  // ---------- 3. 정리 ----------
  $('#run').addEventListener('click', () => {
    const out = $('#result');
    let res;
    let twice;
    try {
      res = C.clean(state.table, state.rules);
      twice = C.sameTwice(res, state.rules);
    } catch (err) {
      error(out, `정리하지 못했습니다:\n${err.message}`);
      return;
    }
    state.result = res;
    const s = res.stats;
    const flagIdx = res.header.length - 1;
    const ruleRows = Object.entries(s.처방별).map(([id, c]) => [id, c.고침, c.지움, c.표시]);
    const notes = Object.entries(s.기준값).flatMap(([id, list]) => list.map((n) =>
      `${id} · ${n.칸}: 숫자 ${fmt(n.개수)}개로 Q1 ${fmt(n.Q1)}, Q3 ${fmt(n.Q3)} → 경계 ${fmt(n.아래_경계)} ~ ${fmt(n.위_경계)}`));
    const byKind = (k) => res.log.filter((e) => e.종류 === k);
    const logTable = (list) => table(['원본 행', '관리번호', '칸', '원래 값', '바뀐 값', '처방', '내용'],
      list.map((e) => [e.행, e.ID, e.칸, e.원래, e.바뀐, e.처방, e.내용]), { numCols: [0] });
    const flagged = res.rows.filter((r) => r.cells[flagIdx]);

    out.innerHTML = `
      <div class="facts">
        ${fact('행 (전 → 후)', `${fmt(s.전)} → ${fmt(s.후)}`)}
        ${fact('지운 행', fmt(s.지운_행))}
        ${fact('고친 값', fmt(s.고친_값))}
        ${fact('표시한 행', fmt(s.표시한_행))}
        ${fact('두 번 돌려도 같은 결과', twice.same ? '예 ✓' : '아니요 ✗', twice.same ? 'ok' : 'bad')}
      </div>
      ${twice.same ? '' : `<div class="err">정리본을 한 번 더 정리하면 결과가 달라집니다 (고친 값 ${twice.again.stats.고친_값}, 지운 행 ${twice.again.stats.지운_행}). 처방끼리 부딪히는지 확인이 필요합니다.</div>`}
      <h3>처방별</h3>
      ${table(['처방', '고침', '지움', '표시'], ruleRows, { numCols: [1, 2, 3] })}
      ${notes.map((n) => `<p class="muted small">${esc(n)}</p>`).join('')}
      <details><summary>지운 행 ${fmt(byKind('지움').length)}</summary>${logTable(byKind('지움'))}</details>
      <details><summary>고친 값 ${fmt(byKind('고침').length)}</summary>${logTable(byKind('고침'))}</details>
      <details><summary>표시한 행 ${fmt(flagged.length)} (표시 ${fmt(s.표시_수)}건)</summary>
        ${table(['원본 행'].concat(res.header), flagged.map((r) => [r.n].concat(r.cells.map(C.show))), { numCols: [0] })}
      </details>
      <details><summary>정리본 미리보기 (${fmt(res.rows.length)}행)</summary>
        ${table(['원본 행'].concat(res.header), res.rows.map((r) => [r.n].concat(r.cells.map(C.show))), { numCols: [0], rowClass: (r) => (r[r.length - 1] ? 'flagged' : '') })}
      </details>`;
    show(out, true);
    show($('#step-download'), true);
    show($('#step-compare'), true);
    show($('#compare'), false);
  });

  // ---------- 4. 내려받기 ----------
  function saveXlsx(sheetName, header, rows, fileName) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, C.tableToSheet(XLSX, header, rows), sheetName);
    XLSX.writeFile(wb, fileName, { compression: true });
  }
  function saveText(text, fileName) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const cleanRows = () => state.result.rows.map((r) => r.cells);
  const logRows = () => C.logRows(state.result.log);
  $('#dl-clean-xlsx').addEventListener('click', () => saveXlsx('정리본', state.result.header, cleanRows(), `${state.base}_정리본.xlsx`));
  $('#dl-clean-csv').addEventListener('click', () => saveText(C.toCsv(state.result.header, cleanRows()), `${state.base}_정리본.csv`));
  $('#dl-log-xlsx').addEventListener('click', () => saveXlsx('바꾼기록', C.LOG_HEADER, logRows(), `${state.base}_바꾼기록.xlsx`));
  $('#dl-log-csv').addEventListener('click', () => saveText(C.toCsv(C.LOG_HEADER, logRows()), `${state.base}_바꾼기록.csv`));

  // ---------- 5. 정답과 대조 ----------
  $('#answer-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const out = $('#compare');
    let cmp;
    try {
      const ans = C.readWorkbook(XLSX, await f.arrayBuffer());
      cmp = C.compare(state.result, ans.table, state.rules);
    } catch (err) {
      error(out, `정답 파일을 읽지 못했습니다: ${err.message}`);
      return;
    }
    const allOk = cmp.어긋난_칸.length === 0 && cmp.정답에만.length === 0 && cmp.정리본에만.length === 0;
    const extra = [];
    if (cmp.정답에만.length) extra.push(`정답에만 있는 행 ${cmp.정답에만.length}: ${cmp.정답에만.slice(0, 20).join(', ')}`);
    if (cmp.정리본에만.length) extra.push(`정리본에만 있는 행 ${cmp.정리본에만.length}: ${cmp.정리본에만.slice(0, 20).join(', ')}`);
    if (cmp.정답에_없는_칸.length) extra.push(`정답에 없어서 비교하지 않은 칸: ${cmp.정답에_없는_칸.join(', ')}`);
    if (cmp.정리본에_없는_칸.length) extra.push(`정리본에 없어서 비교하지 않은 칸: ${cmp.정리본에_없는_칸.join(', ')}`);
    const flagCol = state.rules.표시_칸 || '_표시';
    out.innerHTML = `
      <p class="muted">정답 파일: <strong>${esc(f.name)}</strong> · ${esc(cmp.짝짓는_법)}${cmp.비교한_칸.includes(flagCol) ? ` · «${esc(flagCol)}» 칸은 표시가 있는지만 비교` : ''}</p>
      <div class="facts">
        ${fact('정답 행', fmt(cmp.정답_행))}
        ${fact('정리본 행', fmt(cmp.정리본_행))}
        ${fact('모든 칸 일치', `${fmt(cmp.일치_행)} / ${fmt(cmp.짝지은_행)}`, allOk ? 'ok' : '')}
        ${fact('어긋난 칸', fmt(cmp.어긋난_칸.length), cmp.어긋난_칸.length ? 'bad' : 'ok')}
      </div>
      ${extra.map((x) => `<p class="muted small">${esc(x)}</p>`).join('')}
      ${cmp.어긋난_칸.length ? table(['관리번호', '정리본 행', '정답 행', '칸', '정리본 값', '정답 값'],
        cmp.어긋난_칸.map((d) => [d.ID, d.정리본_행, d.정답_행, d.칸, d.정리본, d.정답]), { numCols: [1, 2] }) : ''}`;
    show(out, true);
  });

  // ---------- 다시 시작 ----------
  function resetFrom(step) {
    if (step === 'rules') {
      state.rules = null;
      show($('#step-rules'), false);
      show($('#rules-missing'), false);
      show($('#rules-view'), false);
    }
    state.result = null;
    show($('#step-clean'), false);
    show($('#result'), false);
    show($('#step-download'), false);
    show($('#step-compare'), false);
    show($('#compare'), false);
  }
})();
