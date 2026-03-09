(function () {
  'use strict';

  /* ─────────────────────────────────
     Mobile nav toggle
  ───────────────────────────────── */
  var navToggle = document.querySelector('.nav-toggle');
  if (navToggle) {
    navToggle.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      navToggle.setAttribute('aria-expanded', String(open));
    });
    document.querySelectorAll('.nav-links a').forEach(function (a) {
      a.addEventListener('click', function () {
        document.body.classList.remove('nav-open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ─────────────────────────────────
     Scrolled nav: collapse links
  ───────────────────────────────── */
  var siteNav = document.querySelector('.site-nav');
  if (siteNav) {
    var onScroll = function () {
      if (window.scrollY > 60) {
        siteNav.classList.add('nav-scrolled');
      } else {
        siteNav.classList.remove('nav-scrolled');
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ─────────────────────────────────
     Browser demo animation
  ───────────────────────────────── */
  var bw = document.getElementById('browser-demo');
  if (!bw) return;

  // ── PII colours exactly matching the extension's getTypeColor() ──
  var PII_COLORS = {
    PERSON:       '#D32F2F',
    EMAIL:        '#0288D1',
    PHONE:        '#00796B',
    ADDRESS:      '#EF6C00',
    SSN:          '#C2185B',
    DOB:          '#8E24AA',
    LOCATION:     '#2E7D32',
    ORGANIZATION: '#3949AB'
  };

  // ── Scene definitions ──────────────────────────────────────────
  var SCENES = [
    {
      platform:   'chatgpt',
      tabTitle:   'ChatGPT',
      tabColor:   '#10A37F',
      url:        'chatgpt.com',
      aiElId:     'chatgpt-ai',
      typingElId: 'chatgpt-typing',
      composeId:  'chatgpt-compose',
      aiMsg:      'Of course — what changes need to be made to the contract?',
      segments: [
        { t: 'Please review the contract for ' },
        { t: 'Dr. Sarah Chen',        label: 'PERSON',  color: PII_COLORS.PERSON  },
        { t: ', date of birth ' },
        { t: '03/15/1984',            label: 'DOB',     color: PII_COLORS.DOB     },
        { t: '. Her email is ' },
        { t: 'sarah.chen@lawfirm.io', label: 'EMAIL',   color: PII_COLORS.EMAIL   },
        { t: '.' }
      ]
    },
    {
      platform:   'gemini',
      tabTitle:   'Gemini',
      tabColor:   '#4285F4',
      url:        'gemini.google.com',
      aiElId:     'gemini-ai',
      typingElId: 'gemini-typing',
      composeId:  'gemini-compose',
      aiMsg:      'I can help with that summary. What format works best for you?',
      segments: [
        { t: 'Summarise the records for patient ' },
        { t: 'James Morrison',          label: 'PERSON',  color: PII_COLORS.PERSON  },
        { t: ', SSN ' },
        { t: '442-71-9023',             label: 'SSN',     color: PII_COLORS.SSN     },
        { t: ', residing at ' },
        { t: '847 Oak Street, Portland',label: 'ADDRESS', color: PII_COLORS.ADDRESS },
        { t: '.' }
      ]
    },
    {
      platform:   'claude',
      tabTitle:   'Claude',
      tabColor:   '#D97757',
      url:        'claude.ai',
      aiElId:     'claude-ai',
      typingElId: 'claude-typing',
      composeId:  'claude-compose',
      aiMsg:      'Happy to draft that. Should I keep the tone formal, matching your previous thread?',
      segments: [
        { t: 'Write an email to ' },
        { t: 'Michael Torres',   label: 'PERSON', color: PII_COLORS.PERSON },
        { t: ' at ' },
        { t: 'm.torres@acme.com',label: 'EMAIL',  color: PII_COLORS.EMAIL  },
        { t: ', cc his manager at ' },
        { t: '(212) 555-0147',   label: 'PHONE',  color: PII_COLORS.PHONE  },
        { t: '.' }
      ]
    }
  ];

  // ── DOM handles ───────────────────────────────────────────────
  var bwTabDot    = document.getElementById('bw-tab-dot');
  var bwTabTitle  = document.getElementById('bw-tab-title');
  var bwUrl       = document.getElementById('bw-url');
  var bwExtBadge  = document.getElementById('bw-ext-badge');
  var veilPill    = document.getElementById('veil-scanning');
  var veilBar     = document.getElementById('veil-action-bar');
  var vabCount    = document.getElementById('vab-count');
  var vabTimer    = document.getElementById('vab-timer');

  // Animation cancellation token
  var animToken = 0;

  function wait(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  // ── Platform view switching ────────────────────────────────────
  function switchPlatform(nextIdx) {
    return new Promise(function (resolve) {
      var platforms = bw.querySelectorAll('.bw-platform');
      var nextEl    = document.getElementById('plat-' + SCENES[nextIdx].platform);

      // Already the active platform — skip animation (handles initial scene 0)
      if (nextEl.classList.contains('active')) {
        resolve();
        return;
      }

      // Prepare next platform (invisible, visible in DOM)
      nextEl.style.opacity = '0';
      nextEl.style.display = 'flex';

      // Short rAF to let display:flex paint before transitioning
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          // Fade out current active (skip nextEl to avoid fighting itself)
          platforms.forEach(function (p) {
            if (p.classList.contains('active') && p !== nextEl) {
              p.style.transition = 'opacity 0.3s ease';
              p.style.opacity = '0';
              setTimeout(function () {
                p.classList.remove('active');
                p.style.display = '';
                p.style.opacity = '';
                p.style.transition = '';
              }, 320);
            }
          });

          // Fade in next
          nextEl.classList.add('active');
          nextEl.style.transition = 'opacity 0.35s ease';
          nextEl.style.opacity = '1';
          setTimeout(function () {
            nextEl.style.transition = '';
            resolve();
          }, 360);
        });
      });
    });
  }

  // ── Position Veil overlays above the active compose area ──────
  function positionVeilUI(composeId) {
    var compose = document.getElementById(composeId);
    if (!compose) return;
    var rect    = compose.getBoundingClientRect();
    var vp      = bw.querySelector('.bw-viewport').getBoundingClientRect();

    var relTop   = rect.top  - vp.top;
    var relLeft  = rect.left - vp.left;
    var relRight = vp.right  - rect.right;

    // Scanning pill: top-left of compose area
    veilPill.style.top  = (relTop - 36) + 'px';
    veilPill.style.left = relLeft + 12 + 'px';

    // Action bar: above the input, full width minus padding
    veilBar.style.top   = (relTop - 40) + 'px';
    veilBar.style.left  = relLeft + 12 + 'px';
    veilBar.style.right = relRight + 12 + 'px';
    veilBar.style.width = '';
  }

  // ── Main scene runner ─────────────────────────────────────────
  async function runScene(idx) {
    var token = ++animToken;
    var scene = SCENES[idx];

    // 1 ── Switch platform view
    await switchPlatform(idx);
    if (animToken !== token) return;

    // 2 ── Update browser chrome
    if (bwTabDot) bwTabDot.style.background = scene.tabColor;
    if (bwTabTitle) bwTabTitle.textContent = scene.tabTitle;

    // Animate URL bar change
    if (bwUrl) {
      bwUrl.style.opacity = '0';
      await wait(100);
      if (animToken !== token) return;
      bwUrl.textContent = scene.url;
      bwUrl.style.opacity = '1';
    }

    // 3 ── Update AI message
    var aiEl = document.getElementById(scene.aiElId);
    if (aiEl) {
      aiEl.style.opacity = '0';
      await wait(150);
      if (animToken !== token) return;
      aiEl.textContent = scene.aiMsg;
      aiEl.style.transition = 'opacity 0.3s ease';
      aiEl.style.opacity    = '1';
      setTimeout(function () { if (aiEl) aiEl.style.transition = ''; }, 350);
    }

    // 4 ── Reset input
    var typingEl = document.getElementById(scene.typingElId);
    if (!typingEl) return;
    typingEl.innerHTML = '';
    typingEl.style.opacity = '1';

    // Reset Veil UI
    veilPill.classList.remove('visible');
    veilBar.classList.remove('visible');
    if (bwExtBadge) bwExtBadge.classList.remove('active');

    // Position overlays
    positionVeilUI(scene.composeId);

    await wait(300);
    if (animToken !== token) return;

    // 5 ── Typewriter: build each segment
    var piiSpans = [];

    for (var i = 0; i < scene.segments.length; i++) {
      if (animToken !== token) return;
      var seg = scene.segments[i];

      if (seg.label) {
        // PII segment — create a live span
        var span = document.createElement('span');
        span.className = 'pii-span-live';
        span.style.setProperty('--pii-c', seg.color);
        span.dataset.label = seg.label;
        span.dataset.color = seg.color;
        typingEl.appendChild(span);

        for (var c = 0; c < seg.t.length; c++) {
          if (animToken !== token) return;
          span.textContent += seg.t[c];
          await wait(44);
        }
        piiSpans.push(span);

      } else {
        // Plain text
        var node = document.createTextNode('');
        typingEl.appendChild(node);
        for (var c = 0; c < seg.t.length; c++) {
          if (animToken !== token) return;
          node.textContent += seg.t[c];
          await wait(28);
        }
      }
    }

    // 6 ── Typing done — show scanning pill
    await wait(350);
    if (animToken !== token) return;

    positionVeilUI(scene.composeId);
    veilPill.classList.add('visible');

    // 7 ── Scanning animation runs for ~1.2s
    await wait(1200);
    if (animToken !== token) return;

    // 8 ── Detections appear — staggered wavy underlines
    veilPill.classList.remove('visible');

    for (var s = 0; s < piiSpans.length; s++) {
      if (animToken !== token) return;
      piiSpans[s].classList.add('detected');
      await wait(160);
    }

    // Veil extension icon in toolbar lights up
    if (bwExtBadge) bwExtBadge.classList.add('active');

    // 9 ── Show action bar with detection count
    await wait(200);
    if (animToken !== token) return;

    var n = piiSpans.length;
    vabCount.textContent = n + ' item' + (n !== 1 ? 's' : '') + ' detected';
    vabTimer.textContent = 'Auto-redacting…';
    veilBar.classList.add('visible');

    // 10 ── Brief hold (simulate the 1.2s auto-redact delay from the real extension)
    await wait(1400);
    if (animToken !== token) return;

    vabTimer.textContent = '';

    // 11 ── Auto-redact: each span transforms into a badge
    for (var s = 0; s < piiSpans.length; s++) {
      if (animToken !== token) return;
      var sp = piiSpans[s];

      // Flash
      sp.classList.add('redacting');
      await wait(75);
      if (animToken !== token) return;

      // Replace text + apply badge style
      sp.textContent = '[' + sp.dataset.label + ' REDACTED]';
      sp.classList.remove('detected', 'redacting');
      sp.classList.add('redacted');

      await wait(220);
    }

    // 12 ── Update action bar to "done" state
    if (animToken !== token) return;
    vabCount.textContent = '✓  ' + n + ' item' + (n !== 1 ? 's' : '') + ' redacted';
    vabTimer.textContent = '';

    // 13 ── Hold the finished state
    await wait(2400);
    if (animToken !== token) return;

    // 14 ── Fade out input text + hide bars
    typingEl.style.transition = 'opacity 0.3s ease';
    typingEl.style.opacity    = '0';
    veilBar.classList.remove('visible');
    if (bwExtBadge) bwExtBadge.classList.remove('active');

    await wait(380);
    if (animToken !== token) return;

    typingEl.style.opacity    = '1';
    typingEl.style.transition = '';

    // 15 ── Next platform
    runScene((idx + 1) % SCENES.length);
  }

  // ── Kick off ──────────────────────────────────────────────────
  runScene(0);

})();
