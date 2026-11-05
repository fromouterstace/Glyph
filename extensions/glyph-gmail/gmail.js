(() => {
  globalThis.glyphCompose?.dispose();
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
  function recipients(root, body) {
    const addresses = new Set();
    for (const el of root.querySelectorAll(
      '[email], [data-recipient-id], input[name="to"], input[name="cc"], input[name="bcc"]',
    )) {
      if (body.contains(el) || el.closest('.glyph-native-toolbar')) continue;
      const email = validEmail(
        el.getAttribute('email') ||
          el.getAttribute('data-recipient-id') ||
          el.value,
      );
      if (email) addresses.add(email);
    }
    return [...addresses].sort();
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
  function hasCcBcc(root, body) {
    return [
      ...root.querySelectorAll(
        'input[name="cc"], input[name="bcc"], [data-name="cc"], [data-name="bcc"], [name="cc"], [name="bcc"]',
      ),
    ].some(
      (el) =>
        !body.contains(el) &&
        (String(el.value || '').trim() ||
          el.querySelector('[email], [data-recipient-id]') ||
          validEmail(
            el.getAttribute('email') || el.getAttribute('data-recipient-id'),
          )),
    );
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
    clone.querySelectorAll('.glyph-native-footer').forEach((el) => el.remove());
    return clone;
  }
  function snapshot(state) {
    return JSON.stringify({
      to: recipients(state.root, state.body),
      subject: subject(state.root),
      from: sender(state.root),
      ccBcc: hasCcBcc(state.root, state.body),
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
      const to = recipients(state.root, state.body);
      const from = sender(state.root);
      if (!from)
        throw new Error(
          'Cannot verify the active Gmail account. Open Gmail with the connected account.',
        );
      if (from !== ctx.email.toLowerCase())
        throw new Error(`Switch Gmail to ${ctx.email} before adding a glyph.`);
      if (to.length !== 1)
        throw new Error(
          'Use exactly one To recipient and no CC/BCC recipients.',
        );
      if (hasCcBcc(state.root, state.body))
        throw new Error(
          'CC/BCC is not supported for recipient-specific tracking.',
        );
      const title = subject(state.root);
      const text = cleanClone(state.body).textContent.trim();
      if (!title || !text)
        throw new Error('Add a subject and message before adding a glyph.');
      if (!state.opens.checked && !state.clicks.checked)
        throw new Error('Enable open or link tracking.');
      const before = snapshot(state);
      const response = await request('prepare', {
        composeKey: state.composeKey,
        recipientEmail: to[0],
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
      setStatus(state, `Glyph ready · ${to[0]} · use Gmail Send`);
    } catch (error) {
      preparationFailed(state, error);
    } finally {
      state.busy = false;
      state.button.disabled = !!state.disconnected;
    }
  }
  function attach(body, root) {
    const handlers = [];
    const on = (...args) => handlers.push(listen(...args));
    const toolbar = document.createElement('div');
    toolbar.className = 'glyph-native-toolbar';
    toolbar.setAttribute('contenteditable', 'false');
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
    const opens = check('Opens'),
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
    status.textContent = 'Rich-text mode · 1 recipient';
    toolbar.append(button, recovery, status);
    const caveat = document.createElement('small');
    caveat.textContent =
      'Signals only, not verified reads. Proxies, scanners and forwarding can affect attribution.';
    toolbar.append(caveat);
    body.parentElement.insertBefore(toolbar, body);
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
  globalThis.glyphCompose = {
    dispose() {
      disposed = true;
      observer.disconnect();
      for (const cleanup of cleanups) cleanup();
      for (const state of live) {
        if (state.attached) restore(state);
        state.toolbar.remove();
      }
      live.clear();
    },
  };
  scan();
})();
