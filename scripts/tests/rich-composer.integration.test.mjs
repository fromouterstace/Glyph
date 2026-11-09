import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import {
  serviceHarness,
  edge,
  defaultProvider,
  json,
} from './helpers/service-harness.mjs';

const store = vi.hoisted(() => ({ files: new Map(), next: 0 }));
vi.mock('../../artifacts/api-server/src/lib/objectStorage', () => ({
  ObjectStorageService: class {
    async getObjectEntityUploadURL() {
      const path = `/objects/uploads/${++store.next}`;
      store.files.set(path, { bytes: Buffer.from('abc'), generation: '1' });
      return `https://storage.googleapis.com/fixture${path}`;
    }
    normalizeObjectEntityPath(url) {
      return new URL(url).pathname.replace('/fixture', '');
    }
    async getObjectEntityFile(path) {
      const value = store.files.get(path);
      if (!value)
        throw Object.assign(new Error('Missing fixture file'), {
          name: 'ObjectNotFoundError',
        });
      return {
        name: path,
        getMetadata: async () => [
          { size: String(value.bytes.length), generation: value.generation },
        ],
        delete: async () => store.files.delete(path),
        bucket: {
          file: (_name, options) => ({
            download: async ({ start, end }) => {
              if (options.generation !== value.generation)
                throw Object.assign(new Error('Missing generation'), {
                  code: 404,
                });
              return [value.bytes.subarray(start, end + 1)];
            },
          }),
        },
      };
    }
  },
}));
let h;
beforeAll(async () => {
  h = await serviceHarness();
});
afterAll(async () => {
  await h?.close();
});
const draft = (attachmentIds = []) => ({
  recipientEmail: 'recipient@example.invalid',
  recipientName: '',
  subject: 'Rich fixture',
  body: 'Hello offer https://example.org/plain',
  bodyHtml:
    '<p><strong>Hello</strong> <a href="https://example.org/offer">offer</a> https://example.org/plain</p>',
  trackOpens: true,
  trackClicks: true,
  attachmentIds,
});
async function upload(user, ready = true) {
  const response = await h.request('/attachments', {
    user,
    method: 'POST',
    body: { name: 'report.txt', size: 3, contentType: 'text/plain' },
  });
  expect(response.status).toBe(201);
  const pending = await response.json();
  if (ready)
    expect(
      (
        await h.request(`/attachments/${pending.attachment.id}/complete`, {
          user,
          method: 'POST',
        })
      ).status,
    ).toBe(200);
  return pending;
}
test('attachment routes require sign-in, matching origin and mailbox authorization', async () => {
  expect(
    (await h.request('/attachments', { method: 'POST', body: {} })).status,
  ).toBe(401);
  expect((await h.request('/attachments/unknown')).status).toBe(401);
  const user = h.identity();
  expect(
    (
      await h.request('/attachments', {
        user,
        method: 'POST',
        body: {},
        headers: { origin: 'https://attacker.invalid' },
      })
    ).status,
  ).toBe(403);
});
test('files are private, generation-pinned, persisted with rich drafts and never expose storage paths', async () => {
  const user = h.identity();
  const { attachment } = await upload(user);
  const response = await h.request('/messages', {
    user,
    method: 'POST',
    body: {
      ...draft([attachment.id]),
      bodyHtml: `${draft().bodyHtml}<img src=x onerror=bad()><script>bad()</script>`,
    },
  });
  expect(response.status).toBe(201);
  const message = await response.json();
  expect(message.attachments).toEqual([attachment]);
  expect(message.bodyHtml).toContain('<strong>Hello</strong>');
  expect(message.bodyHtml).not.toMatch(/script|img|onerror/);
  expect(JSON.stringify(message)).not.toMatch(
    /objectPath|generation|ownerId|uploadUrl/,
  );
  const reopened = await (
    await h.request(`/messages/${message.id}`, { user })
  ).json();
  expect(reopened.message.bodyHtml).toBe(message.bodyHtml);
  const file = await h.request(`/attachments/${attachment.id}`, { user });
  expect(file.status).toBe(200);
  expect(file.headers.get('content-disposition')).toContain('attachment;');
  expect(file.headers.get('cache-control')).toBe('private, no-store');
  expect(await file.text()).toBe('abc');
});
test('cross-owner read, finalization, deletion and attachment reuse are all rejected', async () => {
  const owner = h.identity(),
    other = h.identity();
  const { attachment } = await upload(owner);
  for (const [method, suffix] of [
    ['GET', ''],
    ['DELETE', ''],
    ['POST', '/complete'],
  ]) {
    const result = await h.request(`/attachments/${attachment.id}${suffix}`, {
      user: other,
      method,
    });
    expect(result.status).toBe(404);
    expect(await result.text()).not.toContain('report.txt');
  }
  expect(
    (
      await h.request('/messages', {
        user: other,
        method: 'POST',
        body: draft([attachment.id]),
      })
    ).status,
  ).toBe(400);
});
test('unknown, duplicate and unfinished attachments cannot enter saved drafts', async () => {
  const owner = h.identity();
  const { attachment } = await upload(owner, false);
  for (const ids of [
    ['00000000-0000-4000-8000-000000000000'],
    [attachment.id],
    [attachment.id, attachment.id],
  ]) {
    expect(
      (
        await h.request('/messages', {
          user: owner,
          method: 'POST',
          body: draft(ids),
        })
      ).status,
    ).toBe(400);
  }
});
test('oversized or mismatched actual uploads are rejected and cleaned up', async () => {
  const owner = h.identity();
  const pending = await upload(owner, false);
  const path = new URL(pending.uploadUrl).pathname.replace('/fixture', '');
  store.files.get(path).bytes = Buffer.from('unexpected larger contents');
  expect(
    (
      await h.request(`/attachments/${pending.attachment.id}/complete`, {
        user: owner,
        method: 'POST',
      })
    ).status,
  ).toBe(400);
  expect(store.files.has(path)).toBe(true);
  expect(
    (await h.request(`/attachments/${pending.attachment.id}`, { user: owner }))
      .status,
  ).toBe(404);
});
test('referenced files cannot be retired; removed attachment records and bytes are retained', async () => {
  const user = h.identity();
  const { attachment } = await upload(user);
  const message = await (
    await h.request('/messages', {
      user,
      method: 'POST',
      body: draft([attachment.id]),
    })
  ).json();
  expect(
    (
      await h.request(`/attachments/${attachment.id}`, {
        user,
        method: 'DELETE',
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await h.request(`/messages/${message.id}`, {
        user,
        method: 'PATCH',
        body: draft([]),
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await h.request(`/attachments/${attachment.id}`, {
        user,
        method: 'DELETE',
      })
    ).status,
  ).toBe(204);
  expect(
    (
      await h.sql('SELECT retired_at FROM glyph_attachments WHERE id=$1', [
        attachment.id,
      ])
    ).rows[0].retired_at,
  ).not.toBeNull();
  expect(store.files.size).toBeGreaterThan(0);
  expect(
    (await h.request(`/attachments/${attachment.id}`, { user })).status,
  ).toBe(404);
});
test('rich formatting and exact attachment bytes reach the Gmail MIME request, not real Gmail', async () => {
  const user = h.identity();
  const { attachment } = await upload(user);
  const message = await (
    await h.request('/messages', {
      user,
      method: 'POST',
      body: draft([attachment.id]),
    })
  ).json();
  let mime;
  edge.proxy.mockImplementation((integration, path, options) => {
    if (path.endsWith('/messages/send')) {
      mime = Buffer.from(JSON.parse(options.body).raw, 'base64url').toString();
      return json({ id: 'synthetic-gmail-send' });
    }
    return defaultProvider(integration, path);
  });
  const sent = await h.request(`/messages/${message.id}/send`, {
    user,
    method: 'POST',
  });
  expect(sent.status).toBe(200);
  expect(mime).toContain('multipart/mixed');
  expect(mime).toContain("filename*=UTF-8''report.txt");
  expect(mime).toContain(Buffer.from('abc').toString('base64'));
  const encodedHtml = mime.match(
    /Content-Type: text\/html[^]*?base64\r\n\r\n([^]*?)\r\n--/,
  )[1];
  const html = Buffer.from(
    encodedHtml.replaceAll('\r\n', ''),
    'base64',
  ).toString();
  expect(html).toContain('<strong>Hello</strong>');
  expect(html).toContain('/api/glyph/l/');
  expect(html.match(/<a href=/g)).toHaveLength(2);
  expect(html.match(/<img /g)).toHaveLength(1);
});
test('an overwritten finalized file never sends substituted bytes or claims a send', async () => {
  const user = h.identity();
  const pending = await upload(user);
  const message = await (
    await h.request('/messages', {
      user,
      method: 'POST',
      body: draft([pending.attachment.id]),
    })
  ).json();
  const path = new URL(pending.uploadUrl).pathname.replace('/fixture', '');
  store.files.get(path).generation = '2';
  store.files.get(path).bytes = Buffer.from('xyz');
  const before = edge.proxy.mock.calls.filter(([, url]) =>
    url.endsWith('/messages/send'),
  ).length;
  const response = await h.request(`/messages/${message.id}/send`, {
    user,
    method: 'POST',
  });
  expect(response.status).toBe(503);
  expect((await response.json()).error).toContain(
    'attachment could not be loaded',
  );
  const { rows } = await h.sql(
    'SELECT status FROM glyph_messages WHERE id=$1',
    [message.id],
  );
  expect(rows[0].status).toBe('draft');
  expect(
    edge.proxy.mock.calls.filter(([, url]) => url.endsWith('/messages/send')),
  ).toHaveLength(before);
});
test('Unicode plain text and formatted HTML can exceed 100 KiB within their character limits', async () => {
  const user = h.identity();
  const body = '界'.repeat(18000);
  const input = { ...draft(), body, bodyHtml: `<p>${body}</p>` };
  expect(Buffer.byteLength(JSON.stringify(input))).toBeGreaterThan(100 * 1024);
  const response = await h.request('/messages', {
    user,
    method: 'POST',
    body: input,
  });
  expect(response.status).toBe(201);
  expect((await response.json()).bodyHtml).toBe(input.bodyHtml);
});

test('retrying a confirmed web send returns the persisted message without another provider submission', async () => {
  const user = h.identity();
  const message = await (
    await h.request('/messages', {
      user,
      method: 'POST',
      body: draft(),
    })
  ).json();
  const submissions = [];
  edge.proxy.mockImplementation((integration, path, options) => {
    if (path.endsWith('/messages/send')) {
      submissions.push(JSON.parse(options.body).raw);
      return json({ id: 'synthetic-idempotent-send' });
    }
    return defaultProvider(integration, path);
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await h.request(`/messages/${message.id}/send`, {
      user,
      method: 'POST',
    });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe('sent');
  }
  expect(submissions).toHaveLength(1);
  const reopened = await (
    await h.request(`/messages/${message.id}`, { user })
  ).json();
  expect(reopened.message.status).toBe('sent');
  expect(reopened.message.bodyHtml).toContain('<strong>Hello</strong>');
  const { rows } = await h.sql(
    "SELECT count(*)::int AS count FROM glyph_events WHERE message_id=$1 AND type='sent'",
    [message.id],
  );
  expect(rows[0].count).toBe(1);
});
