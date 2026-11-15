import {chooseCHGame, grantedCHGame, installHelper, Link, SerialCard} from './serial.mjs';
import {CATEGORY_TITLE_LIMIT, changedFolders, moveCarts, newCategory, organizeFolder, planRemoval, readPoster, renameCategory, resetMenu, sameMenuSnapshot, saveMenu, scanMenu, stageRemoval} from './menu.mjs';
import {describePackage, linkedPackageUrl, packageSourceUrl, planImport, prepareLinkedPackage, preparePackage, writeImport} from './import.mjs';
import {coverStyle, generateCover} from './cover.mjs';

const $ = id => document.getElementById(id);
const embedded = JSON.parse($('embedded-assets')?.textContent ?? 'null');
const inspector = $('inspector');
const shelf = $('shelf');
const insertionBar = $('insertion-bar');
const guidance = 'Drag covers to reorder. Drop a .chgame to choose where its games go.';
const helperApprovalKey = 'chgame.organizer.allow-helper';
const offline = {title: 'Your SD menu', path: 'GAMES', directory: true, entries: []};
let menu = {root: offline, folders: []};
let folder = offline;
let selected = null;
let selection = new Set();
let selectionAnchor = null;
let card = null;
let busy = false;
let stale = false;
let dragged = null;
let scanTime = 0;
let posterWork = 0;
let posterQueue = Promise.resolve();
let helperApproved = false;
let preferredPort;
let lostLink;
let disconnecting = false;
let reconnectTimer;
let reconnectPending = false;
let helperExit;
let usbState = 'Disconnected';
let cartPreview;
let previewRequest = 0;
let previewCoverUrl;

function el(tag, label, className) {
  const node = document.createElement(tag);
  if (label !== undefined) node.textContent = label;
  if (className) node.className = className;
  return node;
}

function button(label, action, disabled = false) {
  const node = el('button', label);
  node.disabled = disabled;
  node.addEventListener('click', action);
  return node;
}

function report(message, error = false) {
  if ($('transfer').dataset.state === 'active' && !error) {
    transferStep(message);
    return;
  }
  $('status').hidden = false;
  $('status').textContent = message;
  $('status').dataset.error = error;
}

function beginTransfer(title, phase) {
  $('status').hidden = true;
  $('transfer').dataset.state = 'active';
  $('transfer').hidden = false;
  $('transfer-title').textContent = title;
  $('transfer-track').hidden = false;
  transferStep(phase);
}

function transferStep(phase, {file, fileNumber, fileCount, done, total} = {}) {
  const currentPhase = $('transfer-phase');
  if (currentPhase.textContent !== phase) currentPhase.textContent = phase;
  const currentFile = $('transfer-file');
  currentFile.hidden = !file;
  if (currentFile.textContent !== (file ?? '')) currentFile.textContent = file ?? '';
  const track = $('transfer-track');
  const percent = total ? Math.floor(100 * done / total) : null;
  const label = fileCount ? `File ${fileNumber} of ${fileCount}${percent === null ? '' : ` · ${percent}%`}` : '';
  if ($('transfer-count').textContent !== label) $('transfer-count').textContent = label;
  if (percent === null) track.removeAttribute('aria-valuenow');
  else track.setAttribute('aria-valuenow', percent);
  $('transfer-fill').style.width = percent === null ? '' : `${percent}%`;
}

function finishTransfer(title, message, error = false) {
  $('transfer').dataset.state = error ? 'error' : 'done';
  $('transfer-title').textContent = title;
  transferStep(message);
  $('transfer-track').hidden = true;
}

function imageFor(entry) {
  const fallback = entry.path === 'GAMES' ? 'cover' : entry.directory ? 'folder' : 'game';
  return entry.preview || embedded?.art[fallback] || 'assets/' + fallback + '.png';
}

function openFolder(next) {
  if (busy || !next) return;
  folder = next;
  setSelection([]);
  render();
}

function setSelection(entries, active = entries.at(-1)) {
  selection = new Set(entries);
  selected = active ?? null;
  selectionAnchor = selected;
}

function updateSelection(entry, {range = false, toggle = false, anchor = entry} = {}) {
  const entries = folder.entries;
  if (range) {
    const start = entries.indexOf(selectionAnchor ?? anchor);
    const end = entries.indexOf(entry);
    if (!toggle) selection.clear();
    for (const item of entries.slice(Math.min(start, end), Math.max(start, end) + 1)) selection.add(item);
    selectionAnchor ??= anchor;
  } else if (toggle) {
    if (!selection.delete(entry)) selection.add(entry);
    selectionAnchor = entry;
  } else {
    setSelection([entry]);
  }
  selected = selection.has(entry) ? entry : [...selection].at(-1) ?? null;
  const tiles = shelf.querySelectorAll('.tile-slot');
  for (const [i, item] of entries.entries()) {
    const pressed = selection.has(item);
    tiles[i].querySelector('.tile').setAttribute('aria-pressed', String(pressed));
    tiles[i].querySelector('input').checked = pressed;
  }
  renderInspector();
}

function shelfColumns() {
  return getComputedStyle(shelf).gridTemplateColumns.split(' ').length;
}

function parentFolder(current) {
  const path = current.path.slice(0, current.path.lastIndexOf('/'));
  return menu.folders.find(item => item.path === path);
}

function locked(current = folder) {
  return busy || stale || !card || lostLink || current.editBlocked || current.overLimit;
}

function renderControls() {
  const changes = changedFolders(menu);
  const count = changes.length;
  const linked = Boolean(card && !lostLink);
  $('undo').disabled = busy || !count;
  $('save').disabled = busy || stale || !count || !linked;
  $('save').textContent = count ? `Save to SD (${count})` : 'Save to SD';
  $('import').disabled = busy;
  $('open-cart').hidden = folder !== offline;
  $('open-cart').disabled = busy;
  $('preview-dismiss').disabled = busy;
  $('preview-import').disabled = busy || !cartPreview?.pkg || stale || !linked || Boolean(count);
  const availability = !linked ? 'Connect your CHGame to install this cart.' :
    stale ? 'Rescan the SD card before installing.' :
    count ? 'Save or reset your menu changes before installing.' : '';
  $('preview-device').textContent = availability;
  $('preview-device').hidden = !cartPreview?.pkg || !availability;
  $('auto-organize').disabled = Boolean(locked()) || folder.entries.length < 2;
  $('newest-option').textContent = card?.timestamps ? 'Newest first' : 'Newest first · update helper';
  $('restore-order').disabled = !folder.manualOrder;
  $('rescan').disabled = busy;
  $('device-controls').hidden = !linked;
  $('connect').disabled = busy;
  $('connect').textContent = linked ? 'Disconnect CHGame' : 'Connect CHGame ↗';
  $('mode').dataset.live = linked || usbState === 'CHGame detected';
  $('mode-label').textContent = usbState === 'USB connected' && stale ? 'Connected · rescan needed' : usbState;
}

function render() {
  renderControls();
  const nav = $('categories');
  $('navigation').hidden = folder === offline;
  $('menu-toolbar').hidden = folder === offline;
  $('menu-content').hidden = folder === offline;
  const parent = parentFolder(folder);
  $('back-category').hidden = !parent;
  $('back-category').disabled = busy;
  $('back-category').setAttribute('aria-label', parent ? `Back to ${parent.title}` : 'Back');
  $('back-category').title = parent ? `Back to ${parent.title}` : '';
  $('remove-category').hidden = !parent;
  $('remove-category').disabled = !parent || locked(parent) || folder.new || Boolean(folder.record?.[11] & 1);
  $('category-label').textContent = folder.title;
  $('heading').setAttribute('aria-label', folder.title);
  $('category-label').hidden = Boolean(parent);
  $('rename-label').textContent = folder.title;
  $('rename-category').hidden = !parent;
  $('rename-category').disabled = !parent || locked(parent);
  $('rename-category').setAttribute('aria-label', `Rename category: ${folder.title}`);
  $('rename-category').title = 'Rename category';
  $('rename-form').hidden = true;
  $('heading').hidden = false;
  nav.replaceChildren();
  const shownFolders = menu.folders.length ? [menu.root] : [];
  for (let i = 0; i < shownFolders.length; i++) {
    const current = shownFolders[i];
    shownFolders.splice(i + 1, 0, ...current.entries.filter(entry => entry.directory && entry.entries));
    const tab = button('', () => openFolder(current), busy);
    const thumbnail = el('img', undefined, 'category-cover');
    thumbnail.src = imageFor(current);
    thumbnail.alt = '';
    thumbnail.dataset.poster = current.path;
    const parents = shownFolders.slice(1, i).filter(item => current.path.startsWith(item.path + '/'));
    const label = [...parents.map(parent => parent.title), current.title].join(' / ');
    tab.append(thumbnail, el('span', label));
    tab.title = label;
    if (folder === current) tab.setAttribute('aria-current', 'location');
    nav.append(tab);
    if (i === 0 && shownFolders.length > 1) {
      const divider = el('span', undefined, 'category-divider');
      divider.setAttribute('aria-hidden', 'true');
      nav.append(divider);
    }
  }
  $('cover').src = imageFor(folder);
  $('cover').dataset.poster = folder.path;
  const categories = folder.entries.filter(entry => entry.directory).length;
  const games = folder === menu.root
    ? shownFolders.reduce((total, item) => total + item.entries.filter(entry => !entry.directory).length, 0)
    : folder.entries.length - categories;
  $('summary').textContent = folder === offline ? 'Connect your CHGame over USB to open its SD card.' :
    `${games} ${games === 1 ? 'cart' : 'carts'}  ·  ${categories} ${categories === 1 ? 'category' : 'categories'}`;

  endDrag();
  shelf.replaceChildren(inspector, insertionBar);
  for (const [index, entry] of folder.entries.entries()) {
    const tile = button('', event => updateSelection(entry, {
      range: event.shiftKey, toggle: event.metaKey || event.ctrlKey,
    }), busy);
    tile.className = 'tile';
    tile.setAttribute('aria-pressed', String(selection.has(entry)));
    const image = el('img', undefined, 'poster');
    image.src = imageFor(entry);
    image.alt = '';
    image.dataset.poster = entry.path;
    image.loading = 'lazy';
    tile.append(image, el('strong', entry.title), el('small', entry.directory ? 'Category' :
      entry.compatible === false ? 'Other target or invalid cart' : (entry.version ? `Cart · v${entry.version}` : 'Cart')));
    tile.draggable = !locked();
    tile.ondblclick = () => { if (entry.entries) openFolder(entry); };
    tile.onkeydown = event => {
      if (!event.shiftKey) return;
      const step = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -shelfColumns(), ArrowDown: shelfColumns()}[event.key];
      if (!step) return;
      event.preventDefault();
      const next = index + step;
      if (!folder.entries[next]) return;
      updateSelection(folder.entries[next], {range: true, toggle: event.metaKey || event.ctrlKey, anchor: entry});
      shelf.querySelectorAll('.tile')[next].focus();
    };
    tile.ondragstart = event => {
      if (locked()) {
        event.preventDefault();
        return;
      }
      const entries = selection.has(entry) ? folder.entries.filter(item => selection.has(item)) : [entry];
      dragged = {entry, entries};
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', entry.path);
      const tiles = shelf.querySelectorAll('.tile');
      for (const [i, item] of folder.entries.entries()) if (entries.includes(item)) tiles[i].dataset.dragged = '';
    };
    tile.ondragend = endDrag;
    const slot = el('div', undefined, 'tile-slot');
    const check = el('input', undefined, 'tile-select');
    check.type = 'checkbox';
    check.checked = selection.has(entry);
    check.disabled = busy;
    check.setAttribute('aria-label', `Select ${entry.title}`);
    check.onchange = () => updateSelection(entry, {toggle: true});
    slot.append(tile, check);
    shelf.append(slot);
  }
  if (!folder.entries.length) shelf.append(el('p', 'This category is empty.'));
  renderInspector();
  queuePosters();
}

function insertionAt(x, y) {
  const tiles = Array.from(shelf.querySelectorAll('.tile-slot'), (tile, index) => ({
    rect: tile.getBoundingClientRect(), index,
  }));
  if (!tiles.length) return null;
  const distance = ({rect}) => Math.max(rect.top - y, y - rect.bottom, 0);
  const nearest = tiles.reduce((best, tile) => distance(tile) < distance(best) ? tile : best);
  const row = tiles.filter(tile => tile.rect.top === nearest.rect.top);
  const before = row.find(({rect}) => x < (rect.left + rect.right) / 2);
  const anchor = before ?? row.at(-1);
  return {
    boundary: anchor.index + Number(!before),
    edge: before ? anchor.rect.left : anchor.rect.right,
    rect: anchor.rect,
  };
}

shelf.addEventListener('dragover', event => {
  if (!dragged || locked()) return;
  const position = insertionAt(event.clientX, event.clientY);
  if (!position) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const bounds = shelf.getBoundingClientRect();
  insertionBar.style.left = `${Math.max(3, Math.min(bounds.width - 3, position.edge - bounds.left))}px`;
  insertionBar.style.top = `${position.rect.top - bounds.top + 6}px`;
  insertionBar.style.height = `${position.rect.height - 12}px`;
  insertionBar.hidden = false;
});

shelf.addEventListener('dragleave', event => {
  if (!dragged || shelf.contains(event.relatedTarget)) return;
  const bounds = shelf.getBoundingClientRect();
  if (event.relatedTarget || event.clientX <= bounds.left || event.clientX >= bounds.right ||
      event.clientY <= bounds.top || event.clientY >= bounds.bottom) insertionBar.hidden = true;
});

shelf.addEventListener('drop', event => {
  if (!dragged || locked()) return;
  const position = insertionAt(event.clientX, event.clientY);
  if (!position) return;
  event.preventDefault();
  const {entry, entries} = dragged;
  endDrag();
  const group = new Set(entries);
  const before = folder.entries.slice(0, position.boundary).filter(item => !group.has(item));
  const after = folder.entries.slice(position.boundary).filter(item => !group.has(item));
  const reordered = [...before, ...entries, ...after];
  if (reordered.every((item, index) => item === folder.entries[index])) return;
  folder.entries = reordered;
  setSelection(entries, entry);
  render();
  report(entries.length === 1 ? `${entry.title} moved to position ${before.length + 1}.` : `Moved ${entries.length} entries.`);
});

function endDrag() {
  dragged = null;
  insertionBar.hidden = true;
  for (const tile of shelf.querySelectorAll('[data-dragged]')) tile.removeAttribute('data-dragged');
}

function reorder(entry, to) {
  const from = folder.entries.indexOf(entry);
  if (locked() || from < 0 || from === to || to < 0 || to >= folder.entries.length) return;
  folder.entries.splice(from, 1);
  folder.entries.splice(to, 0, entry);
  setSelection([entry]);
  render();
  report(`${entry.title} moved to position ${to + 1}.`);
  inspector.querySelector(to > from ? '[data-later]' : '[data-earlier]')?.focus();
}

function renderInspector() {
  inspector.replaceChildren();
  const entries = folder.entries.filter(entry => selection.has(entry));
  inspector.hidden = !entries.length;
  if (!entries.length) return;
  const single = entries.length === 1;
  const entry = entries[0];
  const protectedEntry = entries.some(item => item.record?.[11] & 1);
  inspector.append(el('h2', single ? entry.title : `${entries.length} selected`));
  if (single) {
    inspector.append(el('small', entry.author || entry.name));
    if (entry.entries) inspector.append(button('Open category →', () => openFolder(entry), busy));
    const position = folder.entries.indexOf(entry);
    const controls = el('div', undefined, 'controls');
    const earlier = button('← Earlier', () => reorder(entry, position - 1), locked() || position <= 0);
    earlier.dataset.earlier = '';
    const later = button('Later →', () => reorder(entry, position + 1), locked() || position + 1 >= folder.entries.length);
    later.dataset.later = '';
    controls.append(earlier, later);
    inspector.append(controls);
  }

  if (entries.every(item => !item.directory)) {
    const select = el('select');
    select.setAttribute('aria-label', 'Move selection to category');
    select.append(new Option('Move to category…', ''));
    for (const next of menu.folders) {
      if (next === folder || locked(next) || menu.removals?.some(plan => plan.descendants.includes(next))) continue;
      const names = menu.folders.filter(ancestor => next.path.startsWith(ancestor.path + '/') && ancestor !== menu.root)
        .sort((a, b) => a.depth - b.depth).map(ancestor => ancestor.title);
      select.append(new Option([...names, next.title].join(' / '), next.path));
    }
    const create = new Option('New category…', 'new');
    create.disabled = Boolean(locked(menu.root));
    select.append(create);
    select.disabled = Boolean(locked()) || protectedEntry;
    select.onchange = () => {
      const destination = select.value;
      select.value = '';
      if (destination) moveSelection(folder, entries, destination);
    };
    inspector.append(select);
  }

  const label = single ? entry.directory ? 'Remove category' : 'Remove cart' : `Remove ${entries.length} selected`;
  const remove = button(label, () => removeEntries(folder, entries),
    locked() || protectedEntry || entries.some(item => item.new));
  remove.className = 'danger';
  inspector.append(remove);
  placeInspector();
}

function moveSelection(source, entries, destination) {
  return exclusive(async () => {
    let next;
    if (destination === 'new') {
      const result = await confirmAction({
        title: 'New category', message: 'Create a category under Main Menu and move the selection into it.',
        field: 'Category name', action: 'Create and move', generateArtwork: true,
      });
      if (!result) return;
      next = newCategory(menu, result.name);
      applyCategoryCover(next, result.art);
    } else {
      next = menu.folders.find(item => item.path === destination);
      if (!next) return;
    }
    moveCarts(source, next, entries);
    if (destination === 'new') {
      menu.folders.push(next);
      menu.root.entries.push(next);
    }
    folder = next;
    setSelection(entries);
    report(entries.length === 1 ? `${entries[0].title} moved to ${next.title}.` :
      `Moved ${entries.length} carts to ${next.title}.`);
  });
}

function applyCategoryCover(category, art) {
  category.coverBytes = art.bytes;
  category.coverStyle = art.style;
  category.preview = art.preview;
}

function placeInspector() {
  if (inspector.hidden || $('menu-content').hidden) return;
  const shelf = $('shelf');
  const tiles = [...shelf.querySelectorAll('.tile-slot')];
  const columns = shelfColumns();
  const index = folder.entries.indexOf(selected);
  if (index < 0 || !tiles.length) return;
  const firstInRow = index - index % columns;
  const lastInRow = Math.min(firstInRow + columns, tiles.length) - 1;
  inspector.style.setProperty('--selected-offset', `${(index % columns) / columns * 100}%`);
  if (tiles[lastInRow].nextElementSibling !== inspector) tiles[lastInRow].after(inspector);
}

new ResizeObserver(placeInspector).observe($('shelf'));

function removeEntries(parent, entries) {
  if (!parent) return;
  return exclusive(async () => {
    const plans = [];
    for (const entry of entries) plans.push(await planRemoval(menu, parent, entry, card));
    const single = entries.length === 1;
    const entry = entries[0];
    const title = single ? entry.directory ? 'Remove category?' : 'Remove cart?' : `Remove ${entries.length} selected entries?`;
    const carts = plans.reduce((count, plan) => count + plan.carts, 0);
    const hidden = plans.reduce((count, plan) => count + plan.hiddenCarts, 0);
    const metadata = plans.reduce((count, plan) => count + plan.metadata, 0);
    const message = single && !entry.directory ? `Remove “${entry.title}” from the SD card?` :
      `Remove ${single ? '“' + entry.title + '” and its ' : ''}${carts} ${carts === 1 ? 'cart' : 'carts'} from the SD card?`;
    const extras = [
      hidden ? `${hidden} hidden .CHG ${hidden === 1 ? 'file' : 'files'}` : '',
      metadata ? `${metadata} macOS metadata ${metadata === 1 ? 'file' : 'files'}` : '',
    ].filter(Boolean);
    if (!await confirmAction({
      title, message: message + (extras.length ? ' Also removes ' + extras.join(' and ') + '.' : ''),
      detail: 'This takes effect when you click Save to SD. Shared assets and player saves are kept.',
      action: 'Mark for removal', danger: true,
    })) return;
    for (const plan of plans) stageRemoval(menu, parent, plan);
    folder = parent;
    setSelection([]);
    report(`${single ? '“' + entry.title + '” is' : entries.length + ' entries are'} marked for removal. Click Save to SD to apply it.`);
  });
}

$('back-category').onclick = () => openFolder(parentFolder(folder));
$('remove-category').onclick = () => removeEntries(parentFolder(folder), [folder]);

const categoryName = $('category-name');
categoryName.maxLength = CATEGORY_TITLE_LIMIT;
$('rename-category').onclick = () => {
  $('heading').hidden = true;
  $('rename-form').hidden = false;
  categoryName.value = folder.title;
  categoryName.focus();
  categoryName.select();
};

function finishRename() {
  $('heading').hidden = false;
  $('rename-form').hidden = true;
  $('rename-category').focus();
}

$('rename-form').onsubmit = event => {
  event.preventDefault();
  const parent = parentFolder(folder);
  if (!parent || locked(parent)) return;
  const before = folder.title;
  try {
    renameCategory(parent, folder, categoryName.value);
    if (folder.new && folder.coverStyle && folder.title !== before) {
      applyCategoryCover(folder, generateCover(folder.title, folder.coverStyle));
    }
  } catch (error) {
    report(error.message, true);
    categoryName.focus();
    return;
  }
  render();
  finishRename();
  if (before !== folder.title) report(`Category renamed to “${folder.title}”. Click Save to SD to apply it.`);
};

$('cancel-rename').onclick = finishRename;
$('rename-form').onkeydown = event => {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  finishRename();
};

function queuePosters() {
  const device = card;
  if (!device || busy || stale || lostLink) return;
  const entries = new Set([folder, ...folder.entries, ...menu.folders.filter(category => category.cover)]);
  const version = ++posterWork;
  const root = menu.root;
  posterQueue = posterQueue.then(async () => {
    for (const entry of entries) {
      if (version !== posterWork) break;
      if (entry.preview || entry.posterMissing) continue;
      try {
        const data = await readPoster(device, entry, root);
        if (!data) {
          entry.posterMissing = true;
          continue;
        }
        const canvas = el('canvas');
        canvas.width = canvas.height = 128;
        canvas.getContext('2d').putImageData(new ImageData(data, 128, 128), 0, 0);
        entry.preview = canvas.toDataURL();
        for (const img of document.querySelectorAll('[data-poster]')) {
          if (img.dataset.poster === entry.path) img.src = entry.preview;
        }
      } catch {
        entry.posterMissing = true;
      }
    }
  });
}

async function exclusive(action) {
  if (busy) return;
  busy = true;
  $('transfer').hidden = true;
  $('transfer').removeAttribute('data-state');
  posterWork++;
  render();
  try {
    await posterQueue;
    await action();
  } catch (error) {
    if (!lostLink && error.name !== 'NotFoundError') report(error.message, true);
  } finally {
    if (lostLink) {
      await lostLink.close();
      card = null;
      lostLink = null;
      report(stale
        ? 'USB disconnected. The last operation may be incomplete. Reconnect and rescan the SD.'
        : 'USB disconnected. Waiting for CHGame to reconnect.', true);
    }
    busy = false;
    render();
    if (reconnectPending) queueReconnect();
  }
}

async function scan({reconnecting = false} = {}) {
  const started = performance.now();
  const last = folder.path;
  const fresh = await scanMenu(card, current => report(`Reading ${current.title}…`));
  if (reconnecting && changedFolders(menu).length) {
    stale ||= !sameMenuSnapshot(menu, fresh);
    if (!stale) {
      const dates = new Map(fresh.folders.flatMap(item => item.original.map(entry => [entry.path, entry.modified])));
      for (const item of menu.folders) for (const entry of item.original) entry.modified = dates.get(entry.path);
    }
    report(stale
      ? 'CHGame reconnected. Rescan the SD before saving changes.'
      : 'CHGame reconnected. Your pending changes are ready to save.', stale);
    return;
  }
  menu = fresh;
  folder = menu.folders.find(item => item.path === last) ?? menu.root;
  setSelection([]);
  stale = false;
  scanTime = ((performance.now() - started) / 1000).toFixed(1);
  report(`${reconnecting ? 'CHGame reconnected. ' : ''}SD menu read in ${scanTime}s. ${guidance}`);
}

function showDisconnected() {
  card = null;
  stale = false;
  menu = {root: offline, folders: []};
  folder = offline;
  setSelection([]);
  usbState = 'Disconnected';
}

async function helperImage() {
  let info = embedded?.helper;
  let image;
  if (info) {
    image = Uint8Array.from(atob(info.data), char => char.charCodeAt(0));
  } else {
    const [binary, manifest] = await Promise.all([fetch('build/helper.bin'), fetch('build/helper.json')]);
    if (!binary.ok || !manifest.ok) throw new Error('Build the Rev0 SD helper before starting this page.');
    info = await manifest.json();
    image = new Uint8Array(await binary.arrayBuffer());
  }
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', image));
  const digest = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
  if (info.target !== 'rev0' || info.bytes !== image.length || info.sha256 !== digest) {
    throw new Error('The SD helper does not match its build manifest');
  }
  return image;
}

function showDialog(dialog) {
  dialog.returnValue = 'cancel';
  const closed = new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue), {once: true});
  });
  dialog.showModal();
  return closed;
}

async function confirmAction({title, message, detail, action, danger = false, choices, field, generateArtwork = false}) {
  $('confirmation-title').textContent = title;
  $('confirmation-message').textContent = message;
  const extra = $('confirmation-detail');
  extra.textContent = detail ?? '';
  extra.hidden = !detail;
  const accept = $('confirmation-accept');
  accept.textContent = action;
  accept.classList.toggle('danger', danger);
  const options = $('confirmation-choices');
  options.hidden = !choices;
  options.replaceChildren();
  if (choices) {
    options.append(el('legend', 'Destination'));
    for (const [index, choice] of choices.entries()) {
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'destination';
      radio.value = choice.value;
      radio.checked = index === 0;
      const label = el('label');
      const copy = el('span');
      copy.append(el('strong', choice.label), el('small', choice.detail));
      label.append(radio, copy);
      options.append(label);
    }
  }
  const input = $('confirmation-input');
  $('confirmation-field').hidden = !field;
  $('confirmation-field-label').textContent = field ?? '';
  input.value = '';
  input.required = Boolean(field);
  input.maxLength = CATEGORY_TITLE_LIMIT;
  $('cover-generator').hidden = !generateArtwork;
  let art;
  if (generateArtwork) {
    let style = coverStyle();
    const draw = () => {
      art = generateCover(input.value, style);
      $('generated-cover').src = art.preview;
    };
    input.oninput = draw;
    $('shuffle-cover').onclick = () => {
      style = coverStyle(style);
      draw();
    };
    draw();
  }
  const closed = showDialog($('confirmation'));
  if (field) input.focus();
  const result = await closed;
  input.oninput = null;
  $('shuffle-cover').onclick = null;
  if (result !== 'accept') return false;
  if (generateArtwork) return {name: input.value, art: generateCover(input.value, art.style)};
  return field ? input.value : choices ? options.querySelector(':checked').value : true;
}

$('confirmation-cancel').onclick = () => $('confirmation').close('cancel');

async function allowHelperUpload() {
  if (helperApproved) return true;
  try {
    if (localStorage.getItem(helperApprovalKey) === 'yes') return true;
  } catch {
    // Keep approval in memory when browser storage is unavailable.
  }

  if (await showDialog($('install-dialog')) !== 'install') return false;

  helperApproved = true;
  try {
    localStorage.setItem(helperApprovalKey, 'yes');
  } catch {
    // The current tab still remembers approval.
  }
  return true;
}

function usbLost(link) {
  if (disconnecting || card?.link !== link || lostLink) return;
  lostLink = link;
  usbState = 'USB disconnected';
  posterWork++;
  renderControls();
  report('USB disconnected. Waiting for CHGame to reconnect.', true);
  void link.close();
  reconnectPending = true;
  if (!busy) void exclusive(async () => {});
}

async function connectCard(link, automatic) {
  const reconnecting = usbState === 'USB disconnected' || folder !== offline;
  usbState = reconnecting ? 'Reconnecting…' : 'Connecting…';
  renderControls();
  preferredPort = link.port;
  try {
    card = await SerialCard.identify(link);
    if (!card) {
      usbState = 'CHGame detected';
      if (automatic) {
        report(helperExit ? 'Helper quit. Click Connect CHGame to start it again.' :
          'CHGame detected. Click Connect CHGame to start the SD helper.');
        return;
      }
      if (!await allowHelperUpload()) return;
      usbState = 'Starting SD helper…';
      renderControls();
      report('Starting the Rev0 SD helper…');
      card = await installHelper(navigator.serial, link, await helperImage(),
        (done, total) => report(`Uploading SD helper… ${Math.round(100 * done / total)}%`));
    } else {
      await card.start();
    }
    await attachCard(reconnecting);
  } catch (error) {
    if (!lostLink) {
      if (card?.link.disconnected && !card.link.closing) usbLost(card.link);
      else {
        const active = card?.link;
        card = null;
        await active?.close();
        usbState = 'Disconnected';
      }
    }
    throw error;
  } finally {
    if (link !== card?.link) await link.close();
  }
}

async function attachCard(reconnecting) {
  const active = card.link;
  preferredPort = active.port;
  void active.pump.then(() => { if (!active.closing) usbLost(active); });
  await scan({reconnecting});
  if (!lostLink) usbState = 'USB connected';
}

$('auto-organize').onchange = event => {
  const order = event.target.value;
  event.target.value = '';
  if (!order || locked()) return;
  return exclusive(async () => {
    if (order === 'newest' && !card.timestamps) {
      if (!await allowHelperUpload()) return;
      const link = card.link;
      disconnecting = true;
      usbState = 'Starting SD helper…';
      renderControls();
      try {
        card = await installHelper(navigator.serial, link, await helperImage(), (done, total) =>
          report(`Updating SD helper… ${Math.round(100 * done / total)}%`));
      } catch (error) {
        if (link.closing || link.disconnected) {
          card = null;
          usbState = 'Disconnected';
        } else {
          usbState = 'USB connected';
        }
        throw error;
      } finally {
        disconnecting = false;
      }
      await attachCard(true);
      if (!card.timestamps) throw new Error('The SD helper does not report file dates');
      if (lostLink || stale) return;
    }
    organizeFolder(folder, order);
    report(order === 'restore' ? 'Manual order restored.' : 'Order previewed. Click Save to SD to apply it.');
  });
};

function queueReconnect() {
  reconnectPending = true;
  clearTimeout(reconnectTimer);
  if (busy) return;
  reconnectTimer = setTimeout(() => {
    if (busy) return;
    reconnectPending = false;
    if (card) return;
    void exclusive(async () => {
      const port = await grantedCHGame(navigator.serial, preferredPort);
      if (port) {
        try {
          await connectCard(await Link.open(port), true);
          helperExit = undefined;
          return;
        } catch (error) {
          if (!helperExit || performance.now() >= helperExit.until) {
            helperExit = undefined;
            throw error;
          }
          usbState = 'Helper quit';
        }
      }
      if (!helperExit) return;
      if (performance.now() < helperExit.until) {
        reconnectPending = true;
      } else {
        helperExit = undefined;
        usbState = 'USB disconnected';
        report('Helper quit. Waiting for CHGame over USB.');
      }
    });
  }, Math.max(250, (helperExit?.after ?? 0) - performance.now()));
}

$('connect').onclick = () => exclusive(async () => {
  clearTimeout(reconnectTimer);
  reconnectPending = false;
  helperExit = undefined;
  if (card) {
    if (changedFolders(menu).length && !await confirmAction({
      title: 'Disconnect CHGame?', message: 'Pending menu changes will be discarded.', action: 'Disconnect',
    })) return;
    await disconnectCHGame();
    return;
  }
  if (!navigator.serial) throw new Error('Open this page in desktop Chrome or Edge on localhost or HTTPS to use USB.');
  const port = await grantedCHGame(navigator.serial, preferredPort);
  const link = port ? await Link.open(port) : await chooseCHGame(navigator.serial);
  await connectCard(link, false);
});

$('rescan').onclick = () => exclusive(async () => {
  if (changedFolders(menu).length && !await confirmAction({
    title: 'Rescan the SD card?', message: 'Pending menu changes will be discarded.', action: 'Rescan SD',
  })) return;
  await card.start();
  await scan();
});

$('undo').onclick = () => {
  resetMenu(menu);
  if (!menu.folders.includes(folder)) folder = menu.root;
  setSelection([...selection].filter(entry => folder.entries.includes(entry)));
  render();
  report(guidance);
};

function showCartPreview(preview) {
  cartPreview = preview;
  $('cart-preview').hidden = !preview;
  if (previewCoverUrl) URL.revokeObjectURL(previewCoverUrl);
  const cover = $('preview-cover');
  previewCoverUrl = preview?.pkg?.cover ? URL.createObjectURL(new Blob([preview.pkg.cover], {type: 'image/png'})) : undefined;
  cover.hidden = !previewCoverUrl;
  if (previewCoverUrl) cover.src = previewCoverUrl;
  else cover.removeAttribute('src');
  if (preview) {
    $('preview-title').textContent = preview.title;
    $('preview-summary').textContent = preview.message;
    const source = packageSourceUrl(preview.pkg?.sourceUrl, location);
    for (const [id, url, label] of [
      ['preview-download', preview.download, preview.download?.host],
      ['preview-source', source, source && `Source code · ${source.host}`],
    ]) {
      const line = $(id);
      const link = line.querySelector('a');
      line.hidden = !url;
      if (url) {
        link.href = url.href;
        link.textContent = label;
      } else {
        link.removeAttribute('href');
        link.textContent = '';
      }
    }
    const games = $('preview-games');
    games.hidden = !preview.games?.length;
    games.replaceChildren();
    for (const game of preview.games ?? []) {
      const item = el('li');
      item.append(el('strong', game.title));
      const details = [game.folders.join(' / '), game.version && `v${game.version}`].filter(Boolean);
      if (details.length) item.append(el('small', details.join(' · ')));
      games.append(item);
    }
    const assets = $('preview-assets');
    assets.hidden = !preview.assets?.length;
    assets.open = false;
    $('preview-asset-count').textContent = preview.assets?.length === 1 ? '1 SD asset' : `${preview.assets?.length ?? 0} SD assets`;
    $('preview-asset-files').replaceChildren(...(preview.assets ?? []).map(path => el('li', path)));
  }
  renderControls();
}

async function reviewPackage(source) {
  const request = ++previewRequest;
  const linked = source instanceof URL;
  const label = linked ? (source.origin === location.origin ? source.pathname.split('/').at(-1) : source.hostname) : source.name;
  showCartPreview({title: 'Opening cart…', message: label});
  try {
    const endpoint = document.querySelector('meta[name="github-release-endpoint"]')?.content;
    const pkg = linked
      ? await prepareLinkedPackage(source, fetch, endpoint && new URL(endpoint, location.href))
      : await preparePackage(source);
    if (request !== previewRequest) return;
    const {games, assets} = describePackage(pkg);
    const count = `${games.length} ${games.length === 1 ? 'game' : 'games'}`;
    showCartPreview({pkg, title: pkg.title, message: linked ? count : `${count} · ${label}`,
      download: linked ? source : null, games, assets});
  } catch (error) {
    if (request === previewRequest) showCartPreview({title: 'Could not open cart', message: error.message});
  }
}

function importPreview() {
  const preview = cartPreview;
  if (!preview?.pkg) return;
  return exclusive(async () => {
    if (!card || stale) throw new Error('Connect and scan your CHGame before installing a cart');
    if (changedFolders(menu).length) throw new Error('Save or reset the pending menu changes before installing');
    const {pkg, games} = preview;
    const count = games.length;
    const destination = await confirmAction({
      title: 'Install to SD?',
      message: `“${pkg.title}” contains ${count} ${count === 1 ? 'cart' : 'carts'}.`,
      detail: 'This writes to the SD card now. Existing games and saves are kept.',
      action: 'Install to SD',
      choices: [
        {value: 'package', label: 'Package categories', detail: 'Use the folders declared in the package.'},
        {value: 'current', label: `Current category · ${folder.title}`, detail: 'Put every cart here.'},
      ],
    });
    if (!destination) {
      report(guidance);
      return;
    }
    beginTransfer('Installing to SD', 'Checking destination and shared SD files…');
    let writing = false;
    try {
      const plan = await planImport(card, menu, pkg, destination === 'current' ? folder : null,
        name => generateCover(name).bytes);
      writing = true;
      await writeImport(card, plan, transferStep);
      const installed = await scanMenu(card, current => report(`Reading ${current.title}…`));
      menu = installed;
      folder = installed.folders.find(item => item.path === plan.target) ?? installed.root;
      setSelection([]);
      if (cartPreview === preview) showCartPreview(null);
      finishTransfer('Installation complete', plan.added
        ? `Installed ${plan.added} ${plan.added === 1 ? 'cart' : 'carts'}. ${plan.games > plan.added ? 'Existing copies were kept.' : ''}`.trim()
        : 'These carts are already on the SD.');
    } catch (error) {
      stale ||= writing;
      finishTransfer('Installation failed', writing ? `${error.message} Rescan to check which files were written.` : error.message, true);
    }
  });
}

$('import').onclick = () => $('package-file').click();
$('open-cart').onclick = $('import').onclick;
$('preview-dismiss').onclick = () => {
  previewRequest++;
  showCartPreview(null);
};
$('preview-import').onclick = importPreview;
$('package-file').onchange = event => {
  const [file] = event.target.files;
  event.target.value = '';
  if (file && !busy) void reviewPackage(file);
};

window.addEventListener('dragover', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = $('import').disabled ? 'none' : 'copy';
  if (!$('import').disabled) document.body.dataset.importDrop = '';
});
window.addEventListener('dragleave', event => {
  if (!event.relatedTarget) delete document.body.dataset.importDrop;
});
window.addEventListener('drop', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  delete document.body.dataset.importDrop;
  if (busy) return;
  if (event.dataTransfer.files.length === 1) void reviewPackage(event.dataTransfer.files[0]);
  else report('Drop one .chgame package at a time.', true);
});

$('save').onclick = () => exclusive(async () => {
  beginTransfer('Saving to SD', 'Checking menu changes…');
  try {
    await saveMenu(card, menu, transferStep);
    transferStep('Verifying the updated SD library…');
    await scan();
    finishTransfer('Saved to SD', 'Menu changes verified.');
  } catch (error) {
    stale = true;
    finishTransfer('Save failed', `${error.message} Rescan to check what is on the SD before making further changes.`, true);
  }
});

async function disconnectCHGame() {
  disconnecting = true;
  try {
    await card.menu();
    const link = card.link;
    showDisconnected();
    // The full helper can wait up to 1.4 s after its acknowledgment before reset.
    const now = performance.now();
    helperExit = {after: now + 1600, until: now + 6500};
    usbState = 'Helper quit';
    await link.close();
    report('Helper quit. Waiting for CHGame over USB.');
    queueReconnect();
  } finally {
    disconnecting = false;
    if (card?.link.disconnected) usbLost(card.link);
  }
}

const serialEvents = navigator.serial;
serialEvents?.addEventListener('disconnect', event => {
  const port = event.port ?? event.target;
  if (card?.link.port === port) usbLost(card.link);
  else if (!card && !busy && !helperExit && preferredPort === port) {
    usbState = 'USB disconnected';
    renderControls();
    report('USB disconnected. Waiting for CHGame to reconnect.', true);
  }
});
serialEvents?.addEventListener('connect', () => queueReconnect());

window.addEventListener('beforeunload', event => {
  if ((card && busy) || changedFolders(menu).length) event.preventDefault();
});

function readLinkedCart() {
  try {
    const url = linkedPackageUrl(location.href);
    if (url) void reviewPackage(url);
  } catch (error) {
    previewRequest++;
    showCartPreview({title: 'Could not open cart', message: error.message});
  }
}

window.addEventListener('hashchange', readLinkedCart);
render();
readLinkedCart();
if (serialEvents) queueReconnect();
