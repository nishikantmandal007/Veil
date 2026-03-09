(function () {
  'use strict';

  /* ─────────────────────────────────
     Mobile nav toggle
  ───────────────────────────────── */
  var toggle = document.querySelector('.nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    document.querySelectorAll('.nav-links a').forEach(function (link) {
      link.addEventListener('click', function () {
        document.body.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ─────────────────────────────────
     Animated chat demo
  ───────────────────────────────── */
  var demo = document.getElementById('chat-demo');
  if (!demo) return;

  // Each scene: a platform, an AI reply, and the user's message
  // broken into plain-text and PII segments.
  var SCENES = [
    {
      platform:    'chatgpt',
      avatarLabel: 'GPT',
      aiMsg:       'Of course — what changes need to be made to the contract?',
      segments: [
        { t: 'Please review the contract for ' },
        { t: 'Dr. Sarah Chen',        label: 'PERSON', cls: 'person'  },
        { t: ', date of birth '                                        },
        { t: '03/15/1984',            label: 'DOB',    cls: 'dob'     },
        { t: '. Her email is '                                         },
        { t: 'sarah.chen@lawfirm.io', label: 'EMAIL',  cls: 'email'   },
        { t: '.'                                                       }
      ]
    },
    {
      platform:    'gemini',
      avatarLabel: 'G',
      aiMsg:       "I can help with that summary. What format works best for you?",
      segments: [
        { t: 'Summarise the records for patient ' },
        { t: 'James Morrison',          label: 'PERSON',  cls: 'person'  },
        { t: ', SSN '                                                     },
        { t: '442-71-9023',             label: 'SSN',     cls: 'ssn'     },
        { t: ', residing at '                                             },
        { t: '847 Oak Street, Portland',label: 'ADDRESS', cls: 'address' },
        { t: '.'                                                          }
      ]
    },
    {
      platform:    'claude',
      avatarLabel: 'C',
      aiMsg:       "Happy to draft that. Should I keep the tone formal, matching your previous thread?",
      segments: [
        { t: 'Write an email to '     },
        { t: 'Michael Torres',  label: 'PERSON', cls: 'person' },
        { t: ' at '                   },
        { t: 'm.torres@acme.com',label: 'EMAIL',  cls: 'email'  },
        { t: ', cc manager at '       },
        { t: '(212) 555-0147',  label: 'PHONE',  cls: 'phone'  },
        { t: '.'                      }
      ]
    }
  ];

  var tabs      = demo.querySelectorAll('.platform-tab');
  var inputText = demo.querySelector('#chat-input-text');
  var veilBar   = demo.querySelector('#veil-status');
  var veilCount = demo.querySelector('#veil-count');
  var aiMsgEl   = demo.querySelector('#demo-ai-msg');
  var avatarEl  = demo.querySelector('#demo-avatar');

  // Incrementing token — any async chain that sees a stale token exits.
  var animToken = 0;

  function wait(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  async function runScene(idx) {
    var token = ++animToken;
    var scene = SCENES[idx];

    // ── 1. Switch platform tab
    tabs.forEach(function (t, i) {
      t.classList.toggle('active', i === idx);
      t.setAttribute('aria-selected', String(i === idx));
    });
    demo.dataset.platform = scene.platform;

    // ── 2. Fade in new AI message
    if (aiMsgEl) {
      aiMsgEl.style.opacity = '0';
      await wait(180);
      if (animToken !== token) return;
      aiMsgEl.textContent = scene.aiMsg;
      aiMsgEl.style.transition = 'opacity 0.3s ease';
      aiMsgEl.style.opacity = '1';
    }
    if (avatarEl) avatarEl.textContent = scene.avatarLabel;

    // ── 3. Reset input area
    inputText.innerHTML = '';
    inputText.style.opacity = '1';
    if (veilBar)   veilBar.classList.remove('visible');

    await wait(500);
    if (animToken !== token) return;

    // ── 4. Typewriter — build each segment character by character
    var piiSpans = [];

    for (var i = 0; i < scene.segments.length; i++) {
      if (animToken !== token) return;
      var seg = scene.segments[i];

      if (seg.cls) {
        // PII segment — create a span
        var span = document.createElement('span');
        span.className = 'chat-pii-span';
        span.dataset.cls   = seg.cls;
        span.dataset.label = seg.label;
        inputText.appendChild(span);

        for (var c = 0; c < seg.t.length; c++) {
          if (animToken !== token) return;
          span.textContent += seg.t[c];
          await wait(46);
        }
        piiSpans.push(span);

      } else {
        // Plain text — append characters to a text node
        var node = document.createTextNode('');
        inputText.appendChild(node);

        for (var c = 0; c < seg.t.length; c++) {
          if (animToken !== token) return;
          node.textContent += seg.t[c];
          await wait(30);
        }
      }
    }

    // ── 5. Brief pause — then Veil detects PII
    await wait(520);
    if (animToken !== token) return;

    // Highlight each PII span with a short stagger
    for (var s = 0; s < piiSpans.length; s++) {
      if (animToken !== token) return;
      piiSpans[s].classList.add('detected');
      await wait(130);
    }

    // Show Veil status bar
    if (veilCount) {
      var n = piiSpans.length;
      veilCount.textContent = n + ' item' + (n !== 1 ? 's' : '') + ' detected';
    }
    if (veilBar) veilBar.classList.add('visible');

    // ── 6. Hold state so the user can read it
    await wait(1900);
    if (animToken !== token) return;

    // ── 7. Redact one by one
    for (var s = 0; s < piiSpans.length; s++) {
      if (animToken !== token) return;
      var sp = piiSpans[s];

      // Brief shrink flash
      sp.classList.add('redacting');
      await wait(90);
      if (animToken !== token) return;

      // Swap text and apply tag styling
      sp.textContent = '[' + sp.dataset.label + ']';
      sp.classList.remove('detected', 'redacting');
      sp.classList.add('redacted', 'pii-tag', sp.dataset.cls);

      await wait(210);
    }

    // ── 8. Hold redacted state
    await wait(2400);
    if (animToken !== token) return;

    // ── 9. Fade out input, then advance
    inputText.style.transition = 'opacity 0.3s ease';
    inputText.style.opacity = '0';
    if (veilBar) veilBar.classList.remove('visible');
    await wait(380);
    if (animToken !== token) return;

    inputText.style.opacity = '1';

    // ── 10. Next scene (looping)
    runScene((idx + 1) % SCENES.length);
  }

  // Allow clicking a tab to jump to that platform
  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () {
      runScene(i);
    });
  });

  // Kick off
  runScene(0);

})();
