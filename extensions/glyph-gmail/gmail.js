(() => {
  // DOM events cross extension isolated-world lifetimes; global references may
  // not survive Chrome invalidating the previous extension context.
  const retireEvent = 'glyph:compose-retire';
  document.dispatchEvent(new Event(retireEvent));
  globalThis.glyphCompose?.dispose();
  const legacyToolbars = document.querySelectorAll('.glyph-native-toolbar');
  if (legacyToolbars.length) {
    // Pre-handoff extensions cannot safely surrender their in-memory tracking
    // state. Do not guess original URLs or remove the user's rich text.
    for (const toolbar of legacyToolbars) {
      for (const button of toolbar.querySelectorAll(
        'button:not(.glyph-native-recovery)',
      ))
        button.disabled = true;
      const status = toolbar.querySelector('.glyph-native-status');
      if (status)
        status.textContent =
          'An older Glyph script is still open. Wait until Gmail saves your draft, then reload Gmail once to finish updating.';
      const recovery = toolbar.querySelector('.glyph-native-recovery');
      if (recovery) recovery.hidden = false;
    }
    return;
  }
  let disposed = false;
  const cleanups = new Set();
  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    const cleanup = () => {
      target.removeEventListener(event, handler, options);
      cleanups.delete(cleanup);
    };
    cleanups.add(cleanup);
    return cleanup;
  };
  const states = new WeakMap();
  const live = new Set();
  const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  const request = async (action, data) => {
    const result = await globalThis.glyphMessaging.send({
      channel: 'glyph:background',
      action,
      data,
    });
    if (!result?.ok)
      throw new Error(
        result?.error || 'Glyph extension disconnected. Reload Gmail.',
      );
    return result.data;
  };
  function showRecovery(
    state,
    error = globalThis.glyphMessaging.unavailable(),
  ) {
    if (state.disconnected || disposed) return;
    state.disconnected = true;
    if (state.attached) {
      restore(state);
      state.body.dispatchEvent(new Event('input', { bubbles: true }));
    }
    state.button.disabled = true;
    state.recovery.hidden = false;
    setStatus(state, error.message, true);
  }
  function preparationFailed(state, error) {
    if (disposed) return;
    if (state.changes.length) restore(state);
    if (error.name === 'GlyphExtensionUnavailable') showRecovery(state, error);
    else
      setStatus(
        state,
        error.message ||
          'Unable to prepare tracking. Your email has not been sent.',
        true,
      );
  }
  function validEmail(value) {
    const address = String(value || '').trim();
    return emailPattern.test(address) ? address.toLowerCase() : null;
  }
  function validateRecipients(groups) {
    const all = Object.values(groups).flat();
    if (!all.length || all.length > 100)
      throw new Error('Use between 1 and 100 To, Cc or Bcc recipients.');
    if (new Set(all).size !== all.length)
      throw new Error('Remove duplicate addresses across To, Cc and Bcc.');
    return all[0];
  }
  function recipientRole(el, root) {
    for (let node = el; node && node !== root; node = node.parentElement) {
      const label = (
        node.getAttribute('name') ||
        node.getAttribute('data-name') ||
        node.getAttribute('data-recipient-type') ||
        node.getAttribute('aria-label') ||
        ''
      )
        .trim()
        .toLowerCase();
      for (const role of ['to', 'cc', 'bcc'])
        if (label === role || label.startsWith(`${role} `)) return role;
      if (node.tagName === 'TR') {
        const fields = [
          ...node.querySelectorAll(
            'input[name="to"], input[name="cc"], input[name="bcc"]',
          ),
        ];
        const roles = new Set(fields.map((field) => field.name));
        if (roles.size === 1) return fields[0].name;
      }
    }
    return null;
  }
  function recipients(root, body) {
    const groups = { to: new Set(), cc: new Set(), bcc: new Set() };
    const unclassified = new Set();
    for (const el of root.querySelectorAll(
      '[email], [data-recipient-id], [data-hovercard-id], input[name="to"], input[name="cc"], input[name="bcc"], input[role="combobox"][aria-label]',
    )) {
      if (
        body.contains(el) ||
        el.closest('.glyph-native-toolbar, [name="from"], [data-name="from"]')
      )
        continue;
      const email = validEmail(
        el.getAttribute('email') ||
          el.getAttribute('data-recipient-id') ||
          el.getAttribute('data-hovercard-id') ||
          el.value,
      );
      if (email) {
        const role = recipientRole(el, root);
        if (role) groups[role].add(email);
        else unclassified.add(email);
      }
    }
    // Collapsed Gmail summaries repeat chips without their original roles.
    // Named fields/role containers take precedence over those summary chips.
    for (const email of unclassified)
      if (!Object.values(groups).some((addresses) => addresses.has(email)))
        groups.to.add(email);
    return {
      toEmails: [...groups.to].sort(),
      ccEmails: [...groups.cc].sort(),
      bccEmails: [...groups.bcc].sort(),
    };
  }
  function sender(root) {
    const from = root.querySelector('input[name="from"], select[name="from"]');
    if (from?.value) {
      const match = from.value.match(/[^\s<>]+@[^\s<>]+/);
      if (match) return validEmail(match[0]);
    }
    for (const el of document.querySelectorAll(
      'a[href*="SignOutOptions"], [aria-label*="Google Account"], [data-tooltip*="@"]',
    )) {
      const label = [
        el.getAttribute('aria-label'),
        el.getAttribute('data-tooltip'),
        el.getAttribute('title'),
      ].join(' ');
      const match = label.match(
        /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
      );
      if (match) return validEmail(match[0]);
    }
    return null;
  }
  function subject(root) {
    return (
      root.querySelector('input[name="subjectbox"]')?.value?.trim() ||
      document.querySelector('h2.hP')?.textContent?.trim() ||
      ''
    );
  }
  function cleanClone(body) {
    const clone = body.cloneNode(true);
    clone
      .querySelectorAll('.glyph-native-footer, .glyph-native-toolbar')
      .forEach((el) => el.remove());
    return clone;
  }
  function snapshot(state) {
    return JSON.stringify({
      to: recipients(state.root, state.body),
      subject: subject(state.root),
      from: sender(state.root),
      opens: state.opens.checked,
      clicks: state.clicks.checked,
      text: cleanClone(state.body).textContent,
      links: [...cleanClone(state.body).querySelectorAll('a[href]')].map((a) =>
        a.getAttribute('href'),
      ),
      footer:
        state.body.querySelector('.glyph-native-footer')?.innerHTML || null,
    });
  }
  function restore(state) {
    state.body
      .querySelectorAll('.glyph-native-footer')
      .forEach((el) => el.remove());
    for (const change of state.changes) {
      if (!change.anchor.isConnected) continue;
      if (change.anchor.href !== change.trackingUrl) continue; // Preserve the user's edited URL.
      if (change.generated)
        change.anchor.replaceWith(...change.anchor.childNodes);
      else change.anchor.setAttribute('href', change.href);
    }
    state.changes = [];
    state.attached = false;
    state.button.textContent = 'Add glyph';
  }
  function setStatus(state, text, error = false) {
    state.status.textContent = text;
    state.status.classList.toggle('glyph-native-error', error);
  }
  function linkCandidates(body) {
    const result = new Set();
    for (const a of body.querySelectorAll('a[href]')) {
      if (a.closest('.gmail_quote, .glyph-native-footer')) continue;
      if (/^https?:\/\//i.test(a.href) && !/\/api\/glyph\//.test(a.href))
        result.add(a.href);
    }
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('a, .gmail_quote, .glyph-native-footer'))
        continue;
      for (const match of node.textContent.matchAll(/https?:\/\/[^\s<>"']+/g)) {
        const url = match[0].replace(/[.,;!?)\]]+$/, '');
        if (!/\/api\/glyph\//.test(url)) result.add(url);
      }
    }
    return [...result].slice(0, 100);
  }
  function rewriteLinks(state, links) {
    const byUrl = new Map(links.map((l) => [l.url, l.trackingUrl]));
    for (const a of state.body.querySelectorAll('a[href]')) {
      if (a.closest('.gmail_quote, .glyph-native-footer') || !byUrl.has(a.href))
        continue;
      state.changes.push({
        anchor: a,
        href: a.getAttribute('href'),
        generated: false,
        trackingUrl: byUrl.get(a.href),
      });
      a.href = byUrl.get(a.href);
    }
    const walker = document.createTreeWalker(state.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (!node.parentElement?.closest('a, .gmail_quote, .glyph-native-footer'))
        nodes.push(node);
    }
    for (const text of nodes) {
      const matches = [
        ...text.textContent.matchAll(/https?:\/\/[^\s<>"']+/g),
      ].filter((m) => byUrl.has(m[0].replace(/[.,;!?)\]]+$/, '')));
      if (!matches.length) continue;
      const fragment = document.createDocumentFragment();
      let end = 0;
      for (const match of matches) {
        const url = match[0].replace(/[.,;!?)\]]+$/, '');
        fragment.append(
          document.createTextNode(text.textContent.slice(end, match.index)),
        );
        const anchor = document.createElement('a');
        anchor.href = byUrl.get(url);
        anchor.textContent = url;
        fragment.append(anchor);
        state.changes.push({
          anchor,
          generated: true,
          trackingUrl: byUrl.get(url),
        });
        end = match.index + url.length;
      }
      fragment.append(document.createTextNode(text.textContent.slice(end)));
      text.replaceWith(fragment);
    }
  }
  async function apply(state) {
    if (disposed || state.busy || state.disconnected) return;
    if (state.attached) {
      restore(state);
      setStatus(state, 'Glyph removed. Gmail Send is unchanged.');
      state.body.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    state.busy = true;
    state.button.disabled = true;
    try {
      setStatus(state, 'Preparing glyph…');
      const ctx = await request('context');
      const groups = recipients(state.root, state.body);
      const from = sender(state.root);
      if (!from)
        throw new Error(
          'Cannot verify the active Gmail account. Open Gmail with the connected account.',
        );
      if (from !== ctx.email.toLowerCase())
        throw new Error(`Switch Gmail to ${ctx.email} before adding a glyph.`);
      const primary = validateRecipients(groups);
      const title = subject(state.root);
      const text = cleanClone(state.body).textContent.trim();
      if (!title || !text)
        throw new Error('Add a subject and message before adding a glyph.');
      if (!state.opens.checked && !state.clicks.checked)
        throw new Error('Enable open or link tracking.');
      const before = snapshot(state);
      const response = await request('prepare', {
        composeKey: state.composeKey,
        recipientEmail: primary,
        ...groups,
        recipientName: '',
        senderEmail: from,
        subject: title,
        body: text,
        trackOpens: state.opens.checked,
        trackClicks: state.clicks.checked,
        urls: linkCandidates(state.body),
      });
      if (state.disconnected || !globalThis.glyphMessaging.available())
        throw globalThis.glyphMessaging.unavailable();
      if (disposed || !state.body.isConnected || before !== snapshot(state))
        throw new Error(
          'The draft changed while preparing. Click Add glyph again.',
        );
      rewriteLinks(state, response.links);
      const footer = document.createElement('div');
      footer.className = 'glyph-native-footer';
      footer.style.cssText =
        'margin-top:20px;font:11px Arial,sans-serif;color:#777';
      const marker = document.createElement('a');
      marker.href = response.markerUrl;
      marker.textContent = 'Sent with Glyph';
      marker.style.color = '#777';
      footer.append(
        marker,
        document.createTextNode(' · Engagement tracking enabled'),
      );
      if (response.pixelUrl) {
        const img = document.createElement('img');
        img.src = response.pixelUrl;
        img.width = 1;
        img.height = 1;
        img.alt = '';
        img.style.cssText = 'border:0;width:1px;height:1px';
        footer.append(img);
      }
      state.body.append(footer);
      // Inform Gmail that the draft changed; do not replace its editor contents,
      // dispatch a Send click, or intercept any keyboard shortcuts.
      state.body.dispatchEvent(new Event('input', { bubbles: true }));
      state.attached = true;
      state.snapshot = snapshot(state);
      state.button.textContent = 'Remove glyph';
      setStatus(state, 'Glyph ready · shared message signals · use Gmail Send');
    } catch (error) {
      preparationFailed(state, error);
    } finally {
      state.busy = false;
      state.button.disabled = !!state.disconnected;
    }
  }
  function placeToolbar({ body, root, toolbar }) {
    // Gmail's inline replies and pop-out composes have different containers.
    // Anchor to the native Send control, never to the editable body or its
    // wrapper. Do not change Gmail's button, layout, or send handlers.
    const send = [
      ...root.querySelectorAll(
        '[role="button"][data-tooltip^="Send"], [role="button"][aria-label^="Send"], button[aria-label^="Send"]',
      ),
    ].find(
      (node) =>
        !node.closest(
          '.glyph-native-toolbar, .gmail_quote, [contenteditable="true"], [g_editable="true"]',
        ),
    );
    const parent = send?.parentElement;
    const safeParent =
      parent &&
      !body.contains(parent) &&
      !parent.closest('[contenteditable="true"], [g_editable="true"]') &&
      !['TABLE', 'TBODY', 'THEAD', 'TFOOT', 'TR'].includes(parent.tagName);
    if (safeParent) {
      if (toolbar.parentElement !== parent || toolbar.nextSibling !== send)
        parent.insertBefore(toolbar, send);
    } else if (!root.closest('[contenteditable="true"], [g_editable="true"]')) {
      // Unknown/localized Gmail layout: keep controls below the compose rather
      // than inserting anything into the outgoing draft. Re-anchor on rescan
      // if Gmail mounts its Send controls later.
      if (toolbar.parentElement !== root) root.append(toolbar);
    }
  }
  function attach(body, root) {
    const handlers = [];
    const on = (...args) => handlers.push(listen(...args));
    const toolbar = document.createElement('div');
    toolbar.className = 'glyph-native-toolbar';
    toolbar.setAttribute('contenteditable', 'false');
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', 'Glyph tracking controls');
    const brand = document.createElement('strong');
    brand.textContent = 'glyph';
    toolbar.append(brand);
    const check = (text) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = true;
      label.append(input, document.createTextNode(text));
      toolbar.append(label);
      return input;
    };
    const opens = check('Pixel loads'),
      clicks = check('Links');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Add glyph';
    const status = document.createElement('span');
    const recovery = document.createElement('button');
    recovery.type = 'button';
    recovery.textContent = 'Reload Gmail';
    recovery.className = 'glyph-native-recovery';
    recovery.hidden = true;
    recovery.title = 'Wait until Gmail saves this draft, then reload the page.';
    on(recovery, 'click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.location.reload();
    });
    status.className = 'glyph-native-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    toolbar.append(button, recovery, status);
    const info = document.createElement('details');
    info.className = 'glyph-native-info';
    const summary = document.createElement('summary');
    summary.textContent = 'Info';
    summary.title = 'About Glyph tracking';
    const caveat = document.createElement('p');
    caveat.textContent =
      'Shared messages have aggregate signals, not individual read receipts. Proxies, scanners and forwarding can affect attribution.';
    info.append(summary, caveat);
    toolbar.append(info);
    const state = {
      body,
      root,
      toolbar,
      button,
      status,
      opens,
      clicks,
      changes: [],
      composeKey: crypto.randomUUID(),
      busy: false,
      attached: false,
      recovery,
      disconnected: false,
      handlers,
    };
    placeToolbar(state);
    states.set(body, state);
    live.add(state);
    on(button, 'click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void apply(state);
    });
    for (const input of [opens, clicks])
      on(input, 'change', () => {
        if (disposed) return;
        if (state.attached) {
          restore(state);
          setStatus(state, 'Tracking changed — add glyph again.');
        }
      });
    on(body, 'input', () => {
      if (disposed) return;
      if (!state.busy && state.attached) {
        restore(state);
        setStatus(state, 'Edited — add glyph again.');
      }
    });
    request('context')
      .then(({ settings }) => {
        if (
          !disposed &&
          !state.disconnected &&
          !state.attached &&
          !state.busy
        ) {
          opens.checked = settings.defaultTrackOpens;
          clicks.checked = settings.defaultTrackClicks;
        }
      })
      .catch((error) => {
        if (disposed) return;
        if (error.name === 'GlyphExtensionUnavailable')
          showRecovery(state, error);
        else
          setStatus(
            state,
            error.message || 'Connect via the Glyph extension popup.',
            true,
          );
      });
  }
  function scan() {
    if (disposed) return;
    for (const state of live) {
      if (!state.body.isConnected) {
        for (const cleanup of state.handlers) cleanup();
        state.toolbar.remove();
        states.delete(state.body);
        live.delete(state);
        continue;
      }
      placeToolbar(state);
      if (!globalThis.glyphMessaging.available()) {
        showRecovery(state);
        continue;
      }
      if (state.attached && !state.busy && state.snapshot !== snapshot(state)) {
        restore(state);
        setStatus(state, 'Draft changed — add glyph again.');
      }
    }
    for (const body of document.querySelectorAll(
      'div[contenteditable="true"][role="textbox"]',
    )) {
      if (states.has(body) || body.closest('.glyph-native-toolbar')) continue;
      const root =
        body.closest('.M9') ||
        body.closest('[role="dialog"]') ||
        body.closest('form');
      if (
        !root ||
        root.closest('[contenteditable="true"], [g_editable="true"]') ||
        root.querySelectorAll('div[contenteditable="true"][role="textbox"]')
          .length > 1
      )
        continue;
      if (
        !body.hasAttribute('g_editable') &&
        !root.querySelector('input[name="subjectbox"]')
      )
        continue;
      attach(body, root);
    }
  }
  // Check synchronously before Gmail handles Send or a shortcut. Never cancel
  // the event: if a recipient/subject changed, send the user's untracked draft.
  function invalidateChanged() {
    if (!globalThis.glyphMessaging.available()) {
      for (const state of live) showRecovery(state);
      return;
    }
    for (const state of live) {
      if (state.attached && !state.busy && state.snapshot !== snapshot(state)) {
        restore(state);
        setStatus(
          state,
          'Draft changed — tracking removed. Add glyph again to track.',
        );
        state.body.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
  }
  for (const event of ['click', 'keydown', 'input', 'change']) {
    listen(document, event, invalidateChanged, true);
  }
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      scan();
    }, 250);
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['email', 'data-recipient-id', 'href', 'src'],
  });
  function dispose() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    for (const cleanup of cleanups) cleanup();
    for (const state of live) {
      if (state.attached) {
        restore(state);
        state.body.dispatchEvent(new Event('input', { bubbles: true }));
      }
      state.toolbar.remove();
    }
    live.clear();
  }
  listen(document, retireEvent, dispose);
  globalThis.glyphCompose = { dispose };
  scan();
})();
