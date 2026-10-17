// Buildless ES module. No network requests, cookies, storage or third-party code.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Navigation keeps its native anchor behavior, including when JavaScript fails.
const menuButton = $('.menu-toggle');
const mobileNav = $('#mobile-nav');
function closeMenu(returnFocus = false) {
  mobileNav.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'Открыть меню');
  if (returnFocus) menuButton.focus();
}
menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  mobileNav.hidden = !open;
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
});
mobileNav.addEventListener('click', (event) => {
  if (event.target.closest('a')) closeMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !mobileNav.hidden) closeMenu(true);
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.header')) closeMenu();
});
matchMedia('(min-width: 1000px)').addEventListener('change', (event) => {
  if (event.matches) closeMenu();
});

// Reveal only after the observer is ready. The unenhanced document is visible.
if ('IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -20px 0px' });
  for (const element of $$('.reveal')) revealObserver.observe(element);
  if (!reducedMotion.matches) document.documentElement.classList.add('motion-ready');
  reducedMotion.addEventListener('change', (event) => {
    if (event.matches) document.documentElement.classList.remove('motion-ready');
  });

  // The sticky map lights up as the corresponding module enters the viewport.
  const mapObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const node = $(`[data-map-node="${entry.target.dataset.connect}"]`);
      if (node) node.classList.add('is-connected');
    }
  }, { threshold: 0.4 });
  for (const card of $$('[data-connect]')) mapObserver.observe(card);

  const roadmapObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) entry.target.classList.add('is-reached');
    }
  }, { threshold: 0.55 });
  for (const item of $$('.roadmap-item')) roadmapObserver.observe(item);
}

// The hero button illustrates connections, without suggesting live integrations.
const core = $('.core-button');
core.addEventListener('click', () => {
  const active = core.getAttribute('aria-pressed') !== 'true';
  core.setAttribute('aria-pressed', String(active));
  core.setAttribute('aria-label', active ? 'Выключить подсветку модулей' : 'Подключить модули на схеме');
  $('.hero-visual').classList.toggle('is-connected', active);
  $('.core-caption').textContent = active ? 'ОДНА КНОПКА. ОБЩАЯ КАРТИНА.' : 'НАЖМИТЕ. ВСЁ СВЯЗАНО.';
  $('.core-feedback').textContent = active
    ? 'Модули подсвечены на схеме. Личное работает. Бизнес скоро, склад и интеграции в разработке.'
    : 'Подсветка модулей выключена.';
});

// One finite typing effect. Reserve the measured width before changing text.
const typed = $('.typed-word');
let typingTimer;
const word = typed.textContent;
function finishTyping() {
  clearTimeout(typingTimer);
  typed.textContent = word;
}
if (!reducedMotion.matches && finePointer.matches) {
  // A grid overlays the invisible original and the typed text, preserving layout.
  const measure = document.createElement('span');
  const letters = document.createElement('span');
  measure.className = 'type-measure';
  letters.className = 'type-letters';
  measure.textContent = word;
  typed.replaceChildren(measure, letters);
  let position = 0;
  const typeNext = () => {
    if (reducedMotion.matches || position >= word.length) {
      finishTyping();
      return;
    }
    position += 1;
    letters.textContent = word.slice(0, position);
    typingTimer = setTimeout(typeNext, 95);
  };
  typingTimer = setTimeout(typeNext, 450);
}
reducedMotion.addEventListener('change', (event) => {
  if (event.matches) finishTyping();
});

// Illustrative, deterministic import. No actual files or OCR in this demo.
const importButton = $('#demo-import');
const demoStatus = $('#demo-status');
const steps = $$('.step');
const importedRows = $$('.imported-row');
let imported = false;
let importing = false;
const pendingDelays = new Set();
function wait(duration) {
  if (reducedMotion.matches) return Promise.resolve();
  return new Promise((resolve) => {
    let timer;
    const finish = () => {
      clearTimeout(timer);
      pendingDelays.delete(finish);
      resolve();
    };
    pendingDelays.add(finish);
    timer = setTimeout(finish, duration);
  });
}
reducedMotion.addEventListener('change', (event) => {
  if (!event.matches) return;
  for (const finish of pendingDelays) finish();
  if (document.getAnimations) {
    for (const animation of document.getAnimations()) animation.cancel();
  }
});
function setStep(index) {
  steps.forEach((step, position) => step.classList.toggle('is-current', position === index));
}
function resetDemo() {
  importedRows.forEach((row) => { row.hidden = true; });
  $('#demo-balance').textContent = '42 850';
  $('#demo-expense').textContent = '37 150 ₽';
  $('span', importButton).textContent = 'Попробовать импорт';
  demoStatus.textContent = 'Нажмите — добавим две примерные операции.';
  imported = false;
  setStep(0);
}
importButton.addEventListener('click', async () => {
  if (importing) return;
  if (imported) {
    resetDemo();
    return;
  }
  importing = true;
  importButton.disabled = true;
  importButton.classList.add('is-loading');
  $('span', importButton).textContent = 'Добавляем пример…';
  demoStatus.textContent = 'Демо: читаем подготовленный пример на этой странице.';
  setStep(1);
  if (!reducedMotion.matches) await wait(650);
  for (const row of importedRows) {
    row.hidden = false;
    if (!reducedMotion.matches) {
      row.animate([{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 300, easing: 'ease-out' });
      await wait(150);
    }
  }
  $('#demo-balance').textContent = '42 500';
  $('#demo-expense').textContent = '37 500 ₽';
  setStep(2);
  demoStatus.textContent = 'Две примерные операции добавлены. Расходы обновлены.';
  if (!reducedMotion.matches) await wait(450);
  setStep(3);
  $('span', importButton).textContent = 'Повторить демонстрацию';
  importButton.classList.remove('is-loading');
  importButton.disabled = false;
  importing = false;
  imported = true;
});

// Gentle pointer effects use the Web Animations API, not inline CSS attributes.
// Effects are bounded and absent for touch users and reduced-motion users.
for (const element of $$('.magnetic, .tilt-card')) {
  let bounds;
  let animation;
  let frame = 0;
  let latest;
  const magnetic = element.classList.contains('magnetic');
  const allowed = () => !reducedMotion.matches && finePointer.matches;
  element.addEventListener('pointerenter', () => {
    if (allowed()) bounds = element.getBoundingClientRect();
  });
  element.addEventListener('pointermove', (event) => {
    if (!allowed() || !bounds) return;
    latest = { x: event.clientX, y: event.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const x = (latest.x - bounds.left - bounds.width / 2) / bounds.width;
      const y = (latest.y - bounds.top - bounds.height / 2) / bounds.height;
      const transform = magnetic
        ? `translate(${x * 7}px, ${y * 7}px)`
        : `perspective(900px) rotateX(${-y * 5}deg) rotateY(${x * 5}deg)`;
      if (animation) animation.cancel();
      animation = element.animate([{ transform }], { duration: 180, fill: 'forwards', easing: 'ease-out' });
    });
  });
  const reset = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    bounds = undefined;
    if (animation) animation.cancel();
    animation = undefined;
  };
  element.addEventListener('pointerleave', reset);
  element.addEventListener('blur', reset);
  reducedMotion.addEventListener('change', reset);
  finePointer.addEventListener('change', reset);
}

// Sparse, low-resolution hero canvas. Stops outside the viewport or hidden tab.
const canvas = $('.hero-canvas');
const context = canvas.getContext('2d', { alpha: true });
if (context) {
  const hero = $('.hero');
  let width = 0;
  let height = 0;
  let points = [];
  let frame = 0;
  let lastFrame = 0;
  let visible = true;
  let pointer = { x: -1000, y: -1000 };
  const canRun = () => !reducedMotion.matches && finePointer.matches && innerWidth >= 1000 && visible && !document.hidden;
  function resize() {
    const rect = hero.getBoundingClientRect();
    width = Math.round(rect.width);
    height = Math.round(rect.height);
    const pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    points = [];
    const spacing = Math.max(70, width / 25);
    for (let x = width * 0.32; x < width; x += spacing) {
      for (let y = 20; y < height; y += spacing) {
        points.push({ x, y, phase: (x * 0.017 + y * 0.013) % (Math.PI * 2) });
      }
    }
  }
  function draw(time) {
    frame = 0;
    if (!canRun()) return;
    frame = requestAnimationFrame(draw);
    if (time - lastFrame < 16) return;
    lastFrame = time;
    context.clearRect(0, 0, width, height);
    for (const point of points) {
      const dx = point.x - pointer.x;
      const dy = point.y - pointer.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const influence = Math.max(0, 1 - distance / 210);
      const x = point.x + Math.sin(time * 0.0003 + point.phase) * 3 + dx * influence * 0.12;
      const y = point.y + Math.cos(time * 0.0003 + point.phase) * 3 + dy * influence * 0.12;
      context.fillStyle = influence > 0 ? `rgba(196, 168, 255, ${0.15 + influence * 0.55})` : 'rgba(168, 139, 211, 0.17)';
      context.beginPath();
      context.arc(x, y, influence > 0 ? 1.3 : 0.9, 0, Math.PI * 2);
      context.fill();
      if (influence > 0.4) {
        context.strokeStyle = `rgba(178, 137, 239, ${influence * 0.11})`;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(pointer.x, pointer.y);
        context.stroke();
      }
    }
  }
  function syncAnimation() {
    if (canRun() && !frame) frame = requestAnimationFrame(draw);
    if (!canRun() && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      context.clearRect(0, 0, width, height);
    }
  }
  hero.addEventListener('pointermove', (event) => {
    if (!canRun()) return;
    const rect = hero.getBoundingClientRect();
    pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, { passive: true });
  hero.addEventListener('pointerleave', () => { pointer = { x: -1000, y: -1000 }; });
  if ('ResizeObserver' in window) {
    new ResizeObserver(() => { resize(); syncAnimation(); }).observe(hero);
  } else {
    window.addEventListener('resize', () => { resize(); syncAnimation(); }, { passive: true });
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; syncAnimation(); }).observe(hero);
  }
  reducedMotion.addEventListener('change', syncAnimation);
  finePointer.addEventListener('change', syncAnimation);
  document.addEventListener('visibilitychange', syncAnimation);
  resize();
  syncAnimation();
}

$('#year').textContent = String(new Date().getFullYear());
