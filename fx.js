// fx.js — 화면 움직임(E안). 화면을 꾸미기만 하고, 정리 계산(clean.js)이나 화면 동작(app.js)은 건드리지 않는다.
(function () {
  'use strict';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = document.documentElement;
  root.classList.add('fx');

  // 1. 오로라 배경
  const aur = document.createElement('div');
  aur.className = 'aurora';
  aur.setAttribute('aria-hidden', 'true');
  aur.innerHTML = '<i></i><i></i><i></i>';
  document.body.prepend(aur);

  // 2. 설명 문구 타이핑 (읽는 프로그램에는 처음부터 전체 문장)
  const lead = document.querySelector('.lead');
  if (lead && !reduce) {
    const full = lead.textContent;
    lead.setAttribute('aria-label', full);
    lead.textContent = '';
    const text = document.createElement('span');
    text.setAttribute('aria-hidden', 'true');
    const caret = document.createElement('span');
    caret.className = 'caret';
    lead.append(text, caret);
    let i = 0;
    const step = () => {
      i += 1;
      text.textContent = full.slice(0, i);
      if (i < full.length) setTimeout(step, 22);
      else setTimeout(() => caret.remove(), 2400);
    };
    setTimeout(step, 300);
  }

  // 3. 마우스 따라오는 빛
  let raf = 0;
  let px = 0;
  let py = 0;
  document.addEventListener('pointermove', (e) => {
    px = e.clientX; py = e.clientY;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      document.querySelectorAll('.card').forEach((c) => {
        const r = c.getBoundingClientRect();
        c.style.setProperty('--mx', `${px - r.left}px`);
        c.style.setProperty('--my', `${py - r.top}px`);
      });
    });
  }, { passive: true });

  // 3-1. 단추에 아이콘 붙이기 (글자는 그대로, 아이콘은 읽는 프로그램에 숨김)
  const svg = (d) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    spark: svg('<path d="M8 1.5l1.6 4.2 4.4 1.3-4.4 1.3L8 12.5 6.4 8.3 2 7l4.4-1.3z"/><path d="M13 11.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>'),
    down: svg('<path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M3 13.5h10"/>'),
    up: svg('<path d="M8 11V3M4.5 6L8 2.5 11.5 6M3 13.5h10"/>'),
    arrow: svg('<path d="M3 8h9.5M9 4.5L12.5 8 9 11.5"/>'),
  };
  function iconize(b) {
    if (b.dataset.ic) return;
    b.dataset.ic = '1';
    const kind = b.id === 'run' ? 'spark' : b.id && b.id.startsWith('dl-') ? 'down' : b.querySelector('input[type=file]') ? 'up' : null;
    if (!kind) return;
    const ic = document.createElement('span');
    ic.className = 'ic';
    ic.innerHTML = ICON[kind];
    b.prepend(ic);
    if (b.id === 'run') {
      const go = document.createElement('span');
      go.className = 'go';
      go.innerHTML = ICON.arrow;
      b.append(go);
    }
  }
  document.querySelectorAll('.btn').forEach(iconize);

  // 4. 단추 물결
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.btn');
    if (!b || reduce) return;
    const r = b.getBoundingClientRect();
    const s = Math.max(r.width, r.height);
    const w = document.createElement('span');
    w.className = 'ripple';
    w.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`;
    b.appendChild(w);
    setTimeout(() => w.remove(), 650);
  });

  // 5. 숫자가 0부터 올라가기
  function countUp(el) {
    if (el.dataset.counted || el.children.length) return;
    const tpl = el.textContent;
    const nums = tpl.match(/\d[\d,]*/g);
    if (!nums) return;
    el.dataset.counted = '1';
    if (reduce) return;
    const targets = nums.map((n) => Number(n.replace(/,/g, '')));
    const t0 = performance.now();
    const dur = 750;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const ease = 1 - Math.pow(1 - p, 3);
      let k = 0;
      el.textContent = tpl.replace(/\d[\d,]*/g, () => Math.round(targets[k++] * ease).toLocaleString('ko-KR'));
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = tpl;
    };
    requestAnimationFrame(tick);
  }

  // 6. 새로 나타나는 것들에 등장 효과
  function decorate(scope) {
    scope.querySelectorAll('.fact .v').forEach(countUp);
    scope.querySelectorAll('.facts, h3, details, .warn, .err, p.muted').forEach((el) => {
      if (!el.dataset.rv) { el.dataset.rv = '1'; el.classList.add('reveal'); }
    });
    scope.querySelectorAll('.tablewrap tbody').forEach((tb) => {
      Array.from(tb.rows).slice(0, 40).forEach((tr, i) => { tr.style.setProperty('--i', i); tr.classList.add('in'); });
    });
  }
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      // 숨김 → 보임으로 바뀐 순간에만. (reveal 을 붙이는 것도 class 변화라, 이 조건이 없으면 끝없이 돈다)
      const wasHidden = /(^|\s)hidden(\s|$)/.test(m.oldValue || '');
      if (m.type === 'attributes' && wasHidden && m.target.classList.contains('card') && !m.target.classList.contains('hidden')) {
        m.target.classList.remove('reveal'); void m.target.offsetWidth; m.target.classList.add('reveal');
      }
      if (m.type === 'childList' && m.target.nodeType === 1) decorate(m.target);
    }
  });
  mo.observe(document.querySelector('main'), { subtree: true, childList: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
  document.querySelectorAll('.card:not(.hidden)').forEach((c) => c.classList.add('reveal'));

  // 7. 정리 단추를 누르면 결과 위로 빛이 한 번 훑고 지나간다
  const run = document.querySelector('#run');
  const result = document.querySelector('#result');
  if (run && result) run.addEventListener('click', () => {
    if (reduce) return;
    result.classList.remove('scan'); void result.offsetWidth; result.classList.add('scan');
    setTimeout(() => result.classList.remove('scan'), 1100);
  });
})();
