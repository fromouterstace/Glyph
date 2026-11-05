const $ = (id) => document.getElementById(id);
const originPolicy = globalThis.GlyphOriginPolicy;
$('origin').value = originPolicy.publishedOrigin;
const send = async (action, extra = {}) => {
  const response = await globalThis.glyphMessaging.send({
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
    if (status.origin)
      $('origin').value = originPolicy.appOrigin(status.origin);
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
    const origin = originPolicy.appOrigin($('origin').value.trim());
    // Permission request stays inside this explicit user gesture.
    const granted = await chrome.permissions.request({
      origins: [`${origin}/*`],
    });
    if (!granted) throw new Error('Access to the Glyph app was not approved.');
    await send('connect', { origin });
    $('state').textContent = 'Sign in on the Glyph tab';
    $('account').textContent = 'Then return here and check the connection.';
  } catch (e) {
    $('error').textContent = e.message;
  }
});
$('refresh').addEventListener('click', refresh);
$('disconnect').addEventListener('click', async () => {
  try {
    await send('disconnect');
    $('state').textContent = 'Disconnected';
    $('account').textContent = '';
  } catch (e) {
    $('error').textContent = e.message;
  }
});
void refresh();
