const sharedGrid = document.getElementById("shared-photos-grid");
const shareFolderTitle = document.getElementById("share-folder-title");
const coverImage = document.getElementById("share-cover-image");
const cardTemplate = document.getElementById("shared-photo-template");
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightbox-image");
const lightboxVideo = document.getElementById("lightbox-video");
const lightboxCaption = document.getElementById("lightbox-caption");
const lightboxClose = document.getElementById("lightbox-close");
const lightboxPrev = document.getElementById("lightbox-prev");
const lightboxNext = document.getElementById("lightbox-next");
const lightboxFigure = lightbox.querySelector(".lightbox-figure");
const lightboxDownload = document.getElementById("lightbox-download");
const lightboxLoading = document.getElementById("lightbox-loading");

// Video reel elements
const videoReel = document.getElementById("video-reel");
const reelTrack = document.getElementById("reel-track");
const reelCloseBtn = document.getElementById("reel-close");

let sharedPhotos = [];
let activePhotoIndex = -1;
let lastWheelNavigateAt = 0;
let masonryResizeTimer = null;
let isSwipingLightbox = false;
let swipeStartX = 0;
let swipeDeltaX = 0;
let swipeStartY = 0;
let swipeDeltaY = 0;
let swipeStartAt = 0;
let swipeLastX = 0;
let swipeLastAt = 0;
let swipeVelocityX = 0;
let lightboxLoadToken = 0;
let hasLightboxHistoryEntry = false;

function setLightboxLoading(isLoading) {
  if (lightboxLoading) {
    lightboxLoading.classList.toggle("hidden", !isLoading);
  }
  lightboxImage.classList.toggle("is-loading", isLoading);
}

function animateLightboxTransition(direction) {
  if (!lightboxFigure || typeof lightboxFigure.animate !== "function" || direction === 0) {
    return;
  }

  const fromX = direction > 0 ? 42 : -42;
  lightboxFigure.animate(
    [
      { transform: `translateX(${fromX}px)`, opacity: 0.72 },
      { transform: "translateX(0)", opacity: 1 }
    ],
    {
      duration: 220,
      easing: "cubic-bezier(0.22, 0.61, 0.36, 1)"
    }
  );
}

function resetLightboxSwipePosition(animated = true) {
  if (!lightboxFigure) return;
  lightboxFigure.classList.remove("is-dragging");

  if (animated) {
    lightboxFigure.style.transition = "transform 180ms cubic-bezier(0.22, 0.61, 0.36, 1)";
  } else {
    lightboxFigure.style.transition = "none";
  }

  lightboxFigure.style.transform = "translateX(0)";
  lightboxFigure.style.opacity = "1";

  if (animated) {
    window.setTimeout(() => {
      if (!lightboxFigure) return;
      lightboxFigure.style.transition = "";
    }, 190);
  }
}

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to legacy copy method.
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function applyMasonryLayout() {
  if (!sharedGrid || !sharedGrid.children.length) return;

  const computed = window.getComputedStyle(sharedGrid);
  const rowGap = Number.parseFloat(computed.rowGap) || 0;
  const autoRow = Number.parseFloat(computed.gridAutoRows) || 8;

  sharedGrid.querySelectorAll(".share-photo-card").forEach((card) => {
    const image = card.querySelector(".photo-preview");
    if (!image || !image.naturalWidth || !image.naturalHeight) {
      card.style.gridRowEnd = "span 1";
      return;
    }

    const cardWidth = card.clientWidth || image.clientWidth;
    if (!cardWidth) {
      card.style.gridRowEnd = "span 1";
      return;
    }

    const renderedHeight = Math.max(1, Math.round((cardWidth * image.naturalHeight) / image.naturalWidth));
    const span = Math.max(1, Math.ceil((renderedHeight + rowGap) / (autoRow + rowGap)));
    card.style.gridRowEnd = `span ${span}`;
  });
}

function scheduleMasonryLayout() {
  window.clearTimeout(masonryResizeTimer);
  masonryResizeTimer = window.setTimeout(() => {
    applyMasonryLayout();
  }, 90);
}

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
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#f2e7da'/><stop offset='100%' stop-color='#e6d5bf'/></linearGradient></defs><rect fill='url(#g)' width='640' height='360'/><rect x='220' y='80' rx='14' ry='14' width='200' height='200' fill='#fff' stroke='#c9b49a' stroke-width='3'/><text x='320' y='175' text-anchor='middle' font-size='34' font-family='Arial' fill='#5d4a39'>${label}</text><text x='320' y='215' text-anchor='middle' font-size='16' font-family='Arial' fill='#7a6756'>Preview unavailable</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function makeVideoPlaceholder() {
  return "/video-fallback.jpg";
}

function renderStateMessage(message) {
  sharedGrid.innerHTML = `<p class="empty">${message}</p>`;
}

function renderSharedPhotos(photos) {
  sharedPhotos = [...photos].sort((a, b) => {
    const timeA = new Date(a.uploadedAt || 0).getTime();
    const timeB = new Date(b.uploadedAt || 0).getTime();
    return timeA - timeB;
  });
  sharedGrid.innerHTML = "";
  galleryVideoObserver.disconnect();

  if (!sharedPhotos.length) {
    renderStateMessage("No photos in this share.");
    return;
  }

  sharedPhotos.forEach((photo) => {
    const card = cardTemplate.content.cloneNode(true);
    const article = card.querySelector(".share-photo-card");
    const image = card.querySelector(".photo-preview");
    const videoOverlay = card.querySelector(".video-play-overlay");
    const name = card.querySelector(".photo-name");
    const size = card.querySelector(".photo-size");
    const download = card.querySelector(".share-download-btn");
    const likeBtn = card.querySelector(".share-like-btn");
    const shareBtn = card.querySelector(".share-share-btn");

    const isImage = isImageMimeType(photo.mimeType);
    const isVideo = isVideoMimeType(photo.mimeType);

    if (isImage) {
      image.src = photo.thumbUrl || photo.viewUrl;
      image.alt = photo.originalName;
      if (videoOverlay) videoOverlay.style.display = "none";
    } else if (isVideo) {
      // Replace static <img> with a muted looping <video> that autoplays in-view
      const inlineVid = document.createElement("video");
      inlineVid.className = "photo-preview gallery-inline-video";
      inlineVid.src = photo.viewUrl;
      inlineVid.preload = "none";
      inlineVid.muted = true;
      inlineVid.loop = true;
      inlineVid.playsInline = true;
      inlineVid.poster = "/video-fallback.jpg";
      inlineVid.style.cssText = "width:100%;display:block;object-fit:cover;cursor:pointer;";
      image.replaceWith(inlineVid);
      if (videoOverlay) videoOverlay.style.display = "flex";
      galleryVideoObserver.observe(article);
    } else {
      image.src = makeFilePlaceholder(photo.originalName);
      image.alt = photo.originalName;
      image.style.cursor = "default";
      if (videoOverlay) videoOverlay.style.display = "none";
    }

    name.textContent = photo.originalName;
    size.textContent = `${formatBytes(photo.size)} • ${new Date(photo.uploadedAt).toLocaleString()}`;
    download.href = photo.downloadUrl;
    article.dataset.photoId = photo.id;

    likeBtn.addEventListener("click", (event) => {
      event.preventDefault();
      const liked = likeBtn.classList.toggle("is-active");
      likeBtn.textContent = liked ? "♥" : "♡";
    });

    shareBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      const photoUrl = new URL(photo.viewUrl, window.location.origin).toString();
      const copied = await copyText(photoUrl);
      shareBtn.textContent = copied ? "✓" : "↗";
      window.setTimeout(() => {
        shareBtn.textContent = "↗";
      }, 900);
    });

    if (isImage) {
      image.addEventListener("load", scheduleMasonryLayout);
      image.addEventListener("click", () => {
        openLightboxById(photo.id);
      });
    } else if (isVideo) {
      image.addEventListener("load", scheduleMasonryLayout);
      // Open reel at the right video index
      const openThisReel = () => {
        const videoIndex = sharedPhotos.filter((p) => isVideoMimeType(p.mimeType)).findIndex((p) => p.id === photo.id);
        openReel(Math.max(0, videoIndex));
      };
      image.addEventListener("click", openThisReel);
      if (videoOverlay) videoOverlay.addEventListener("click", openThisReel);
    } else {
      image.style.cursor = "default";
      image.addEventListener("load", scheduleMasonryLayout);
    }

    sharedGrid.appendChild(card);
  });

  requestAnimationFrame(() => {
    applyMasonryLayout();
  });
}

function renderCoverPhoto(photos, coverPhotoId) {
  const coverPhoto = (coverPhotoId && photos.find((p) => p.id === coverPhotoId))
    || photos.find((photo) => isImageMimeType(photo.mimeType));
  if (coverPhoto) {
    coverImage.src = coverPhoto.viewUrl;
    coverImage.alt = `${coverPhoto.originalName} cover preview`;
    return;
  }
  coverImage.src = "/video-fallback.jpg";
  coverImage.alt = "Gallery cover";
}

function setLightboxPhoto(index, direction = 0) {
  if (index < 0 || index >= sharedPhotos.length) return;

  activePhotoIndex = index;
  const photo = sharedPhotos[index];
  lightboxCaption.textContent = `${photo.originalName} • ${formatBytes(photo.size)}`;
  if (lightboxDownload) {
    lightboxDownload.href = photo.downloadUrl;
    lightboxDownload.setAttribute("download", photo.originalName || "file");
  }

  const token = ++lightboxLoadToken;

  if (isVideoMimeType(photo.mimeType)) {
    // Stop any previous image load
    lightboxImage.onload = null;
    lightboxImage.onerror = null;
    lightboxImage.src = "";
    lightboxImage.classList.add("hidden");

    lightboxVideo.classList.remove("hidden");
    lightboxVideo.src = photo.viewUrl;
    lightboxVideo.load();
    lightboxVideo.play().catch(() => {});
    setLightboxLoading(false);
    animateLightboxTransition(direction);
  } else {
    // Stop video if switching away from one
    if (!lightboxVideo.paused) {
      lightboxVideo.pause();
    }
    lightboxVideo.src = "";
    lightboxVideo.classList.add("hidden");

    lightboxImage.classList.remove("hidden");
    lightboxImage.alt = photo.originalName;
    setLightboxLoading(true);

    lightboxImage.onload = () => {
      if (token !== lightboxLoadToken) return;
      setLightboxLoading(false);
      animateLightboxTransition(direction);
    };

    lightboxImage.onerror = () => {
      if (token !== lightboxLoadToken) return;
      setLightboxLoading(false);
      animateLightboxTransition(direction);
    };

    lightboxImage.src = photo.viewUrl;
  }
}

function openLightboxById(photoId) {
  const index = sharedPhotos.findIndex((photo) => photo.id === photoId);
  if (index === -1) return;

  if (!hasLightboxHistoryEntry) {
    window.history.pushState({ lightbox: true }, "", window.location.href);
    hasLightboxHistoryEntry = true;
  }

  setLightboxPhoto(index);
  lightbox.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeLightbox({ fromPopState = false } = {}) {
  if (!fromPopState && hasLightboxHistoryEntry) {
    window.history.back();
    return;
  }

  lightbox.classList.add("hidden");
  lightboxImage.src = "";
  lightboxImage.onload = null;
  lightboxImage.onerror = null;
  lightboxImage.classList.remove("hidden");

  if (lightboxVideo) {
    lightboxVideo.pause();
    lightboxVideo.src = "";
    lightboxVideo.classList.add("hidden");
  }

  setLightboxLoading(false);
  lightboxCaption.textContent = "";
  activePhotoIndex = -1;
  lastWheelNavigateAt = 0;
  isSwipingLightbox = false;
  swipeStartX = 0;
  swipeDeltaX = 0;
  resetLightboxSwipePosition(false);
  if (lightboxDownload) {
    lightboxDownload.removeAttribute("href");
  }
  lightboxLoadToken += 1;
  if (fromPopState) {
    hasLightboxHistoryEntry = false;
  }
  document.body.style.overflow = "";
}

function showNextPhoto() {
  if (!sharedPhotos.length || activePhotoIndex === -1) return;
  const nextIndex = (activePhotoIndex + 1) % sharedPhotos.length;
  setLightboxPhoto(nextIndex, 1);
}

function showPreviousPhoto() {
  if (!sharedPhotos.length || activePhotoIndex === -1) return;
  const prevIndex = (activePhotoIndex - 1 + sharedPhotos.length) % sharedPhotos.length;
  setLightboxPhoto(prevIndex, -1);
}

function handleLightboxWheel(event) {
  if (lightbox.classList.contains("hidden")) return;

  const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (Math.abs(dominantDelta) < 10) return;

  const now = Date.now();
  if (now - lastWheelNavigateAt < 220) {
    event.preventDefault();
    return;
  }

  event.preventDefault();
  lastWheelNavigateAt = now;

  if (dominantDelta > 0) {
    showNextPhoto();
    return;
  }

  showPreviousPhoto();
}

function handleLightboxTouchStart(event) {
  if (lightbox.classList.contains("hidden")) return;
  if (event.touches.length !== 1) return;

  const touch = event.touches[0];
  isSwipingLightbox = true;
  swipeStartX = touch.clientX;
  swipeStartY = touch.clientY;
  swipeDeltaX = 0;
  swipeDeltaY = 0;
  swipeStartAt = Date.now();
  swipeLastX = swipeStartX;
  swipeLastAt = swipeStartAt;
  swipeVelocityX = 0;

  if (!lightboxFigure) return;
  lightboxFigure.classList.add("is-dragging");
  lightboxFigure.style.transition = "none";
}

function handleLightboxTouchMove(event) {
  if (!isSwipingLightbox || !lightboxFigure) return;
  if (event.touches.length !== 1) return;

  const touch = event.touches[0];
  const now = Date.now();
  swipeDeltaX = touch.clientX - swipeStartX;
  swipeDeltaY = touch.clientY - swipeStartY;

  const dt = Math.max(1, now - swipeLastAt);
  const vx = (touch.clientX - swipeLastX) / dt;
  swipeVelocityX = swipeVelocityX * 0.7 + vx * 0.3;
  swipeLastX = touch.clientX;
  swipeLastAt = now;

  if (Math.abs(swipeDeltaX) > Math.abs(swipeDeltaY) && Math.abs(swipeDeltaX) > 6) {
    event.preventDefault();
  }

  const damped = swipeDeltaX * 0.9;
  const opacity = 1 - Math.min(0.28, Math.abs(damped) / 340);
  lightboxFigure.style.transform = `translateX(${damped}px)`;
  lightboxFigure.style.opacity = String(opacity);
}

function handleLightboxTouchEnd() {
  if (!isSwipingLightbox) return;
  isSwipingLightbox = false;

  const threshold = 52;
  const flickVelocityThreshold = 0.45;
  const elapsed = Math.max(1, Date.now() - swipeStartAt);
  const avgVelocityX = swipeDeltaX / elapsed;
  const dominantVelocityX = Math.abs(swipeVelocityX) > Math.abs(avgVelocityX) ? swipeVelocityX : avgVelocityX;
  const isStrongDistanceSwipe = Math.abs(swipeDeltaX) >= threshold;
  const isFlickSwipe = Math.abs(dominantVelocityX) >= flickVelocityThreshold && Math.abs(swipeDeltaX) >= 14;
  const shouldNavigate = (isStrongDistanceSwipe || isFlickSwipe) && Math.abs(swipeDeltaX) > Math.abs(swipeDeltaY);

  if (shouldNavigate) {
    if (swipeDeltaX < 0) {
      showNextPhoto();
    } else {
      showPreviousPhoto();
    }
    resetLightboxSwipePosition(false);
    swipeDeltaX = 0;
    swipeDeltaY = 0;
    swipeVelocityX = 0;
    return;
  }

  swipeDeltaX = 0;
  swipeDeltaY = 0;
  swipeVelocityX = 0;
  resetLightboxSwipePosition(true);
}

// ─── Video Reel ───────────────────────────────────────────────────

let reelVideos = [];
let reelObserver = null;

// IntersectionObserver: autoplay gallery video cards when centre of screen,
// pause + unload when scrolled away — like Instagram/TikTok inline previews.
const galleryVideoObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    const vid = entry.target.querySelector(".gallery-inline-video");
    if (!vid) return;
    if (entry.intersectionRatio >= 0.5) {
      // Load src on demand (was preload="none")
      if (!vid.src && vid.dataset.src) vid.src = vid.dataset.src;
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  });
}, {
  threshold: 0.5
});
let reelMuted = false;
let reelHistoryEntry = false;

function buildReelItem(photo, index) {
  const item = document.createElement("div");
  item.className = "reel-item";
  item.dataset.index = index;

  const vid = document.createElement("video");
  vid.className = "reel-video";
  vid.src = photo.viewUrl;
  vid.preload = "none";
  vid.loop = true;
  vid.playsInline = true;
  vid.muted = reelMuted;

  vid.addEventListener("loadedmetadata", () => {
    if (vid.videoHeight > vid.videoWidth) item.classList.add("is-portrait");
  }, { once: true });

  const overlay = document.createElement("div");
  overlay.className = "reel-overlay";

  const nameEl = document.createElement("p");
  nameEl.className = "reel-name";
  nameEl.textContent = photo.originalName;

  const sizeEl = document.createElement("p");
  sizeEl.className = "reel-size";
  sizeEl.textContent = formatBytes(photo.size);
  overlay.appendChild(nameEl);
  overlay.appendChild(sizeEl);

  const actions = document.createElement("div");
  actions.className = "reel-actions";

  const likeBtn = document.createElement("button");
  likeBtn.className = "reel-action-btn reel-like-btn";
  likeBtn.type = "button";
  likeBtn.setAttribute("aria-label", "Favourite");
  likeBtn.innerHTML = "♡";
  likeBtn.addEventListener("click", () => {
    const liked = likeBtn.classList.toggle("is-active");
    likeBtn.innerHTML = liked ? "♥" : "♡";
  });

  const muteBtn = document.createElement("button");
  muteBtn.className = "reel-action-btn reel-mute-btn";
  muteBtn.type = "button";
  muteBtn.setAttribute("aria-label", "Toggle mute");
  const mutedIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
  const unmutedIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>`;
  muteBtn.innerHTML = reelMuted ? mutedIcon : unmutedIcon;
  muteBtn.addEventListener("click", () => {
    reelMuted = !reelMuted;
    reelTrack.querySelectorAll(".reel-video").forEach((v) => { v.muted = reelMuted; });
    muteBtn.innerHTML = reelMuted ? mutedIcon : unmutedIcon;
  });

  const dlBtn = document.createElement("a");
  dlBtn.className = "reel-action-btn reel-download-btn";
  dlBtn.href = photo.downloadUrl;
  dlBtn.target = "_blank";
  dlBtn.rel = "noopener";
  dlBtn.setAttribute("aria-label", "Download");
  dlBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="17" height="17"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

  actions.appendChild(likeBtn);
  actions.appendChild(muteBtn);
  actions.appendChild(dlBtn);

  item.appendChild(vid);
  item.appendChild(overlay);
  item.appendChild(actions);
  return item;
}

function openReel(startIndex = 0) {
  const videos = sharedPhotos.filter((p) => isVideoMimeType(p.mimeType));
  if (!videos.length) return;
  reelVideos = videos;
  reelTrack.innerHTML = "";
  reelVideos.forEach((photo, i) => reelTrack.appendChild(buildReelItem(photo, i)));

  if (reelObserver) reelObserver.disconnect();
  reelObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const v = entry.target.querySelector(".reel-video");
      if (!v) return;
      if (entry.intersectionRatio >= 0.6) {
        v.preload = "auto";
        v.play().catch(() => {});
      } else {
        v.pause();
      }
    });
  }, { threshold: 0.6 });
  reelTrack.querySelectorAll(".reel-item").forEach((item) => reelObserver.observe(item));

  const target = reelTrack.children[startIndex];
  if (target) target.scrollIntoView({ behavior: "instant" });

  if (!reelHistoryEntry) {
    window.history.pushState({ reel: true }, "", window.location.href);
    reelHistoryEntry = true;
  }
  videoReel.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeReel({ fromPopState = false } = {}) {
  if (!fromPopState && reelHistoryEntry) { window.history.back(); return; }
  if (reelObserver) { reelObserver.disconnect(); reelObserver = null; }
  reelTrack.querySelectorAll(".reel-video").forEach((v) => { v.pause(); v.src = ""; });
  reelTrack.innerHTML = "";
  videoReel.classList.add("hidden");
  document.body.style.overflow = "";
  if (fromPopState) reelHistoryEntry = false;
}

if (reelCloseBtn) reelCloseBtn.addEventListener("click", () => closeReel());
document.addEventListener("keydown", (e) => {
  if (!videoReel || videoReel.classList.contains("hidden")) return;
  if (e.key === "Escape") closeReel();
});

// ─── Shared gallery ───────────────────────────────────────────────

async function loadSharedGallery() {
  const token = window.location.pathname.split("/").filter(Boolean).pop();

  try {
    const response = await fetch(`/api/share/${token}`);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Could not load this share link.");
    }

    const folderName = Array.isArray(result.folders) && result.folders.length
      ? result.folders[0]
      : "";
    if (shareFolderTitle) shareFolderTitle.textContent = folderName || "Gallery";
    const galleryFolderEl = document.getElementById("gallery-folder-name");
    if (galleryFolderEl) galleryFolderEl.textContent = folderName || "Gallery";

    renderCoverPhoto(result.photos, result.coverPhotoId);
    renderSharedPhotos(result.photos);
  } catch (error) {
    if (shareFolderTitle) shareFolderTitle.textContent = "Link unavailable";
    const galleryFolderEl = document.getElementById("gallery-folder-name");
    if (galleryFolderEl) galleryFolderEl.textContent = "";
    if (coverImage) coverImage.style.display = "none";
    renderStateMessage(error.message);
  }
}

loadSharedGallery();

lightboxClose.addEventListener("click", closeLightbox);
lightboxNext.addEventListener("click", showNextPhoto);
lightboxPrev.addEventListener("click", showPreviousPhoto);
lightbox.addEventListener("wheel", handleLightboxWheel, { passive: false });
lightbox.addEventListener("touchstart", handleLightboxTouchStart, { passive: true });
lightbox.addEventListener("touchmove", handleLightboxTouchMove, { passive: false });
lightbox.addEventListener("touchend", handleLightboxTouchEnd);
lightbox.addEventListener("touchcancel", handleLightboxTouchEnd);
window.addEventListener("resize", scheduleMasonryLayout);

lightbox.addEventListener("click", (event) => {
  const clickedOnControls = Boolean(
    event.target.closest("#lightbox-image, #lightbox-video, .lightbox-nav, .lightbox-close, .lightbox-download")
  );

  if (!clickedOnControls) {
    closeLightbox();
  }
});

window.addEventListener("popstate", () => {
  // Reel takes priority
  if (!videoReel.classList.contains("hidden")) {
    closeReel({ fromPopState: true });
    return;
  }
  if (!lightbox.classList.contains("hidden")) {
    closeLightbox({ fromPopState: true });
  }
});

document.addEventListener("keydown", (event) => {
  if (lightbox.classList.contains("hidden")) return;

  if (event.key === "Escape") {
    closeLightbox();
    return;
  }

  if (event.key === "ArrowRight") {
    showNextPhoto();
    return;
  }

  if (event.key === "ArrowLeft") {
    showPreviousPhoto();
  }
});
