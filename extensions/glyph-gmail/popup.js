const $ = (id) => document.getElementById(id);
const send = async (action, extra = {}) => {
  const response = await chrome.runtime.sendMessage({
    channel: 'glyph:background',
    action,
    ...extra,
  });
  if (!response?.ok) throw new Error(response?.error || 'Connection failed.');
  return response.data;
};
async function refresh() {
  $('error').textContent = '';
  try {
    const status = await send('status');
    if (
      status.origin &&
      !new URL(status.origin).hostname.endsWith('.replit.dev')
    )
      $('origin').value = status.origin;
    $('state').textContent = status.connected
      ? 'Connected to Gmail'
      : 'Connection needs attention';
    $('account').textContent = status.connected
      ? status.email
      : status.error || 'Connect your Glyph app.';
  } catch (e) {
    $('error').textContent = e.message;
  }
}
$('connect').addEventListener('click', async () => {
  $('error').textContent = '';
  try {
    const url = new URL($('origin').value.trim());
    if (
      url.protocol !== 'https:' ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error(
        'Paste the HTTPS app origin only, without /app or /gmail.',
      );
    if (url.hostname.endsWith('.replit.dev'))
      throw new Error('Use the published Glyph address, not a preview URL.');
    // Permission request stays inside this explicit user gesture.
    const granted = await chrome.permissions.request({
      origins: [`${url.origin}/*`],
    });
    if (!granted) throw new Error('Access to the Glyph app was not approved.');
    await send('connect', { origin: url.origin });
    $('state').textContent = 'Sign in on the Glyph tab';
    $('account').textContent = 'Then return here and check the connection.';
  } catch (e) {
    $('error').textContent = e.message;
  }
});
$('refresh').addEventListener('click', refresh);
$('disconnect').addEventListener('click', async () => {
  try {
    const { origin } = await chrome.storage.local.get('origin');
    await send('disconnect');
    if (origin) await chrome.permissions.remove({ origins: [`${origin}/*`] });
    $('state').textContent = 'Disconnected';
    $('account').textContent = '';
  } catch (e) {
    $('error').textContent = e.message;
  }
});
void refresh();
