const AUTH_TOKEN_KEY = "ownerAuthToken";

// API_BASE: empty = same-origin (Firebase App Hosting handles all /api/* routes directly).
// The Cloudflare Worker proxy is no longer used; its routing table doesn't cover newer
// endpoints like POST/DELETE /api/folder-groups, which caused "Not found." errors.
const API_BASE = "";

const authCard = document.getElementById("auth-card");
const ownerDashboard = document.getElementById("owner-dashboard");
const loginForm = document.getElementById("login-form");
const usernameInput = document.getElementById("username-input");
const passwordInput = document.getElementById("password-input");
const togglePasswordButton = document.getElementById("toggle-password-btn");
const authStatus = document.getElementById("auth-status");
const logoutButton = document.getElementById("logout-btn");

const uploadForm = document.getElementById("upload-form");
const photoInput = document.getElementById("photo-input");
const statusMessage = document.getElementById("status");
const photosGrid = document.getElementById("photos-grid");
const cardTemplate = document.getElementById("photo-card-template");

const newFolderInput = document.getElementById("new-folder-input");
const createFolderButton = document.getElementById("create-folder-btn");
const shareFolderButton = document.getElementById("share-folder-btn");
const selectAllButton = document.getElementById("select-all-btn");
const deleteSelectedButton = document.getElementById("delete-selected-btn");

const expiryHoursInput = document.getElementById("expiry-hours");
const createShareButton = document.getElementById("create-share-btn");
const shareUrlInput = document.getElementById("share-url");
const copyShareButton = document.getElementById("copy-share-btn");
const shareStatus = document.getElementById("share-status");

const viewCollections = document.getElementById("view-collections");
const viewCollectionDetail = document.getElementById("view-collection-detail");
const collectionsGrid = document.getElementById("collections-grid");
const collectionsStatus = document.getElementById("collections-status");
const detailFolderName = document.getElementById("detail-folder-name");
const uploadPanel = document.getElementById("upload-panel");
const uploadToggleBtn = document.getElementById("upload-toggle-btn");
const backButton = document.getElementById("back-btn");
const newCollectionBtn = document.getElementById("new-collection-btn");
const newCollectionRow = document.getElementById("new-collection-row");
const cancelNewFolderBtn = document.getElementById("cancel-new-folder-btn");
const shareResultRow = document.getElementById("share-result-row");

// Dashboard lightbox
const dashLightbox = document.getElementById("dash-lightbox");
const dashLbImage = document.getElementById("dash-lb-image");
const dashLbVideo = document.getElementById("dash-lb-video");
const dashLbClose = document.getElementById("dash-lb-close");
const dashLbPrev = document.getElementById("dash-lb-prev");
const dashLbNext = document.getElementById("dash-lb-next");
const dashLbDownload = document.getElementById("dash-lb-download");

let currentPhotos = [];
let currentFolders = [];
let currentCoverPhotoIds = {}; // { folderName: photoId }
let currentFolderGroups = []; // top-level folder group names
let currentCollectionParents = {}; // { collectionName: groupName }
let currentGroupMeta = {}; // { groupName: { date: "YYYY-MM-DD" } }
let currentSortOrder = "date-desc";
let currentAllPhotos = []; // cached for sort re-renders without re-fetching
let currentFolder = "";
let authToken = "";
let isUploading = false;
let dashLbIndex = -1;
let dashLbHistoryEntry = false;

function normalizeToken(value) {
  if (typeof value !== "string") return "";

  const trimmed = value.trim();
  if (!trimmed) return "";

  if (!/^[a-f0-9]{64}$/i.test(trimmed)) {
    return "";
  }

  return trimmed;
}

function normalizeFolderName(value) {
  if (typeof value !== "string") return "";

  const clean = value.trim().replace(/[\\/]+/g, "-").replace(/\s+/g, " ").slice(0, 80);
  if (!clean || clean === "." || clean === "..") return "";

  return clean;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const ICONS = {
  open: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`,
  move: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  edit: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  trash: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
  folder: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
};

function showContextMenu(anchorEl, items) {
  const menu = document.getElementById("context-menu");
  if (!menu) return;

  menu.innerHTML = items.map((item, i) => {
    if (item.divider) return `<div class="context-menu-divider"></div>`;
    return `<button class="context-menu-item${item.danger ? " danger" : ""}" type="button" data-idx="${i}">${item.icon || ""}${escapeHtml(item.label)}</button>`;
  }).join("");

  menu.querySelectorAll(".context-menu-item").forEach(btn => {
    const idx = parseInt(btn.dataset.idx, 10);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeContextMenu();
      items[idx]?.action?.();
    });
  });

  const menuWidth = 210;
  const rect = anchorEl.getBoundingClientRect();
  let left = rect.right - menuWidth;
  let top = rect.bottom + 6;
  if (left < 8) left = 8;
  if (left + menuWidth > window.innerWidth - 8) left = window.innerWidth - menuWidth - 8;
  if (top + 250 > window.innerHeight) top = rect.top - 250;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.classList.remove("hidden");
  setTimeout(() => { document.addEventListener("click", closeContextMenu, { once: true }); }, 0);
}

function closeContextMenu() {
  const menu = document.getElementById("context-menu");
  if (menu) menu.classList.add("hidden");
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function setUiAuthenticated(isAuthenticated) {
  authCard.classList.toggle("hidden", isAuthenticated);
  ownerDashboard.classList.toggle("hidden", !isAuthenticated);
}

function setAuthToken(token) {
  const normalized = normalizeToken(token);
  authToken = normalized;

  if (normalized) {
    window.localStorage.setItem(AUTH_TOKEN_KEY, normalized);
  } else {
    window.localStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

function clearOwnerState() {
  setAuthToken("");
  currentPhotos = [];
  currentFolders = [];
  currentFolderGroups = [];
  currentCollectionParents = {};
  currentGroupMeta = {};
  currentAllPhotos = [];
  currentFolder = "";
  photosGrid.innerHTML = "";
  if (collectionsGrid) collectionsGrid.innerHTML = "";
  if (shareResultRow) shareResultRow.classList.add("hidden");
  shareUrlInput.value = "";
  shareStatus.textContent = "";
  if (statusMessage) statusMessage.textContent = "";
  authStatus.textContent = "";
  passwordInput.type = "password";
  togglePasswordButton.textContent = "Show";
  togglePasswordButton.setAttribute("aria-pressed", "false");
  passwordInput.value = "";
}

function handleUnauthorized(message = "Session expired. Please sign in again.") {
  clearOwnerState();
  setUiAuthenticated(false);
  authStatus.textContent = message;
}

// Prepend API_BASE to any /api/ or /internal/ path
function api(path) {
  if (API_BASE && path.startsWith("/")) return `${API_BASE}${path}`;
  return path;
}

function appendAuthQuery(url) {
  const safeToken = normalizeToken(authToken);
  if (!safeToken) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}auth=${encodeURIComponent(safeToken)}`;
}

async function authorizedFetch(path, options = {}) {
  const url     = api(path);
  const headers = new Headers(options.headers || {});
  const safeToken = normalizeToken(authToken);

  if (safeToken) {
    headers.set("Authorization", `Bearer ${safeToken}`);
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (response.status === 401 && !url.includes("/api/auth/login")) {
    handleUnauthorized();
  }

  return response;
}

togglePasswordButton.addEventListener("click", () => {
  const showing = passwordInput.type === "text";
  passwordInput.type = showing ? "password" : "text";
  togglePasswordButton.textContent = showing ? "Show" : "Hide";
  togglePasswordButton.setAttribute("aria-pressed", String(!showing));
});

function formatBytes(bytes) {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function isImageMimeType(mimeType) {
  return typeof mimeType === "string" && mimeType.startsWith("image/");
}

function isVideoMimeType(mimeType) {
  return typeof mimeType === "string" && mimeType.startsWith("video/");
}

function makeFilePlaceholder(fileName = "file") {
  const extension = String(fileName).split(".").pop().slice(0, 6).toUpperCase();
  const label = extension && extension !== fileName.toUpperCase() ? extension : "FILE";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'><rect fill='#18140f' width='640' height='360'/><rect x='220' y='80' rx='14' ry='14' width='200' height='200' fill='rgba(255,255,255,0.06)' stroke='rgba(200,133,74,0.4)' stroke-width='2'/><text x='320' y='175' text-anchor='middle' font-size='32' font-family='Arial' fill='rgba(200,133,74,0.9)'>${label}</text><text x='320' y='215' text-anchor='middle' font-size='14' font-family='Arial' fill='rgba(255,255,255,0.3)'>No preview</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function makeVideoPlaceholderDashboard() {
  return "/video-fallback.jpg";
}

function renderEmptyState(text) {
  photosGrid.innerHTML = `<p class="empty">${text}</p>`;
}

function renderFolders(result) {
  const deduped = [...new Set((result.folders || []).filter(Boolean))];
  currentFolders = deduped.length ? deduped : ["General"];
  currentCoverPhotoIds = result.coverPhotoIds || {};
  currentFolderGroups = result.groups || [];
  currentCollectionParents = result.collectionParents || {};
  currentGroupMeta = (typeof result.groupMeta === "object" && result.groupMeta !== null) ? result.groupMeta : {};
}

async function loadFolders() {
  const response = await authorizedFetch("/api/folders");
  if (!response.ok) return;
  const result = await parseJsonResponse(response);
  renderFolders(result);
}

async function loadCollections() {
  await loadFolders();
  try {
    const response = await authorizedFetch("/api/photos");
    if (!response.ok) return;
    const photos = await response.json();
    currentAllPhotos = photos;
    renderCollections(photos);
  } catch {
    if (collectionsGrid) collectionsGrid.innerHTML = '<p class="empty">Could not load collections.</p>';
  }
}

function renderCollections(photos) {
  if (!collectionsGrid) return;

  const folderMap = {};
  currentFolders.forEach((f) => { folderMap[f] = []; });
  photos.forEach((photo) => {
    const f = photo.folder || "General";
    if (!folderMap[f]) folderMap[f] = [];
    folderMap[f].push(photo);
  });

  collectionsGrid.innerHTML = "";

  if (!Object.keys(folderMap).length) {
    collectionsGrid.innerHTML = '<p class="empty" style="padding:28px">No collections yet. Use the button above to create one.</p>';
    return;
  }

  // Split collections into grouped and ungrouped
  const groupMap = {};
  const ungrouped = [];
  for (const collName of Object.keys(folderMap)) {
    const parent = currentCollectionParents[collName];
    if (parent && currentFolderGroups.includes(parent)) {
      if (!groupMap[parent]) groupMap[parent] = [];
      groupMap[parent].push(collName);
    } else {
      ungrouped.push(collName);
    }
  }

  // Sort groups
  const sortedGroups = [...currentFolderGroups].sort((a, b) => {
    if (currentSortOrder === "name-asc") return a.localeCompare(b);
    const da = currentGroupMeta[a]?.date ? new Date(currentGroupMeta[a].date).getTime() : 0;
    const db = currentGroupMeta[b]?.date ? new Date(currentGroupMeta[b].date).getTime() : 0;
    return currentSortOrder === "date-asc" ? da - db : db - da;
  });

  // Render folder group sections
  sortedGroups.forEach(groupName => {
    collectionsGrid.appendChild(buildGroupSection(groupName, groupMap[groupName] || [], folderMap));
  });

  // Render ungrouped collections
  if (ungrouped.length) {
    if (currentFolderGroups.length > 0) {
      const header = document.createElement("div");
      header.className = "ungrouped-header";
      header.innerHTML = `<span class="ungrouped-label">Ungrouped</span>`;
      collectionsGrid.appendChild(header);
    }
    const grid = document.createElement("div");
    grid.className = currentFolderGroups.length > 0 ? "folder-group-grid" : "collections-grid-inner";
    ungrouped.forEach(name => grid.appendChild(buildCollectionCard(name, folderMap[name] || [])));
    collectionsGrid.appendChild(grid);
  }
}

function buildGroupSection(groupName, collectionNames, folderMap) {
  const section = document.createElement("section");
  section.className = "folder-group-section";
  section.dataset.group = groupName;

  const dateMeta = currentGroupMeta[groupName]?.date || "";
  const dateDisplay = dateMeta ? formatGroupDate(dateMeta) : "";

  const header = document.createElement("div");
  header.className = "folder-group-header";
  header.innerHTML = `
    <div class="folder-group-header-left">
      <svg class="folder-group-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <span class="folder-group-name">${escapeHtml(groupName)}</span>
      ${dateDisplay ? `<span class="folder-group-date">${escapeHtml(dateDisplay)}</span>` : ""}
      <span class="folder-group-count">${collectionNames.length} collection${collectionNames.length !== 1 ? "s" : ""}</span>
    </div>
    <button class="folder-group-menu-btn" type="button" aria-label="Folder options">
      <svg width="14" height="4" viewBox="0 0 14 4" fill="currentColor" aria-hidden="true"><circle cx="2" cy="2" r="1.5"/><circle cx="7" cy="2" r="1.5"/><circle cx="12" cy="2" r="1.5"/></svg>
    </button>
  `;

  header.querySelector(".folder-group-menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    showContextMenu(e.currentTarget, [
      { label: "Rename Folder", icon: ICONS.edit, action: () => renameFolderGroup(groupName) },
      { divider: true },
      { label: "Delete Folder (keep collections)", icon: ICONS.trash, danger: true, action: () => deleteFolderGroup(groupName, false) },
      { label: "Delete Folder + All Collections", icon: ICONS.trash, danger: true, action: () => deleteFolderGroup(groupName, true) },
    ]);
  });

  const grid = document.createElement("div");
  grid.className = "folder-group-grid";
  collectionNames.forEach(name => grid.appendChild(buildCollectionCard(name, folderMap[name] || [])));

  section.appendChild(header);
  section.appendChild(grid);
  return section;
}

function buildCollectionCard(folderName, folderPhotos) {
  const savedCoverId = currentCoverPhotoIds[folderName];
  const coverPhoto = (savedCoverId && folderPhotos.find(p => p.id === savedCoverId))
    || folderPhotos.find(p => isImageMimeType(p.mimeType))
    || folderPhotos[0];

  const card = document.createElement("article");
  card.className = "collection-card";

  const coverDiv = document.createElement("div");
  coverDiv.className = "collection-cover";
  if (coverPhoto) {
    const img = document.createElement("img");
    img.src = appendAuthQuery(api(`/api/photos/${coverPhoto.id}/thumb`));
    img.alt = folderName;
    img.loading = "lazy";
    coverDiv.appendChild(img);
  } else {
    coverDiv.classList.add("collection-cover-empty");
  }

  const info = document.createElement("div");
  info.className = "collection-info";
  info.innerHTML = `<p class="collection-name">${escapeHtml(folderName)}</p><p class="collection-count"><span class="count-dot"></span>${folderPhotos.length} ${folderPhotos.length === 1 ? "item" : "items"}</p>`;

  const menuBtn = document.createElement("button");
  menuBtn.className = "context-menu-btn";
  menuBtn.type = "button";
  menuBtn.setAttribute("aria-label", "Collection options");
  menuBtn.innerHTML = `<svg width="14" height="4" viewBox="0 0 14 4" fill="currentColor" aria-hidden="true"><circle cx="2" cy="2" r="1.5"/><circle cx="7" cy="2" r="1.5"/><circle cx="12" cy="2" r="1.5"/></svg>`;

  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showContextMenu(e.currentTarget, [
      { label: "Open", icon: ICONS.open, action: () => openCollection(folderName) },
      { label: "Move to Folder…", icon: ICONS.move, action: () => openMoveModal(folderName) },
      { divider: true },
      { label: "Delete Collection", icon: ICONS.trash, danger: true, action: () => deleteCollection(folderName) },
    ]);
  });

  card.appendChild(coverDiv);
  card.appendChild(menuBtn);
  card.appendChild(info);
  card.addEventListener("click", (e) => {
    if (e.target.closest(".context-menu-btn")) return;
    openCollection(folderName);
  });
  return card;
}

async function deleteCollection(folderName) {
  if (!confirm(`Delete "${folderName}" and all its photos? This cannot be undone.`)) return;
  if (collectionsStatus) collectionsStatus.textContent = "Deleting…";
  try {
    const res = await authorizedFetch(`/api/folders/${encodeURIComponent(folderName)}`, { method: "DELETE" });
    const result = await parseJsonResponse(res);
    if (!res.ok) throw new Error(result.error || "Delete failed.");
    if (collectionsStatus) collectionsStatus.textContent = "";
    await loadCollections();
    await loadStats();
  } catch (err) {
    if (collectionsStatus) collectionsStatus.textContent = err.message;
  }
}

async function deleteFolderGroup(groupName, deleteContents) {
  const msg = deleteContents
    ? `Delete "${groupName}" AND all its collections and photos? This cannot be undone.`
    : `Delete the folder "${groupName}"? Collections inside will become ungrouped.`;
  if (!confirm(msg)) return;
  if (collectionsStatus) collectionsStatus.textContent = "Deleting…";
  try {
    const res = await authorizedFetch(`/api/folder-groups/${encodeURIComponent(groupName)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleteCollections: deleteContents })
    });
    const result = await parseJsonResponse(res);
    if (!res.ok) throw new Error(result.error || "Delete failed.");
    if (collectionsStatus) collectionsStatus.textContent = "";
    await loadCollections();
    await loadStats();
  } catch (err) {
    if (collectionsStatus) collectionsStatus.textContent = err.message;
  }
}

async function renameFolderGroup(oldName) {
  const newName = normalizeFolderName(prompt(`Rename "${oldName}" to:`, oldName) || "");
  if (!newName || newName === oldName) return;
  if (collectionsStatus) collectionsStatus.textContent = "Renaming…";
  try {
    const preservedDate = currentGroupMeta[oldName]?.date || "";
    const createRes = await authorizedFetch("/api/folder-groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, date: preservedDate })
    });
    if (!createRes.ok) throw new Error("Could not create renamed folder.");
    const inGroup = Object.entries(currentCollectionParents)
      .filter(([, parent]) => parent === oldName)
      .map(([name]) => name);
    for (const coll of inGroup) {
      await authorizedFetch(`/api/folders/${encodeURIComponent(coll)}/group`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group: newName })
      });
    }
    await authorizedFetch(`/api/folder-groups/${encodeURIComponent(oldName)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleteCollections: false })
    });
    if (collectionsStatus) collectionsStatus.textContent = "";
    await loadCollections();
  } catch (err) {
    if (collectionsStatus) collectionsStatus.textContent = err.message;
  }
}

function openMoveModal(collectionName) {
  const modal = document.getElementById("move-modal");
  const list = document.getElementById("move-modal-list");
  const collNameEl = document.getElementById("move-modal-collection-name");
  const removeBtn = document.getElementById("move-modal-remove");
  if (!modal || !list) return;

  if (collNameEl) collNameEl.textContent = collectionName;
  const currentParent = currentCollectionParents[collectionName] || null;

  if (currentFolderGroups.length === 0) {
    list.innerHTML = `<p style="padding:20px;text-align:center;color:var(--muted);font-size:0.9rem">No folders yet.<br>Create a folder first using the <strong>New</strong> button.</p>`;
  } else {
    list.innerHTML = currentFolderGroups.map(g => `
      <button class="move-modal-folder-item${g === currentParent ? " is-current" : ""}" data-group="${escapeHtml(g)}" type="button">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        ${escapeHtml(g)}
        ${g === currentParent ? `<span style="margin-left:auto;font-size:0.7rem;opacity:0.6">current</span>` : ""}
      </button>
    `).join("");
    list.querySelectorAll(".move-modal-folder-item").forEach(btn => {
      btn.addEventListener("click", async () => {
        await moveCollectionToGroup(collectionName, btn.dataset.group);
        modal.classList.add("hidden");
      });
    });
  }

  if (removeBtn) {
    removeBtn.style.display = currentParent ? "" : "none";
    removeBtn.onclick = async () => {
      await moveCollectionToGroup(collectionName, null);
      modal.classList.add("hidden");
    };
  }
  modal.classList.remove("hidden");
}

async function moveCollectionToGroup(collectionName, groupName) {
  try {
    const res = await authorizedFetch(`/api/folders/${encodeURIComponent(collectionName)}/group`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group: groupName })
    });
    const result = await parseJsonResponse(res);
    if (!res.ok) throw new Error(result.error || "Move failed.");
    await loadCollections();
  } catch (err) {
    if (collectionsStatus) collectionsStatus.textContent = err.message;
  }
}

function openCollection(folderName) {
  currentFolder = folderName;
  if (detailFolderName) detailFolderName.textContent = folderName;
  if (shareResultRow) shareResultRow.classList.add("hidden");
  if (shareStatus) shareStatus.textContent = "";
  if (uploadPanel) uploadPanel.classList.add("hidden");
  viewCollections.classList.add("hidden");
  viewCollectionDetail.classList.remove("hidden");
  history.pushState({ view: "collection", folder: folderName }, "", "#collection/" + encodeURIComponent(folderName));
  loadPhotos();
}

function backToCollections() {
  currentFolder = "";
  viewCollectionDetail.classList.add("hidden");
  viewCollections.classList.remove("hidden");
  const shareLinksView = document.getElementById("view-share-links");
  if (shareLinksView) shareLinksView.classList.add("hidden");
  document.querySelectorAll(".dash-nav-item[data-view]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === "collections");
  });
  history.pushState({ view: "collections" }, "", location.pathname);
  loadCollections();
  loadStats();
}

window.addEventListener("popstate", (e) => {
  // If the dashboard lightbox is open, close it and stay on current view
  if (dashLightbox && !dashLightbox.classList.contains("hidden")) {
    closeDashLightbox({ fromPopState: true });
    return;
  }

  const state = e.state;
  if (!state || state.view === "collections") {
    if (!viewCollectionDetail.classList.contains("hidden")) {
      currentFolder = "";
      viewCollectionDetail.classList.add("hidden");
      viewCollections.classList.remove("hidden");
      loadCollections();
    }
  } else if (state.view === "collection" && state.folder) {
    currentFolder = state.folder;
    if (detailFolderName) detailFolderName.textContent = state.folder;
    if (shareResultRow) shareResultRow.classList.add("hidden");
    if (shareStatus) shareStatus.textContent = "";
    if (uploadPanel) uploadPanel.classList.add("hidden");
    viewCollections.classList.add("hidden");
    viewCollectionDetail.classList.remove("hidden");
    loadPhotos();
  }
});

function renderPhotos(photos) {
  currentPhotos = photos;
  photosGrid.innerHTML = "";

  if (!photos.length) {
    renderEmptyState("No photos uploaded yet.");
    return;
  }

  photos.forEach((photo, photoIndex) => {
    const card = cardTemplate.content.cloneNode(true);
    const article = card.querySelector(".photo-card");
    const image = card.querySelector(".photo-preview");
    const name = card.querySelector(".photo-name");
    const size = card.querySelector(".photo-size");
    const folder = card.querySelector(".photo-folder");
    const download = card.querySelector(".download-btn");
    const checkbox = card.querySelector(".photo-select");

    const isImage = isImageMimeType(photo.mimeType);
    const isVideo = isVideoMimeType(photo.mimeType);

    if (isImage) {
      image.src = appendAuthQuery(api(`/api/photos/${photo.id}/thumb`));
    } else if (isVideo) {
      image.src = makeVideoPlaceholderDashboard();
      // Extract first frame for thumbnail
      const thumbVid = document.createElement("video");
      thumbVid.src = appendAuthQuery(api(`/api/photos/${photo.id}/view`));
      thumbVid.preload = "metadata";
      thumbVid.muted = true;
      thumbVid.playsInline = true;
      thumbVid.style.display = "none";
      thumbVid.addEventListener("loadedmetadata", () => {
        thumbVid.currentTime = Math.min(1, (thumbVid.duration || 2) * 0.1);
      }, { once: true });
      thumbVid.addEventListener("seeked", () => {
        const canvas = document.createElement("canvas");
        canvas.width = thumbVid.videoWidth || 640;
        canvas.height = thumbVid.videoHeight || 360;
        canvas.getContext("2d").drawImage(thumbVid, 0, 0, canvas.width, canvas.height);
        image.src = canvas.toDataURL("image/jpeg", 0.82);
        thumbVid.remove();
      }, { once: true });
      document.body.appendChild(thumbVid);
    } else {
      image.src = makeFilePlaceholder(photo.originalName);
    }

    image.alt = photo.originalName;
    name.textContent = photo.originalName;
    size.textContent = `${formatBytes(photo.size)} • ${new Date(photo.uploadedAt).toLocaleString()}`;
    folder.textContent = `${photo.folder || "General"}`;
    download.href = appendAuthQuery(api(`/api/photos/${photo.id}/download`));
    checkbox.value = photo.id;
    checkbox.addEventListener("change", () => {
      checkbox.closest(".photo-card").classList.toggle("is-selected", checkbox.checked);
    });

    // Set as cover button — only show for images
    const setCoverBtn = article.querySelector(".set-cover-btn");
    if (setCoverBtn && isImage) {
      setCoverBtn.style.display = "flex";
      const isCurrent = currentCoverPhotoIds[currentFolder || "General"] === photo.id;
      if (isCurrent) setCoverBtn.classList.add("is-cover");
      setCoverBtn.setAttribute("title", isCurrent ? "Current cover" : "Set as cover");
      setCoverBtn.addEventListener("click", async () => {
        await setCoverPhoto(photo.id);
      });
    }

    // Tap card to open lightbox (not on checkbox or download or set-cover)
    article.addEventListener("click", (e) => {
      if (e.target.closest(".photo-card-select-wrap") || e.target.closest(".download-btn") || e.target.closest(".set-cover-btn")) return;
      openDashLightbox(photoIndex);
    });

    photosGrid.appendChild(card);
  });
}

async function setCoverPhoto(photoId) {
  const folder = currentFolder || "General";
  try {
    const response = await authorizedFetch(`/api/folders/${encodeURIComponent(folder)}/cover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId })
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result.error || "Failed to set cover.");
    currentCoverPhotoIds[folder] = photoId;
    // Refresh visual state of all set-cover buttons in this view
    document.querySelectorAll(".set-cover-btn").forEach((btn) => btn.classList.remove("is-cover"));
    const allCards = photosGrid.querySelectorAll(".photo-card");
    allCards.forEach((card) => {
      const cb = card.querySelector(".photo-select");
      const btn = card.querySelector(".set-cover-btn");
      if (btn && cb && cb.value === photoId) btn.classList.add("is-cover");
    });
  } catch (e) {
    shareStatus.textContent = e.message;
  }
}

function getSelectedPhotoIds() {
  const selected = Array.from(document.querySelectorAll(".photo-select:checked"));
  return selected.map((input) => input.value);
}

async function loadPhotos() {
  try {
    const query = currentFolder ? `?folder=${encodeURIComponent(currentFolder)}` : "";
    const response = await authorizedFetch(`/api/photos${query}`);

    if (!response.ok) {
      if (response.status === 401) return;
      throw new Error("Failed to load photos.");
    }

    const photos = await response.json();
    renderPhotos(photos);
  } catch (error) {
    renderEmptyState(error.message);
  }
}

function uploadWithProgress(formData) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", api("/api/upload"));

    const safeToken = normalizeToken(authToken);
    if (safeToken) {
      xhr.setRequestHeader("Authorization", `Bearer ${safeToken}`);
    }

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0) {
        const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
        statusMessage.textContent = `Uploading... ${percent}%`;
      } else {
        statusMessage.textContent = "Uploading...";
      }
    });

    xhr.onerror = () => {
      reject(new Error("Network error during upload."));
    };

    xhr.onload = () => {
      let result = {};
      try {
        result = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        result = {};
      }

      if (xhr.status === 401) {
        handleUnauthorized();
        reject(new Error("Session expired. Please sign in again."));
        return;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(result);
        return;
      }

      reject(new Error(result.error || "Upload failed."));
    };

    xhr.send(formData);
  });
}

// Capture a video frame in the browser and return a JPEG Blob (or null on failure)
async function generateVideoThumbnail(file) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    const cleanup = () => URL.revokeObjectURL(objectUrl);

    video.addEventListener("loadeddata", () => {
      video.currentTime = Math.min(1, (video.duration || 0) * 0.1 || 1);
    }, { once: true });

    video.addEventListener("seeked", () => {
      try {
        const canvas = document.createElement("canvas");
        const maxW = 640;
        const scale = video.videoWidth > maxW ? maxW / video.videoWidth : 1;
        canvas.width  = Math.round(video.videoWidth  * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => { cleanup(); resolve(blob); }, "image/jpeg", 0.8);
      } catch { cleanup(); resolve(null); }
    }, { once: true });

    video.addEventListener("error", () => { cleanup(); resolve(null); }, { once: true });
    video.load();
  });
}

// Upload a single file as a raw PUT body (streams to R2, no multipart buffering)
function streamUploadFile(file, folder, onProgress) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      filename: file.name,
      folder:   folder || "General",
      size:     String(file.size)
    });
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", api(`/api/upload/stream?${params}`));

    const safeToken = normalizeToken(authToken);
    if (safeToken) {
      xhr.setRequestHeader("Authorization", `Bearer ${safeToken}`);
    }
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && event.total > 0 && onProgress) {
        onProgress(event.loaded, event.total);
      }
    });

    xhr.onerror = () => reject(new Error("Network error during upload."));

    xhr.onload = () => {
      let result = {};
      try { result = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status === 401) { handleUnauthorized(); reject(new Error("Session expired. Please sign in again.")); return; }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(result); return; }
      reject(new Error(result.error || "Upload failed."));
    };

    xhr.send(file);
  });
}

// Upload a thumbnail blob for an already-uploaded photo
async function uploadThumb(photoId, blob) {
  try {
    const safeToken = normalizeToken(authToken);
    const headers = { "Content-Type": "image/jpeg" };
    if (safeToken) headers["Authorization"] = `Bearer ${safeToken}`;
    await fetch(api(`/api/photos/${photoId}/thumb`), { method: "PUT", headers, body: blob });
  } catch { /* non-critical — thumbnail is optional */ }
}

async function uploadSelectedPhotos() {
  if (!photoInput.files.length || isUploading) {
    return;
  }

  isUploading = true;
  const files = Array.from(photoInput.files);
  let uploaded = 0;

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      statusMessage.textContent = `Uploading ${i + 1}/${files.length}… 0%`;

      const result = await streamUploadFile(file, currentFolder || "General", (loaded, total) => {
        const pct = Math.min(100, Math.round((loaded / total) * 100));
        statusMessage.textContent = `Uploading ${i + 1}/${files.length}… ${pct}%`;
      });

      uploaded++;

      // Generate and store a thumbnail for videos
      if (file.type.startsWith("video/") && result.items?.[0]?.id) {
        statusMessage.textContent = `Generating thumbnail ${i + 1}/${files.length}…`;
        const blob = await generateVideoThumbnail(file);
        if (blob) await uploadThumb(result.items[0].id, blob);
      }
    }

    statusMessage.textContent = `Upload complete. ${uploaded} file(s) added.`;
    uploadForm.reset();
    await loadPhotos();
  } catch (error) {
    statusMessage.textContent = error.message;
  } finally {
    isUploading = false;
  }
}

async function ensureAuthenticated() {
  const savedToken = normalizeToken(window.localStorage.getItem(AUTH_TOKEN_KEY));
  if (!savedToken) {
    setAuthToken("");
    setUiAuthenticated(false);
    return;
  }

  setAuthToken(savedToken);

  try {
    const response = await authorizedFetch("/api/auth/me");
    if (!response.ok) {
      throw new Error("Session expired");
    }

    setUiAuthenticated(true);
    history.replaceState({ view: "collections" }, "", location.pathname);
    await loadCollections();
    await loadStats();
  } catch {
    handleUnauthorized();
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authStatus.textContent = "Signing in...";

  try {
    const response = await fetch(api("/api/auth/login"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        password: passwordInput.value
      })
    });

    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result.error || "Login failed.");
    }

    setAuthToken(result.token);
    setUiAuthenticated(true);
    authStatus.textContent = "";
    passwordInput.value = "";
    history.replaceState({ view: "collections" }, "", location.pathname);
    await loadCollections();
    await loadStats();
  } catch (error) {
    authStatus.textContent = error.message;
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await authorizedFetch("/api/auth/logout", {
      method: "POST"
    });
  } catch {
    // Ignore network/logout failures.
  }

  clearOwnerState();
  setUiAuthenticated(false);
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await uploadSelectedPhotos();
});

photoInput.addEventListener("change", async () => {
  await uploadSelectedPhotos();
});

// Split button — main part opens collection creation row directly
newCollectionBtn.addEventListener("click", () => {
  newCollectionRow.classList.remove("hidden");
  closeFolderModal();
  newFolderInput.focus();
});

// Split button arrow — opens dropdown
const newItemArrowBtn = document.getElementById("new-item-arrow-btn");
const newItemDropdown = document.getElementById("new-item-dropdown");
if (newItemArrowBtn && newItemDropdown) {
  newItemArrowBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = newItemDropdown.classList.toggle("is-open");
    newItemArrowBtn.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) {
      setTimeout(() => {
        document.addEventListener("click", () => {
          newItemDropdown.classList.remove("is-open");
          newItemArrowBtn.setAttribute("aria-expanded", "false");
        }, { once: true });
      }, 0);
    }
  });

  document.getElementById("dd-new-collection")?.addEventListener("click", () => {
    newItemDropdown.classList.remove("is-open");
    newItemArrowBtn.setAttribute("aria-expanded", "false");
    newCollectionRow.classList.remove("hidden");
    closeFolderModal();
    newFolderInput.focus();
  });

  document.getElementById("dd-new-folder")?.addEventListener("click", () => {
    newItemDropdown.classList.remove("is-open");
    newItemArrowBtn.setAttribute("aria-expanded", "false");
    newCollectionRow.classList.add("hidden");
    openFolderModal();
  });
}

cancelNewFolderBtn.addEventListener("click", () => {
  newCollectionRow.classList.add("hidden");
  newFolderInput.value = "";
});

// ---- Folder modal ----
const folderModal = document.getElementById("folder-modal");
const fmgName = document.getElementById("fmg-name");
const fmgDate = document.getElementById("fmg-date");
const fmgStatus = document.getElementById("fmg-status");

function formatGroupDate(dateStr) {
  if (!dateStr) return "";
  try {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" }).format(new Date(y, m - 1, d));
  } catch { return dateStr; }
}

function openFolderModal() {
  if (!folderModal) return;
  if (fmgName) fmgName.value = "";
  if (fmgStatus) fmgStatus.textContent = "";
  // Default date = today
  if (fmgDate) {
    const today = new Date();
    fmgDate.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  }
  folderModal.classList.remove("hidden");
  setTimeout(() => fmgName?.focus(), 50);
}

function closeFolderModal() {
  if (folderModal) folderModal.classList.add("hidden");
  if (fmgStatus) fmgStatus.textContent = "";
}

if (folderModal) {
  document.getElementById("folder-modal-close")?.addEventListener("click", closeFolderModal);
  document.getElementById("fmg-cancel")?.addEventListener("click", closeFolderModal);
  folderModal.addEventListener("click", (e) => { if (e.target === folderModal) closeFolderModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !folderModal.classList.contains("hidden")) closeFolderModal(); });

  fmgName?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); document.getElementById("fmg-create")?.click(); } });

  document.getElementById("fmg-create")?.addEventListener("click", async (e) => {
    const createBtn = e.currentTarget;
    const groupName = normalizeFolderName(fmgName?.value || "");
    if (!groupName) {
      if (fmgStatus) fmgStatus.textContent = "Please enter a folder name.";
      fmgName?.focus();
      return;
    }
    const dateVal = fmgDate?.value || "";
    if (fmgStatus) fmgStatus.textContent = "Creating folder…";
    createBtn.disabled = true;
    let success = false;
    try {
      const res = await authorizedFetch("/api/folder-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: groupName, date: dateVal })
      });
      const result = await parseJsonResponse(res);
      if (!res.ok) throw new Error(result.error || "Could not create folder.");
      success = true;
      closeFolderModal();
      if (collectionsStatus) collectionsStatus.textContent = "";
      await loadCollections();
    } catch (err) {
      if (!success && fmgStatus) fmgStatus.textContent = err.message;
    } finally {
      createBtn.disabled = false;
    }
  });
}

// Sort bar
document.getElementById("sort-bar")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".sort-btn");
  if (!btn) return;
  const sort = btn.dataset.sort;
  if (!sort || sort === currentSortOrder) return;
  currentSortOrder = sort;
  document.querySelectorAll("#sort-bar .sort-btn").forEach(b => b.classList.toggle("is-active", b.dataset.sort === sort));
  // Re-render with cached photos — no re-fetch needed
  if (currentAllPhotos.length) renderCollections(currentAllPhotos);
});

// Move modal close
document.getElementById("move-modal-close")?.addEventListener("click", () => {
  document.getElementById("move-modal")?.classList.add("hidden");
});
document.getElementById("move-modal")?.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add("hidden");
});

newFolderInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); createFolderButton.click(); }
  if (e.key === "Escape") { cancelNewFolderBtn.click(); }
});

createFolderButton.addEventListener("click", async () => {
  const folderName = normalizeFolderName(newFolderInput.value);
  if (!folderName) {
    if (collectionsStatus) collectionsStatus.textContent = "Enter a valid name.";
    return;
  }
  if (collectionsStatus) collectionsStatus.textContent = "Creating collection...";
  try {
    const response = await authorizedFetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: folderName })
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result.error || "Could not create collection.");
    newFolderInput.value = "";
    newCollectionRow.classList.add("hidden");
    if (collectionsStatus) collectionsStatus.textContent = "";
    await loadCollections();
  } catch (error) {
    if (collectionsStatus) collectionsStatus.textContent = error.message;
  }
});

backButton.addEventListener("click", backToCollections);

uploadToggleBtn.addEventListener("click", () => {
  uploadPanel.classList.toggle("hidden");
});

selectAllButton.addEventListener("click", () => {
  const boxes = Array.from(document.querySelectorAll(".photo-select"));
  if (!boxes.length) return;

  const allChecked = boxes.every((box) => box.checked);
  boxes.forEach((box) => {
    box.checked = !allChecked;
    box.closest(".photo-card").classList.toggle("is-selected", !allChecked);
  });
});

deleteSelectedButton.addEventListener("click", async () => {
  const selectedIds = getSelectedPhotoIds();
  if (!selectedIds.length) {
    shareStatus.textContent = "Select at least one photo to delete.";
    return;
  }

  const confirmed = window.confirm(`Delete ${selectedIds.length} selected photo(s)?`);
  if (!confirmed) return;

  shareStatus.textContent = "Deleting selected photos...";

  try {
    const response = await authorizedFetch("/api/photos", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ photoIds: selectedIds })
    });

    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result.error || "Delete failed.");
    }

    shareStatus.textContent = result.message || "Deleted.";
    await loadFolders(folderSelect.value);
    await loadPhotos();
  } catch (error) {
    shareStatus.textContent = error.message;
  }
});

createShareButton.addEventListener("click", async () => {
  const selectedIds = getSelectedPhotoIds();
  if (!selectedIds.length) {
    shareStatus.textContent = "Select at least one photo to share.";
    return;
  }

  const expiresInHours = Number(expiryHoursInput.value || 72);
  shareStatus.textContent = "Creating share link...";

  try {
    const response = await authorizedFetch("/api/share-links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        photoIds: selectedIds,
        expiresInHours
      })
    });

    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result.error || "Failed to create share link.");
    }

    shareUrlInput.value = result.url;
    if (shareResultRow) shareResultRow.classList.remove("hidden");
    shareStatus.textContent = `Link ready. Expires ${new Date(result.expiresAt).toLocaleDateString()}.`;
  } catch (error) {
    shareStatus.textContent = error.message;
  }
});

shareFolderButton.addEventListener("click", async () => {
  const folderName = currentFolder || "General";
  const expiresInHours = Number(expiryHoursInput.value || 72);

  shareStatus.textContent = `Creating share link for folder ${folderName}...`;

  try {
    const response = await authorizedFetch("/api/share-links", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        folderNames: [folderName],
        expiresInHours
      })
    });

    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result.error || "Failed to create folder share link.");
    }

    shareUrlInput.value = result.url;
    if (shareResultRow) shareResultRow.classList.remove("hidden");
    shareStatus.textContent = `Link ready. Expires ${new Date(result.expiresAt).toLocaleDateString()}.`;
  } catch (error) {
    shareStatus.textContent = error.message;
  }
});

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:absolute;left:-9999px;top:-9999px";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

copyShareButton.addEventListener("click", async () => {
  if (!shareUrlInput.value) {
    shareStatus.textContent = "Create a share link first.";
    return;
  }
  const ok = await copyToClipboard(shareUrlInput.value);
  if (ok) {
    copyShareButton.textContent = "Copied!";
    shareStatus.textContent = "Share link copied.";
    setTimeout(() => { copyShareButton.textContent = "Copy"; }, 2000);
  } else {
    shareStatus.textContent = "Could not copy — please select the link and copy manually.";
  }
});

// ─── Dashboard lightbox ────────────────────────────────────────────

function setDashLbPhoto(photo) {
  if (!photo) return;
  if (isVideoMimeType(photo.mimeType)) {
    dashLbImage.src = "";
    dashLbImage.classList.add("hidden");
    dashLbVideo.src = appendAuthQuery(api(`/api/photos/${photo.id}/view`));
    dashLbVideo.classList.remove("hidden");
    dashLbVideo.load();
    dashLbVideo.play().catch(() => {});
  } else {
    if (!dashLbVideo.paused) dashLbVideo.pause();
    dashLbVideo.src = "";
    dashLbVideo.classList.add("hidden");
    dashLbImage.classList.remove("hidden");
    dashLbImage.src = appendAuthQuery(api(`/api/photos/${photo.id}/view`));
    dashLbImage.alt = photo.originalName;
  }
  if (dashLbDownload) {
    dashLbDownload.href = appendAuthQuery(api(`/api/photos/${photo.id}/download`));
  }
}

function openDashLightbox(index) {
  if (!currentPhotos.length) return;
  dashLbIndex = Math.max(0, Math.min(index, currentPhotos.length - 1));
  if (!dashLbHistoryEntry) {
    history.pushState({ dashLightbox: true }, "", location.href);
    dashLbHistoryEntry = true;
  }
  setDashLbPhoto(currentPhotos[dashLbIndex]);
  dashLightbox.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeDashLightbox({ fromPopState = false } = {}) {
  if (!fromPopState && dashLbHistoryEntry) {
    history.back();
    return;
  }
  dashLightbox.classList.add("hidden");
  dashLbImage.src = "";
  dashLbImage.classList.remove("hidden");
  if (dashLbVideo) {
    dashLbVideo.pause();
    dashLbVideo.src = "";
    dashLbVideo.classList.add("hidden");
  }
  dashLbIndex = -1;
  document.body.style.overflow = "";
  if (fromPopState) dashLbHistoryEntry = false;
}

dashLbClose.addEventListener("click", () => closeDashLightbox());

dashLbPrev.addEventListener("click", () => {
  if (!currentPhotos.length || dashLbIndex === -1) return;
  dashLbIndex = (dashLbIndex - 1 + currentPhotos.length) % currentPhotos.length;
  setDashLbPhoto(currentPhotos[dashLbIndex]);
});

dashLbNext.addEventListener("click", () => {
  if (!currentPhotos.length || dashLbIndex === -1) return;
  dashLbIndex = (dashLbIndex + 1) % currentPhotos.length;
  setDashLbPhoto(currentPhotos[dashLbIndex]);
});

dashLightbox.addEventListener("click", (e) => {
  if (!e.target.closest(".dash-lb-figure, .dash-lb-nav, .dash-lb-close, .dash-lb-download")) {
    closeDashLightbox();
  }
});

document.addEventListener("keydown", (e) => {
  if (!dashLightbox || dashLightbox.classList.contains("hidden")) return;
  if (e.key === "Escape") { closeDashLightbox(); return; }
  if (e.key === "ArrowRight") { dashLbNext.click(); return; }
  if (e.key === "ArrowLeft") { dashLbPrev.click(); }
});

// touch swipe on dashboard lightbox
(function () {
  let sx = 0; let dx = 0; let sy = 0;
  dashLightbox.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0;
  }, { passive: true });
  dashLightbox.addEventListener("touchmove", (e) => {
    if (e.touches.length !== 1) return;
    dx = e.touches[0].clientX - sx;
    const dy = e.touches[0].clientY - sy;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 6) e.preventDefault();
  }, { passive: false });
  dashLightbox.addEventListener("touchend", () => {
    if (Math.abs(dx) > 48) {
      if (dx < 0) dashLbNext.click(); else dashLbPrev.click();
    }
    dx = 0;
  });
}());

// ─── View switcher (nav items with data-view) ──────────────────────────────
const ALL_VIEWS = ["collections", "collection-detail", "share-links"];

function switchView(viewName) {
  ALL_VIEWS.forEach((name) => {
    const el = document.getElementById(`view-${name}`);
    if (el) el.classList.toggle("hidden", name !== viewName);
  });
  document.querySelectorAll(".dash-nav-item[data-view]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === viewName);
  });
}

document.querySelectorAll(".dash-nav-item[data-view]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const view = btn.dataset.view;
    if (view === "collections") {
      backToCollections();
    } else if (view === "share-links") {
      // Hide all standard views, show share-links
      viewCollections.classList.add("hidden");
      viewCollectionDetail.classList.add("hidden");
      const statsRow = document.getElementById("stats-row");
      const storageBar = document.getElementById("storage-bar-wrap");
      if (statsRow) statsRow.classList.add("hidden");
      if (storageBar) storageBar.classList.add("hidden");
      switchView("share-links");
      await loadShareLinks();
    }
  });
});

// ─── Stats ─────────────────────────────────────────────────────────────────
const STORAGE_LIMIT_GB = 10; // visual reference only — adjust to match R2 plan

async function loadStats() {
  try {
    const response = await authorizedFetch("/api/admin/stats");
    if (!response.ok) return;
    const stats = await response.json();
    renderStats(stats);
  } catch {
    // stats are non-critical
  }
}

function renderStats(stats) {
  const { photoCount = 0, totalSize = 0, folderCount = 0,
    shareLinkCount = 0, activeShareCount = 0, storageProvider = "local" } = stats;

  // Sidebar mini-stats
  const ssp = document.getElementById("ss-photos");
  const sss = document.getElementById("ss-storage");
  const ssa = document.getElementById("ss-active");
  if (ssp) ssp.textContent = photoCount.toLocaleString();
  if (sss) sss.textContent = formatBytes(totalSize);
  if (ssa) ssa.textContent = String(activeShareCount);

  // Stats row (shown in the collections view header area)
  const statsRowEl = document.getElementById("stats-row");
  const storageBarWrap = document.getElementById("storage-bar-wrap");
  if (!statsRowEl) return;

  const statsData = [
    { label: "Photos",       value: photoCount.toLocaleString(),    sub: `${folderCount} collection${folderCount !== 1 ? "s" : ""}`,  cls: "" },
    { label: "Storage used", value: formatBytes(totalSize),          sub: storageProvider.toUpperCase(),                               cls: "accent-orange" },
    { label: "Share links",  value: shareLinkCount.toLocaleString(), sub: `${activeShareCount} active`,                                cls: "accent-green" },
    { label: "Active links", value: String(activeShareCount),        sub: `of ${shareLinkCount} total`,                                cls: "accent-blue" },
  ];

  statsRowEl.innerHTML = statsData.map((s, i) => `
    <div class="stat-card ${s.cls} anim-scale-in stagger-${i + 1}">
      <p class="stat-label">${s.label}</p>
      <span class="stat-value">${s.value}</span>
      <span class="stat-sub">${s.sub}</span>
    </div>`).join("");

  statsRowEl.classList.remove("hidden");

  // Storage bar
  if (storageBarWrap) {
    const limitBytes = STORAGE_LIMIT_GB * 1024 * 1024 * 1024;
    const pct = Math.min(100, (totalSize / limitBytes) * 100);
    const fill = document.getElementById("storage-bar-fill");
    const text = document.getElementById("storage-bar-text");
    if (fill) fill.style.width = `${pct.toFixed(1)}%`;
    if (text) text.textContent = `${formatBytes(totalSize)} / ${STORAGE_LIMIT_GB} GB`;
    storageBarWrap.classList.remove("hidden");
  }

  // Storage badge
  const badge = document.getElementById("storage-provider-badge");
  if (badge) {
    badge.classList.toggle("hidden", storageProvider !== "r2");
  }
}

// ─── Share links management ───────────────────────────────────────────────
async function loadShareLinks() {
  const container = document.getElementById("share-links-list");
  const statusEl  = document.getElementById("share-links-status");
  if (!container) return;
  container.innerHTML = "<p class=\"skeleton\" style=\"height:2rem;margin-bottom:10px\"></p>".repeat(3);
  if (statusEl) statusEl.textContent = "";

  try {
    const response = await authorizedFetch("/api/share-links");
    if (!response.ok) throw new Error("Could not load share links.");
    const links = await response.json();
    renderShareLinks(links);
  } catch (e) {
    if (statusEl) statusEl.textContent = e.message;
    container.innerHTML = "";
  }
}

function renderShareLinks(links) {
  const container = document.getElementById("share-links-list");
  if (!container) return;

  if (!links.length) {
    container.innerHTML = `<div class="share-links-empty">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3;margin-bottom:10px"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      <p>No share links yet.</p></div>`;
    return;
  }

  container.innerHTML = links.map((link) => {
    const expired = link.expired;
    const expiryDate = new Date(link.expiresAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const createdDate = new Date(link.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const shareUrl = `${window.location.origin}/s/${encodeURIComponent(link.shortCode)}`;
    const folderLabel = link.folderNames?.length ? link.folderNames.join(", ") : "—";

    return `<div class="share-link-card ${expired ? "is-expired" : ""} anim-fade-up" data-token="${link.token}">
      <div class="share-link-meta">
        <div class="share-link-code">
          <a href="${shareUrl}" target="_blank" rel="noopener">${link.shortCode || link.token.slice(0, 20) + "…"}</a>
        </div>
        <div class="share-link-details">
          <span class="pill-badge ${expired ? "expired" : "active"}">${expired ? "Expired" : "Active"}</span>
          <span class="pill-badge">${link.photoCount} photo${link.photoCount !== 1 ? "s" : ""}</span>
          <span class="pill-badge">${folderLabel}</span>
          <span>Created ${createdDate}</span>
          <span>Expires ${expiryDate}</span>
        </div>
      </div>
      <div class="share-link-actions">
        <button class="ghost-btn share-link-copy-btn" type="button" data-url="${shareUrl}">Copy</button>
        <button class="ghost-btn share-link-revoke-btn" type="button" data-token="${link.token}">Revoke</button>
      </div>
    </div>`;
  }).join("");

  // Bind copy buttons
  container.querySelectorAll(".share-link-copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ok = await copyToClipboard(btn.dataset.url);
      if (ok) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy"; }, 2000); }
    });
  });

  // Bind revoke buttons
  container.querySelectorAll(".share-link-revoke-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!window.confirm("Revoke this share link? The client will immediately lose access.")) return;
      await revokeShareLink(btn.dataset.token);
    });
  });
}

async function revokeShareLink(token) {
  const statusEl = document.getElementById("share-links-status");
  if (statusEl) statusEl.textContent = "Revoking...";
  try {
    const response = await authorizedFetch(`/api/share-links/${encodeURIComponent(token)}`, { method: "DELETE" });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result.error || "Failed to revoke.");
    if (statusEl) statusEl.textContent = "Link revoked.";
    await loadShareLinks();
    await loadStats(); // refresh sidebar counts
  } catch (e) {
    if (statusEl) statusEl.textContent = e.message;
  }
}

ensureAuthenticated();
