const AUTH_TOKEN_KEY = "ownerAuthToken";

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

function appendAuthQuery(url) {
  const safeToken = normalizeToken(authToken);
  if (!safeToken) return url;

  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}auth=${encodeURIComponent(safeToken)}`;
}

async function authorizedFetch(url, options = {}) {
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
  const entries = Object.entries(folderMap);
  if (!entries.length) {
    collectionsGrid.innerHTML = '<p class="empty">No collections yet. Click "New Collection" to create one.</p>';
    return;
  }

  entries.forEach(([folderName, folderPhotos]) => {
    // Use saved cover photo if set, otherwise fall back to first image
    const savedCoverId = currentCoverPhotoIds[folderName];
    const coverPhoto = (savedCoverId && folderPhotos.find((p) => p.id === savedCoverId))
      || folderPhotos.find((p) => isImageMimeType(p.mimeType))
      || folderPhotos[0];
    const card = document.createElement("article");
    card.className = "collection-card";

    const coverDiv = document.createElement("div");
    coverDiv.className = "collection-cover";
    if (coverPhoto) {
      const img = document.createElement("img");
      img.src = appendAuthQuery(`/api/photos/${coverPhoto.id}/thumb`);
      img.alt = folderName;
      img.loading = "lazy";
      coverDiv.appendChild(img);
    } else {
      coverDiv.classList.add("collection-cover-empty");
    }

    const info = document.createElement("div");
    info.className = "collection-info";
    info.innerHTML = `<p class="collection-name">${folderName}</p><p class="collection-count"><span class="count-dot"></span>${folderPhotos.length} ${folderPhotos.length === 1 ? "item" : "items"}</p>`;

    card.appendChild(coverDiv);
    card.appendChild(info);
    card.addEventListener("click", () => openCollection(folderName));
    collectionsGrid.appendChild(card);
  });
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
  history.pushState({ view: "collections" }, "", location.pathname);
  loadCollections();
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
      image.src = appendAuthQuery(`/api/photos/${photo.id}/thumb`);
    } else if (isVideo) {
      image.src = makeVideoPlaceholderDashboard();
      // Extract first frame for thumbnail
      const thumbVid = document.createElement("video");
      thumbVid.src = appendAuthQuery(`/api/photos/${photo.id}/view`);
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
    download.href = appendAuthQuery(`/api/photos/${photo.id}/download`);
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
    xhr.open("POST", "/api/upload");

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

async function uploadSelectedPhotos() {
  if (!photoInput.files.length || isUploading) {
    return;
  }

  isUploading = true;
  statusMessage.textContent = "Uploading... 0%";

  const formData = new FormData();
  formData.append("folder", currentFolder || "General");

  for (const file of photoInput.files) {
    formData.append("photos", file);
  }

  try {
    const result = await uploadWithProgress(formData);
    const uploadedCount = Array.isArray(result.items) ? result.items.length : photoInput.files.length;

    statusMessage.textContent = `Upload complete. ${uploadedCount} file(s) added.`;
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
  } catch {
    handleUnauthorized();
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authStatus.textContent = "Signing in...";

  try {
    const response = await fetch("/api/auth/login", {
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

newCollectionBtn.addEventListener("click", () => {
  newCollectionRow.classList.remove("hidden");
  newFolderInput.focus();
});

cancelNewFolderBtn.addEventListener("click", () => {
  newCollectionRow.classList.add("hidden");
  newFolderInput.value = "";
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

copyShareButton.addEventListener("click", async () => {
  if (!shareUrlInput.value) {
    shareStatus.textContent = "Create a share link first.";
    return;
  }

  try {
    await navigator.clipboard.writeText(shareUrlInput.value);
    shareStatus.textContent = "Share link copied to clipboard.";
  } catch {
    shareStatus.textContent = "Could not copy automatically. Please copy manually.";
  }
});

// ─── Dashboard lightbox ────────────────────────────────────────────

function setDashLbPhoto(photo) {
  if (!photo) return;
  if (isVideoMimeType(photo.mimeType)) {
    dashLbImage.src = "";
    dashLbImage.classList.add("hidden");
    dashLbVideo.src = appendAuthQuery(`/api/photos/${photo.id}/view`);
    dashLbVideo.classList.remove("hidden");
    dashLbVideo.load();
    dashLbVideo.play().catch(() => {});
  } else {
    if (!dashLbVideo.paused) dashLbVideo.pause();
    dashLbVideo.src = "";
    dashLbVideo.classList.add("hidden");
    dashLbImage.classList.remove("hidden");
    dashLbImage.src = appendAuthQuery(`/api/photos/${photo.id}/view`);
    dashLbImage.alt = photo.originalName;
  }
  if (dashLbDownload) {
    dashLbDownload.href = appendAuthQuery(`/api/photos/${photo.id}/download`);
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

ensureAuthenticated();
