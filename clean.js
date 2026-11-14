// clean.js — 정리 엔진.
// 처방(무엇을 어떻게 고칠지)은 rules/*.json 에만 있다. 이 파일은 처방 파일의 «작업 종류»를 실행하는 방법만 안다.
// 화면(DOM)과 네트워크를 쓰지 않는다. 모든 계산은 브라우저 안에서 한다.
(function (root) {
  'use strict';

  // ---------- 값 ----------
  const pad2 = (n) => String(n).padStart(2, '0');

  class DateVal {
    constructor(y, m, d) { this.y = y; this.m = m; this.d = d; }
    toString() { return `${String(this.y).padStart(4, '0')}-${pad2(this.m)}-${pad2(this.d)}`; }
  }

  const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  const has = (obj, k) => obj != null && Object.prototype.hasOwnProperty.call(obj, k);

  function show(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof DateVal) return v.toString();
    return String(v);
  }
  // 값 비교용 열쇠: 타입까지 같아야 같은 값이다.
  function keyOf(v) {
    if (v === null || v === undefined) return 'n:';
    if (v instanceof DateVal) return 'd:' + v.toString();
    if (typeof v === 'number') return 'x:' + v;
    if (typeof v === 'boolean') return 'b:' + v;
    return 's:' + v;
  }
  const fmtNum = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(n));

  function validDate(y, m, d) {
    if (m < 1 || m > 12 || d < 1) return false;
    return d <= new Date(Date.UTC(2000 + (y % 400), m, 0)).getUTCDate();
  }

  // "YYYY.M.D" 같은 형식 글자를 정규식으로 바꾼다.
  function compileFormat(f) {
    const tok = { YYYY: '(\\d{4})', YY: '(\\d{2})', MM: '(\\d{2})', M: '(\\d{1,2})', DD: '(\\d{2})', D: '(\\d{1,2})' };
    const names = ['YYYY', 'YY', 'MM', 'DD', 'M', 'D'];
    let re = '';
    const order = [];
    for (let i = 0; i < f.length;) {
      const t = names.find((n) => f.startsWith(n, i));
      if (t) { re += tok[t]; order.push(t[0]); i += t.length; }
      else { re += f[i].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); i += 1; }
    }
    return { format: f, re: new RegExp('^' + re + '$'), order };
  }
  function matchFormat(cf, s) {
    const m = cf.re.exec(s);
    if (!m) return null;
    const out = {};
    cf.order.forEach((k, i) => { out[k] = Number(m[i + 1]); });
    return out;
  }

  function quantileInc(sorted, p) {
    const pos = (sorted.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // ---------- 작업 종류 ----------
  // 각 작업은 ctx(행·칸·기록 도구)와 처방 하나를 받는다.
  const OPS = {
    글자_정리(ctx, rule, w) {
      for (const col of rule.칸) {
        ctx.eachCell(col, (row, v) => {
          if (typeof v !== 'string' || isBlank(v)) return;
          let s = v;
          if (w.공백 === '모두_지움') s = s.replace(/\s+/g, '');
          else if (w.공백 === '앞뒤만') s = s.trim();
          for (const t of w.뗄_표기 || []) s = s.split(t).join('');
          s = s.trim();
          if (s === '') { ctx.flag(row, col, rule, '정리하면 빈 값이 되어 그대로 둠'); return; }
          if (s !== v) ctx.change(row, col, s, rule);
        });
      }
    },

    표준값(ctx, rule, w) {
      for (const col of rule.칸) {
        const std = w.표준값 && w.표준값[col];
        const map = (w.바꿈 && w.바꿈[col]) || {};
        const keep = (w.그대로_두고_표시 && w.그대로_두고_표시[col]) || {};
        ctx.eachCell(col, (row, v) => {
          if (isBlank(v)) return;
          const s = show(v);
          if (typeof v === 'string' && has(map, v)) { ctx.change(row, col, map[v], rule); return; }
          if (has(keep, s)) { ctx.flag(row, col, rule, keep[s]); return; }
          if (std && !std.includes(s)) ctx.flag(row, col, rule, `${w.표준값_아님_까닭 || '표준값이 아님'} ('${s}')`);
        });
      }
    },

    숫자로(ctx, rule, w) {
      for (const col of rule.칸) {
        ctx.eachCell(col, (row, v) => {
          if (typeof v !== 'string' || isBlank(v)) return;
          let s = v;
          for (const c of w.지울_글자 || []) s = s.split(c).join('');
          s = s.trim();
          if (/^-?\d+(\.\d+)?$/.test(s)) ctx.change(row, col, Number(s), rule);
          else ctx.flag(row, col, rule, `${w.숫자_아님_까닭 || '숫자가 아님'} ('${v}')`);
        });
      }
    },

    날짜(ctx, rule, w) {
      const fix = (w.고칠_형식 || []).map(compileFormat);
      const flagFmts = Object.entries(w.표시할_형식 || {}).map(([f, why]) => ({ cf: compileFormat(f), why }));
      const yr = w.허용_연도;
      const yearOk = (y) => !yr || (y >= yr[0] && y <= yr[1]);
      for (const col of rule.칸) {
        ctx.eachCell(col, (row, v) => {
          if (isBlank(v)) return;
          if (v instanceof DateVal) {
            if (!yearOk(v.y)) ctx.flag(row, col, rule, `${w.허용_연도_밖_까닭} (${v})`);
            return;
          }
          if (typeof v !== 'string') { ctx.flag(row, col, rule, `${w.모르는_형식_까닭} ('${show(v)}')`); return; }
          const s = v.trim();
          for (const cf of fix) {
            const p = matchFormat(cf, s);
            if (!p) continue;
            if (!validDate(p.Y, p.M, p.D)) ctx.flag(row, col, rule, `${w.없는_날짜_까닭} ('${v}')`);
            else if (!yearOk(p.Y)) ctx.flag(row, col, rule, `${w.허용_연도_밖_까닭} ('${v}')`);
            else ctx.change(row, col, new DateVal(p.Y, p.M, p.D), rule);
            return;
          }
          for (const ff of flagFmts) {
            if (matchFormat(ff.cf, s)) { ctx.flag(row, col, rule, `${ff.why} ('${v}')`); return; }
          }
          ctx.flag(row, col, rule, `${w.모르는_형식_까닭} ('${v}')`);
        });
      }
    },

    중복_지우기(ctx, rule, w) {
      const idIdx = ctx.idx(ctx.rules.ID_칸);
      const cols = ctx.header.map((_, i) => i).filter((i) => !(w.비교 === 'ID_칸_빼고_전부' && i === idIdx));
      const seen = new Map();
      const rows = ctx.alive();
      const order = w.남길_행 === '나중' ? rows.slice().reverse() : rows;
      for (const row of order) {
        const k = cols.map((i) => keyOf(row.cells[i])).join('\u0001');
        if (seen.has(k)) ctx.remove(row, rule, `${seen.get(k).n}행과 내용이 같음`);
        else seen.set(k, row);
      }
      if (w.ID만_같고_내용_다름 === '표시' && idIdx >= 0) {
        const firstById = new Map();
        for (const row of ctx.alive()) {
          const id = keyOf(row.cells[idIdx]);
          if (isBlank(row.cells[idIdx])) continue;
          if (firstById.has(id)) ctx.flag(row, ctx.rules.ID_칸, rule, `${w.ID만_같고_내용_다름_까닭} (${firstById.get(id).n}행)`);
          else firstById.set(id, row);
        }
      }
    },

    튀는값_표시(ctx, rule, w) {
      for (const col of rule.칸) {
        const i = ctx.idx(col);
        const nums = ctx.alive().map((r) => r.cells[i]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
        if (nums.length < 4) continue;
        const q1 = quantileInc(nums, 0.25);
        const q3 = quantileInc(nums, 0.75);
        const k = w.배수 == null ? 1.5 : w.배수;
        const lo = q1 - k * (q3 - q1);
        const hi = q3 + k * (q3 - q1);
        ctx.note(rule, { 칸: col, 개수: nums.length, Q1: q1, Q3: q3, 아래_경계: lo, 위_경계: hi });
        ctx.eachCell(col, (row, v) => {
          if (typeof v !== 'number') return;
          if (w.음수_표시 && v < 0) ctx.flag(row, col, rule, `${w.음수_까닭} (${fmtNum(v)})`);
          if (v < lo || v > hi) ctx.flag(row, col, rule, `${w.범위_밖_까닭} (${fmtNum(v)}, 경계 ${fmtNum(lo)} ~ ${fmtNum(hi)})`);
        });
      }
    },

    조건_확인(ctx, rule, w) {
      for (const row of ctx.alive()) {
        for (const cond of w.조건) {
          const hit = Object.entries(cond.만약).every(([c, st]) => {
            const v = row.cells[ctx.idx(c)];
            return st === '있음' ? !isBlank(v) : isBlank(v);
          });
          if (!hit) continue;
          const when = Object.entries(cond.만약).map(([c, st]) => `${c} ${st}`).join(', ');
          for (const [c, want] of Object.entries(cond.이어야)) {
            const got = show(row.cells[ctx.idx(c)]);
            if (got !== want) ctx.flag(row, c, rule, `[${when}] ${c} '${got}' → '${want}'여야 함`);
          }
          break;
        }
      }
    },
  };

  // ---------- 처방 파일 점검 ----------
  function checkRules(rules, header) {
    const problems = [];
    if (!rules || !Array.isArray(rules.처방)) return ['처방 파일에 «처방» 목록이 없습니다.'];
    const order = rules.처리_순서 || rules.처방.map((r) => r.id);
    for (const id of order) {
      const r = rules.처방.find((x) => x.id === id);
      if (!r) { problems.push(`처리_순서의 «${id}» 처방이 없습니다.`); continue; }
      if (!r.작업 || !OPS[r.작업.종류]) problems.push(`«${id}»의 작업 종류 «${r.작업 && r.작업.종류}»를 정리기가 모릅니다.`);
      for (const c of r.칸 || []) {
        if (c.startsWith('(')) continue;
        if (header && !header.includes(c)) problems.push(`«${id}»가 보는 칸 «${c}»이 파일에 없습니다.`);
      }
    }
    if (header && rules.ID_칸 && !header.includes(rules.ID_칸)) problems.push(`ID 칸 «${rules.ID_칸}»이 파일에 없습니다.`);
    return problems;
  }

  // ---------- 정리 ----------
  // table = { header: [...], rows: [{ n: 엑셀 행 번호, cells: [...] }] }
  function clean(table, rules) {
    const flagCol = rules.표시_칸 || '_표시';
    const keepCols = table.header.map((h, i) => i).filter((i) => table.header[i] !== flagCol);
    const header = keepCols.map((i) => table.header[i]);
    const problems = checkRules(rules, header);
    if (problems.length) throw new Error(problems.join('\n'));

    const rows = table.rows.map((r) => ({
      n: r.n,
      cells: keepCols.map((i) => (r.cells[i] === undefined ? null : r.cells[i])),
      flags: [],
      alive: true,
    }));
    const idIdx = header.indexOf(rules.ID_칸);
    const log = [];
    const perRule = {};
    const notes = {};
    const idOf = (row) => (idIdx >= 0 ? show(row.cells[idIdx]) : '');

    const ctx = {
      rules,
      header,
      idx(col) { const i = header.indexOf(col); if (i < 0) throw new Error(`칸 «${col}»이 없습니다.`); return i; },
      alive: () => rows.filter((r) => r.alive),
      eachCell(col, fn) { const i = this.idx(col); for (const row of rows) if (row.alive) fn(row, row.cells[i]); },
      change(row, col, value, rule) {
        const i = this.idx(col);
        const before = row.cells[i];
        if (keyOf(before) === keyOf(value)) return;
        row.cells[i] = value;
        perRule[rule.id].고침 += 1;
        log.push({ 종류: '고침', 행: row.n, ID: idOf(row), 칸: col, 원래: show(before), 바뀐: show(value), 처방: rule.id, 내용: '', 이유: rule.why });
      },
      remove(row, rule, why) {
        row.alive = false;
        perRule[rule.id].지움 += 1;
        log.push({ 종류: '지움', 행: row.n, ID: idOf(row), 칸: '(행 전체)', 원래: '', 바뀐: '(지움)', 처방: rule.id, 내용: why, 이유: rule.why });
      },
      flag(row, col, rule, why) {
        row.flags.push(`${col}: ${why}`);
        perRule[rule.id].표시 += 1;
        log.push({ 종류: '표시', 행: row.n, ID: idOf(row), 칸: col, 원래: show(row.cells[header.indexOf(col)]), 바뀐: '', 처방: rule.id, 내용: why, 이유: rule.why });
      },
      note(rule, info) { (notes[rule.id] = notes[rule.id] || []).push(info); },
    };

    const order = rules.처리_순서 || rules.처방.map((r) => r.id);
    for (const id of order) {
      const rule = rules.처방.find((r) => r.id === id);
      perRule[id] = { 고침: 0, 지움: 0, 표시: 0 };
      OPS[rule.작업.종류](ctx, rule, rule.작업);
    }

    const out = rows.filter((r) => r.alive);
    return {
      header: header.concat([flagCol]),
      rows: out.map((r) => ({ n: r.n, cells: r.cells.concat([r.flags.join(' / ') || null]) })),
      log,
      stats: {
        전: rows.length,
        후: out.length,
        지운_행: rows.length - out.length,
        고친_값: log.filter((e) => e.종류 === '고침').length,
        표시한_행: out.filter((r) => r.flags.length).length,
        표시_수: out.reduce((s, r) => s + r.flags.length, 0),
        처방별: perRule,
        기준값: notes,
      },
    };
  }

  // 정리본을 한 번 더 정리해서 똑같은지 본다.
  function sameTwice(result, rules) {
    const again = clean({ header: result.header, rows: result.rows }, rules);
    const a = JSON.stringify(result.rows.map((r) => r.cells.map(keyOf)));
    const b = JSON.stringify(again.rows.map((r) => r.cells.map(keyOf)));
    return { same: a === b && again.stats.고친_값 === 0 && again.stats.지운_행 === 0, again };
  }

  // ---------- 엑셀 읽기·쓰기 (SheetJS 를 받아서 쓴다) ----------
  function cellValue(XLSX, cell) {
    if (!cell || cell.t === 'z') return null;
    if (cell.t === 'n') {
      if (cell.z && XLSX.SSF.is_date(cell.z)) {
        const p = XLSX.SSF.parse_date_code(cell.v);
        return new DateVal(p.y, p.m, p.d);
      }
      return cell.v;
    }
    if (cell.t === 'd') {
      const d = cell.v instanceof Date ? cell.v : new Date(cell.v);
      return new DateVal(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
    if (cell.t === 'e') return cell.w || '#오류';
    return cell.v;
  }

  function sheetToTable(XLSX, ws) {
    if (!ws || !ws['!ref']) return { header: [], rows: [], blankRows: 0 };
    const rg = XLSX.utils.decode_range(ws['!ref']);
    const grid = [];
    for (let r = rg.s.r; r <= rg.e.r; r += 1) {
      const cells = [];
      for (let c = rg.s.c; c <= rg.e.c; c += 1) cells.push(cellValue(XLSX, ws[XLSX.utils.encode_cell({ r, c })]));
      grid.push({ n: r + 1, cells });
    }
    const head = grid.shift() || { cells: [] };
    let width = head.cells.length;
    while (width > 0 && isBlank(head.cells[width - 1])) width -= 1;
    const header = head.cells.slice(0, width).map((h) => show(h));
    let blankRows = 0;
    const rows = [];
    for (const g of grid) {
      if (g.cells.every(isBlank)) { blankRows += 1; continue; }
      rows.push({ n: g.n, cells: g.cells.slice(0, width), extra: g.cells.slice(width).some((v) => !isBlank(v)) });
    }
    return { header, rows, blankRows, wideRows: rows.filter((r) => r.extra).map((r) => r.n) };
  }

  function readWorkbook(XLSX, arrayBuffer, sheetName) {
    const wb = XLSX.read(arrayBuffer, { type: 'array', cellNF: true, cellDates: false, raw: true });
    const name = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
    return { sheetNames: wb.SheetNames, sheetName: name, table: sheetToTable(XLSX, wb.Sheets[name]) };
  }

  const excelSerial = (d) => (Date.UTC(d.y, d.m - 1, d.d) - Date.UTC(1899, 11, 30)) / 86400000;

  function tableToSheet(XLSX, header, rows) {
    const aoa = [header].concat(rows.map((cells) => cells.map((v) => (v instanceof DateVal ? excelSerial(v) : v))));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    rows.forEach((cells, r) => cells.forEach((v, c) => {
      if (v instanceof DateVal) {
        const cell = ws[XLSX.utils.encode_cell({ r: r + 1, c })];
        cell.t = 'n'; cell.z = 'yyyy-mm-dd'; cell.w = v.toString();
      }
    }));
    ws['!cols'] = header.map((h) => ({ wch: Math.max(10, String(h).length * 2 + 2) }));
    return ws;
  }

  const LOG_HEADER = ['종류', '원본 행', '관리번호', '칸', '원래 값', '바뀐 값', '처방', '내용', '이유'];
  const logRows = (log) => log.map((e) => [e.종류, e.행, e.ID, e.칸, e.원래, e.바뀐, e.처방, e.내용, e.이유]);

  // 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM 을 붙인 CSV.
  function toCsv(header, rows) {
    const esc = (v) => {
      const s = show(v);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return '﻿' + [header].concat(rows).map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
  }

  // ---------- 정답과 대조 ----------
  function sameValue(a, b) {
    if (isBlank(a) && isBlank(b)) return true;
    const sa = show(a).trim();
    const sb = show(b).trim();
    if (sa === sb) return true;
    const na = Number(sa.replace(/,/g, ''));
    const nb = Number(sb.replace(/,/g, ''));
    return sa !== '' && sb !== '' && !Number.isNaN(na) && !Number.isNaN(nb) && na === nb;
  }

  function compare(result, answer, rules) {
    const flagCol = rules.표시_칸 || '_표시';
    const idCol = rules.ID_칸;
    const ours = result.header;
    const theirs = answer.header;
    const common = ours.filter((h) => theirs.includes(h));
    const oi = (h) => ours.indexOf(h);
    const ai = (h) => theirs.indexOf(h);
    const byId = idCol && ours.includes(idCol) && theirs.includes(idCol);

    const pool = new Map();
    result.rows.forEach((r, i) => {
      const k = byId ? show(r.cells[oi(idCol)]) : String(i);
      if (!pool.has(k)) pool.set(k, []);
      pool.get(k).push(r);
    });

    const diffs = [];
    const onlyAnswer = [];
    let matchedRows = 0;
    let fullRows = 0;
    answer.rows.forEach((ar, i) => {
      const k = byId ? show(ar.cells[ai(idCol)]) : String(i);
      const list = pool.get(k);
      const or = list && list.shift();
      if (!or) { onlyAnswer.push(k); return; }
      matchedRows += 1;
      let ok = true;
      for (const h of common) {
        const a = or.cells[oi(h)];
        const b = ar.cells[ai(h)];
        const eq = h === flagCol || h.startsWith('_') ? isBlank(a) === isBlank(b) : sameValue(a, b);
        if (!eq) { ok = false; diffs.push({ ID: k, 정리본_행: or.n, 정답_행: ar.n, 칸: h, 정리본: show(a), 정답: show(b) }); }
      }
      if (ok) fullRows += 1;
    });
    const onlyOurs = [];
    pool.forEach((list, k) => list.forEach(() => onlyOurs.push(k)));
    return {
      정답_행: answer.rows.length,
      정리본_행: result.rows.length,
      짝지은_행: matchedRows,
      일치_행: fullRows,
      어긋난_칸: diffs,
      정답에만: onlyAnswer,
      정리본에만: onlyOurs,
      비교한_칸: common,
      정답에_없는_칸: ours.filter((h) => !theirs.includes(h)),
      정리본에_없는_칸: theirs.filter((h) => !ours.includes(h)),
      짝짓는_법: byId ? `${idCol}로 짝지음` : '순서대로 짝지음',
    };
  }

  root.Cleaner = {
    DateVal, isBlank, show, keyOf, fmtNum,
    OPS, checkRules, clean, sameTwice,
    readWorkbook, sheetToTable, tableToSheet, toCsv, LOG_HEADER, logRows, compare,
  };
})(typeof window !== 'undefined' ? window : globalThis);
