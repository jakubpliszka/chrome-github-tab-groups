const GROUPS = [
  { title: 'GitHub PRs', color: 'purple', queries: ['is:pr is:open author:@me', 'is:pr is:open assignee:@me'] },
  { title: 'GitHub Issues', color: 'green', queries: ['is:issue is:open assignee:@me'] },
];

const ITEM_PATTERNS = ['https://github.com/*/pull/*', 'https://github.com/*/issues/*'];
const REFRESH_MINUTES = 5;
const MIN_REFRESH_INTERVAL = 60_000; // the search API allows 30 requests per minute

// Tabs that haven't left the new tab page yet. Only these get closed as duplicates.
const newTabs = new Set();
let queue = Promise.resolve();

// Strips subpages and anchors: .../pull/1/files#x -> .../pull/1
function itemUrl(url) {
  return url?.match(/^https:\/\/github\.com\/[^/]+\/[^/]+\/(pull|issues)\/\d+/)?.[0];
}

async function search(token, query) {
  const res = await fetch(`https://api.github.com/search/issues?per_page=100&q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub search failed (${res.status})`);
  const { items } = await res.json();
  return items.map(item => item.html_url);
}

async function refresh() {
  const { token } = await chrome.storage.local.get('token');
  if (!token) return setError('Click to connect GitHub');

  const owners = {};
  try {
    for (const group of GROUPS) {
      for (const query of group.queries) {
        for (const url of await search(token, query)) owners[url] = group.title;
      }
    }
  } catch (err) {
    console.warn(err);
    return setError(`${err.message}. Click to fix.`);
  }

  setError(null);
  await chrome.storage.session.set({ owners, refreshedAt: Date.now() });
  await openNewItems(Object.keys(owners));
}

function setError(message) {
  chrome.action.setBadgeText({ text: message ? '!' : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#d1242f' });
  chrome.action.setTitle({ title: message ? `GitHub Tab Groups: ${message}` : 'GitHub Tab Groups' });
}

// Opens items that weren't there on the last refresh, like a newly assigned issue.
// The first refresh only remembers what exists, so connecting doesn't open dozens of tabs.
async function openNewItems(urls) {
  const { seen, autoOpen = true } = await chrome.storage.local.get(['seen', 'autoOpen']);
  if (seen && autoOpen) {
    const added = urls.filter(url => !seen.includes(url));
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
    if (added.length && !win) return; // try again on the next refresh

    const open = new Set((await chrome.tabs.query({ url: ITEM_PATTERNS })).map(tab => itemUrl(tab.url)));
    for (const url of added) {
      if (!open.has(url)) await chrome.tabs.create({ windowId: win.id, url, active: false });
    }
  }
  await chrome.storage.local.set({ seen: urls });
}

async function groupFor(url) {
  let { owners = {}, refreshedAt = 0 } = await chrome.storage.session.get(['owners', 'refreshedAt']);
  if (!owners[url] && Date.now() - refreshedAt > MIN_REFRESH_INTERVAL) {
    await refresh();
    ({ owners = {} } = await chrome.storage.session.get('owners'));
  }
  return GROUPS.find(group => group.title === owners[url]);
}

// Finds the group by the tabs inside it, so it still works after the user renames it.
async function findGroup(windowId, group) {
  const { owners = {} } = await chrome.storage.session.get('owners');
  const counts = new Map();
  for (const tab of await chrome.tabs.query({ windowId })) {
    if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) continue;
    if (owners[itemUrl(tab.url)] === group.title) counts.set(tab.groupId, (counts.get(tab.groupId) ?? 0) + 1);
  }
  if (counts.size) return [...counts].sort((a, b) => b[1] - a[1])[0][0];

  const [byTitle] = await chrome.tabGroups.query({ windowId, title: group.title });
  return byTitle?.id;
}

// `nav` is only passed for user navigations. Background sweeps never switch tabs.
async function handleTab(tab, nav) {
  const url = itemUrl(tab.url);
  if (!url || tab.pinned) return;

  const group = await groupFor(url);
  if (!group) return;
  if (nav && (await switchToExisting(tab, url, group, nav.isNewTab))) return;

  await addToGroup(tab, group);
  await moveGroupsToFront(tab.windowId);
}

async function switchToExisting(tab, url, group, isNewTab) {
  const groupIds = [];
  for (const win of await chrome.windows.getAll()) groupIds.push(await findGroup(win.id, group));

  const existing = (await chrome.tabs.query({})).find(
    t => t.id !== tab.id && groupIds.includes(t.groupId) && itemUrl(t.url) === url,
  );
  if (!existing) return false;

  await chrome.tabs.update(existing.id, { active: true, ...(existing.url !== tab.url && { url: tab.url }) });
  await chrome.windows.update(existing.windowId, { focused: true });

  // Close a new tab, but send a tab with history back so its previous page isn't lost.
  if (isNewTab) await chrome.tabs.remove(tab.id);
  else await chrome.tabs.goBack(tab.id).catch(() => chrome.tabs.remove(tab.id));
  return true;
}

async function addToGroup(tab, group) {
  const groupId = await findGroup(tab.windowId, group);
  if (groupId === tab.groupId) return;
  if (groupId !== undefined) return chrome.tabs.group({ tabIds: tab.id, groupId });

  const newGroupId = await chrome.tabs.group({ tabIds: tab.id, createProperties: { windowId: tab.windowId } });
  await chrome.tabGroups.update(newGroupId, { title: group.title, color: group.color });
}

// Pinned tabs can't be in a group, so right after them is as close to pinned as it gets.
async function moveGroupsToFront(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  let index = tabs.filter(tab => tab.pinned).length;

  for (const group of GROUPS) {
    const groupId = await findGroup(windowId, group);
    if (groupId === undefined) continue;
    await chrome.tabGroups.move(groupId, { index });
    index += tabs.filter(tab => tab.groupId === groupId).length;
  }
}

async function sweep() {
  await refresh();
  for (const tab of await chrome.tabs.query({ url: ITEM_PATTERNS })) await handleTab(tab);
  for (const win of await chrome.windows.getAll()) await moveGroupsToFront(win.id);
}

// Run one job at a time, otherwise two events can create the same group twice.
function enqueue(job) {
  queue = queue.then(job).catch(console.warn);
}

chrome.tabs.onCreated.addListener(tab => newTabs.add(tab.id));
chrome.tabs.onRemoved.addListener(tabId => newTabs.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!change.url) return;
  const isNewTab = newTabs.has(tabId);
  if (!change.url.startsWith('chrome://newtab')) newTabs.delete(tabId);
  enqueue(() => handleTab(tab, { isNewTab }));
});

chrome.alarms.create('refresh', { periodInMinutes: REFRESH_MINUTES });
chrome.alarms.onAlarm.addListener(() => enqueue(sweep));
chrome.runtime.onStartup.addListener(() => enqueue(sweep));

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { token } = await chrome.storage.local.get('token');
  if (reason === 'install' && !token) chrome.runtime.openOptionsPage();
  enqueue(sweep);
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.token) return;
  // A new account starts fresh, so its existing items aren't opened as "new".
  await chrome.storage.local.remove('seen');
  if (!changes.token.newValue) await chrome.storage.session.set({ owners: {}, refreshedAt: 0 });
  enqueue(sweep);
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
