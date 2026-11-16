const $ = id => document.getElementById(id);

async function getLogin(token) {
  const res = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new Error('This token is invalid or expired.');
  if (!res.ok) throw new Error(`GitHub returned ${res.status}.`);
  const { login } = await res.json();
  return login;
}

function showStatus(connected, message, tone = '') {
  $('status').textContent = message;
  $('status').className = tone;
  $('connect').hidden = connected;
  $('disconnect').hidden = !connected;
}

async function init() {
  const { token, autoOpen = true } = await chrome.storage.local.get(['token', 'autoOpen']);
  $('autoOpen').checked = autoOpen;
  if (!token) return showStatus(false, 'Not connected.');

  try {
    showStatus(true, `Connected as @${await getLogin(token)}.`, 'ok');
  } catch (err) {
    showStatus(false, `${err.message} Paste a new token below.`, 'error');
  }
}

$('connect').addEventListener('submit', async event => {
  event.preventDefault();
  const token = $('token').value.trim();
  $('status').textContent = 'Checking token…';

  try {
    const login = await getLogin(token);
    await chrome.storage.local.set({ token });
    $('token').value = '';
    showStatus(true, `Connected as @${login}.`, 'ok');
  } catch (err) {
    showStatus(false, err.message, 'error');
  }
});

$('disconnect').addEventListener('click', async () => {
  await chrome.storage.local.remove('token');
  showStatus(false, 'Disconnected. The token was removed from this browser.');
});

$('autoOpen').addEventListener('change', event => {
  chrome.storage.local.set({ autoOpen: event.target.checked });
});

init();
