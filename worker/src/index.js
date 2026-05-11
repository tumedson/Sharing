/**
 * Moments by Edson — Cloudflare Worker
 *
 * Replaces the Express.js VPS backend.
 * Storage:  Cloudflare R2  (media files)
 *           Cloudflare KV  (metadata.json, share-links.json, folders.json,
 *                           folder-meta.json, sessions)
 *
 * Bindings expected in wrangler.toml:
 *   R2  → r2_bucket  "moments-edson"
 *   KV  → kv_namespace
 *
 * Secrets (wrangler secret put):
 *   OWNER_USERNAME
 *   OWNER_PASSWORD
 *
 * Vars (wrangler.toml [vars]):
 *   PUBLIC_BASE_URL         e.g. https://moments-worker.xxx.workers.dev
 *   AUTH_SESSION_TTL_HOURS  default "24"
 */

// ─── KV keys ─────────────────────────────────────────────────────────────────
const KV_METADATA    = "db:metadata";
const KV_SHARELINKS  = "db:share-links";
const KV_FOLDERS     = "db:folders";
const KV_FOLDERMETA  = "db:folder-meta";
const KV_SESSION_PFX = "session:";

const DEFAULT_FOLDER     = "General";
const SHARE_CODE_CHARS   = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const SHARE_SLUG_CHARS   = "abcdefghjkmnpqrstuvwxyz23456789";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extra }
  });
}

function err(message, status = 400) {
  return json({ error: message }, status);
}

function sanitizeFileName(name) {
  return String(name || "").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizeFolderName(input) {
  if (typeof input !== "string") return "";
  const cleaned = input.trim().replace(/[\\/]+/g, "-").replace(/\s+/g, " ").slice(0, 80);
  if (!cleaned || cleaned === "." || cleaned === "..") return "";
  return cleaned;
}

function getPhotoFolder(photo) {
  return normalizeFolderName(photo.folder) || DEFAULT_FOLDER;
}

function isImageMimeType(t) { return typeof t === "string" && t.startsWith("image/"); }
function isVideoMimeType(t) { return typeof t === "string" && t.startsWith("video/"); }

function isS3Photo(photo) {
  if (!photo) return false;
  if (photo.storageType) return photo.storageType === "s3";
  return Boolean(photo.objectKey);
}

function getObjectKey(photo) {
  return photo.objectKey || photo.storedName;
}

function makeContentDisposition(type, name) {
  return `${type}; filename="${sanitizeFileName(name || "file")}"`;
}

function getAuthToken(request) {
  const header = request.headers.get("Authorization") || "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  const url = new URL(request.url);
  return url.searchParams.get("auth") || "";
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2, "0")).join("");
}

function randomString(chars, length) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return [...arr].map(b => chars[b % chars.length]).join("");
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 26)
    .replace(/-+$/g, "") || "gallery";
}

function isShareExpired(share) {
  return Date.now() > new Date(share.expiresAt).getTime();
}

// ─── KV read/write helpers ────────────────────────────────────────────────────

async function kvReadArray(KV, key) {
  const raw = await KV.get(key);
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

async function kvReadObject(KV, key) {
  const raw = await KV.get(key);
  if (!raw) return {};
  try { const v = JSON.parse(raw); return (v && typeof v === "object" && !Array.isArray(v)) ? v : {}; }
  catch { return {}; }
}

async function kvWrite(KV, key, value) {
  await KV.put(key, JSON.stringify(value));
}

// ─── Session helpers ──────────────────────────────────────────────────────────

async function issueSession(KV, username, ttlHours) {
  const token     = randomHex(32);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString();
  const session   = { username, createdAt, expiresAt };
  await KV.put(`${KV_SESSION_PFX}${token}`, JSON.stringify(session), {
    expirationTtl: ttlHours * 3600
  });
  return { token, username, createdAt, expiresAt };
}

async function resolveSession(KV, token) {
  if (!token) return null;
  const raw = await KV.get(`${KV_SESSION_PFX}${token}`);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (Date.now() > new Date(session.expiresAt).getTime()) return null;
    return { token, ...session };
  } catch { return null; }
}

async function deleteSession(KV, token) {
  await KV.delete(`${KV_SESSION_PFX}${token}`);
}

// ─── Auth middleware (returns session or null) ────────────────────────────────

async function requireAuth(request, env) {
  const token   = getAuthToken(request);
  const session = await resolveSession(env.KV, token);
  return session; // null → send 401
}

// ─── Metadata helpers ─────────────────────────────────────────────────────────

async function readMetadata(env)        { return kvReadArray(env.KV, KV_METADATA); }
async function writeMetadata(env, data) { return kvWrite(env.KV, KV_METADATA, data); }

async function readShareLinks(env)        { return kvReadArray(env.KV, KV_SHARELINKS); }
async function writeShareLinks(env, data) { return kvWrite(env.KV, KV_SHARELINKS, data); }

async function readFolderMeta(env)        { return kvReadObject(env.KV, KV_FOLDERMETA); }
async function writeFolderMeta(env, data) { return kvWrite(env.KV, KV_FOLDERMETA, data); }

async function readFolders(env) {
  const saved  = await kvReadArray(env.KV, KV_FOLDERS);
  const normed = saved.map(normalizeFolderName).filter(Boolean);
  return [...new Set([DEFAULT_FOLDER, ...normed])];
}

async function writeFolders(env, folders) {
  const normed = folders.map(normalizeFolderName).filter(Boolean);
  return kvWrite(env.KV, KV_FOLDERS, [...new Set([DEFAULT_FOLDER, ...normed])]);
}

async function getFolderCatalog(env) {
  const [saved, entries] = await Promise.all([readFolders(env), readMetadata(env)]);
  const fromPhotos = entries.map(getPhotoFolder);
  return [...new Set([DEFAULT_FOLDER, ...saved, ...fromPhotos])].sort((a, b) => a.localeCompare(b));
}

async function ensureFolderExists(env, folderName) {
  const normalized = normalizeFolderName(folderName) || DEFAULT_FOLDER;
  const folders    = await readFolders(env);
  if (!folders.includes(normalized)) {
    folders.push(normalized);
    await writeFolders(env, folders);
  }
  return normalized;
}

async function resolveShare(env, identifier) {
  const links = await readShareLinks(env);
  const share = links.find(l => l.token === identifier || l.shortCode === identifier);
  if (!share) return null;
  if (isShareExpired(share)) return "expired";
  return share;
}

// ─── R2 signed URL ───────────────────────────────────────────────────────────
// Cloudflare R2 does not support pre-signed GET URLs from the Worker directly
// the same way AWS SDK does.  Instead we proxy the object through the Worker,
// adding a short-lived HMAC token so the URL is tamper-evident.
//
// For the dashboard (owner) we use a Bearer token guard so we can just proxy.
// For share links (public) we generate a signed token.

async function signedProxyUrl(baseUrl, photoId, disposition, expiresInSeconds, secret) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const msg     = `${photoId}:${disposition}:${expires}`;
  const key     = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  const sigHex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
  return `${baseUrl}/internal/r2-proxy/${encodeURIComponent(photoId)}?disposition=${disposition}&expires=${expires}&sig=${sigHex}`;
}

async function verifyProxyToken(photoId, disposition, expires, sig, secret) {
  if (Date.now() / 1000 > Number(expires)) return false;
  const msg = `${photoId}:${disposition}:${expires}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const sigBytes = new Uint8Array(sig.match(/.{2}/g).map(b => parseInt(b, 16)));
  return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(msg));
}

function getPublicBase(env) {
  return String(env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
}

function getTtl(env) {
  return Number(env.AUTH_SESSION_TTL_HOURS || 24);
}

// ─── R2 proxy handler ────────────────────────────────────────────────────────

async function handleR2Proxy(request, env, photoId, requireSig) {
  const url         = new URL(request.url);
  const disposition = url.searchParams.get("disposition") || "inline";
  const expires     = url.searchParams.get("expires");
  const sig         = url.searchParams.get("sig");

  if (requireSig) {
    if (!expires || !sig) return err("Missing token", 403);
    const valid = await verifyProxyToken(photoId, disposition, expires, sig, env.HMAC_SECRET || "fallback-secret");
    if (!valid) return err("Token expired or invalid", 403);
  } else {
    // Owner-auth path: verify Bearer session
    const session = await requireAuth(request, env);
    if (!session) return err("Authentication required.", 401);
  }

  const entries = await readMetadata(env);
  const photo   = entries.find(e => e.id === photoId);
  if (!photo) return err("Photo not found.", 404);

  const key    = getObjectKey(photo);
  const object = await env.R2.get(key);
  if (!object) return err("File not found in storage.", 404);

  const contentType = photo.mimeType || "application/octet-stream";
  const cd          = makeContentDisposition(disposition, photo.originalName);

  const headers = new Headers({
    "Content-Type":        contentType,
    "Content-Disposition": cd,
    "Cache-Control":       disposition === "inline" ? "private, max-age=300" : "no-store",
    "Accept-Ranges":       "bytes"
  });

  // Handle Range requests for video streaming
  const rangeHeader = request.headers.get("Range");
  if (rangeHeader && object.size) {
    const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const total = object.size;
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end   = match[2] ? parseInt(match[2], 10) : total - 1;
      headers.set("Content-Range",  `bytes ${start}-${end}/${total}`);
      headers.set("Content-Length", String(end - start + 1));
      // R2 doesn't support partial reads directly — stream full and let CF handle it
      // For real range support with large videos, use a public R2 custom domain instead
    }
  }

  if (object.size) headers.set("Content-Length", String(object.size));

  return new Response(object.body, { status: 200, headers });
}

// ─── Thumbnail proxy ─────────────────────────────────────────────────────────
// Thumbnails are stored in R2 under key  "thumbs/<photoId>.jpg"
// They are generated by the VPS optimize-videos.sh / ensureVideoThumb and then
// can be synced to R2.  If no thumb exists we fall back to /video-fallback.jpg.

async function handleThumbProxy(request, env, photoId, requireSig) {
  const url     = new URL(request.url);
  const expires = url.searchParams.get("expires");
  const sig     = url.searchParams.get("sig");

  if (requireSig) {
    if (!expires || !sig) return err("Missing token", 403);
    const valid = await verifyProxyToken(photoId, "thumb", expires, sig, env.HMAC_SECRET || "fallback-secret");
    if (!valid) return err("Token expired or invalid", 403);
  } else {
    const session = await requireAuth(request, env);
    if (!session) return err("Authentication required.", 401);
  }

  // Try R2 thumb key
  const thumbKey = `thumbs/${photoId}.jpg`;
  const object   = await env.R2.get(thumbKey);

  if (object) {
    return new Response(object.body, {
      headers: {
        "Content-Type":  "image/jpeg",
        "Cache-Control": "public, max-age=86400"
      }
    });
  }

  // No thumb — redirect to fallback
  return Response.redirect(`${getPublicBase(env)}/video-fallback.jpg`, 302);
}

// ─── Upload handler ───────────────────────────────────────────────────────────

async function handleUpload(request, env) {
  const session = await requireAuth(request, env);
  if (!session) return err("Authentication required.", 401);

  const contentType = request.headers.get("Content-Type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return err("Expected multipart/form-data upload.");
  }

  const formData = await request.formData();
  const folder   = await ensureFolderExists(env, formData.get("folder") || DEFAULT_FOLDER);
  const files    = formData.getAll("photos");

  if (!files.length) return err("No files uploaded.");

  const entries    = await readMetadata(env);
  const newEntries = [];

  for (const file of files) {
    if (!(file instanceof File)) continue;

    const unique   = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const safeName = sanitizeFileName(file.name);
    const key      = `${unique}--${safeName}`;

    await env.R2.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" }
    });

    newEntries.push({
      id:           crypto.randomUUID(),
      storedName:   key,
      objectKey:    key,
      storageType:  "s3",
      originalName: file.name,
      mimeType:     file.type || "application/octet-stream",
      size:         file.size,
      folder,
      uploadedAt:   new Date().toISOString()
    });
  }

  if (!newEntries.length) return err("No valid files in upload.");

  await writeMetadata(env, [...entries, ...newEntries]);

  return json({ message: "Upload successful.", items: newEntries }, 201);
}

// ─── Router ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const path   = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request)
      });
    }

    try {
      const res = await route(request, env, path, method);
      // Attach CORS headers to every response
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(corsHeaders(request))) {
        headers.set(k, v);
      }
      return new Response(res.body, { status: res.status, headers });
    } catch (e) {
      console.error(e);
      return json({ error: "Unexpected server error." }, 500);
    }
  }
};

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";
  return {
    "Access-Control-Allow-Origin":  origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age":       "86400"
  };
}

// ─── Route dispatcher ─────────────────────────────────────────────────────────

async function route(request, env, path, method) {

  // ── Health ────────────────────────────────────────────────────
  if (path === "/health" && method === "GET") {
    return json({ ok: true, storage: "r2", time: new Date().toISOString() });
  }

  // ── Auth ──────────────────────────────────────────────────────
  if (path === "/api/auth/login" && method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (body.username !== env.OWNER_USERNAME || body.password !== env.OWNER_PASSWORD) {
      return err("Invalid username or password.", 401);
    }
    const session = await issueSession(env.KV, env.OWNER_USERNAME, getTtl(env));
    return json({ token: session.token, username: session.username, expiresAt: session.expiresAt }, 201);
  }

  if (path === "/api/auth/me" && method === "GET") {
    const session = await requireAuth(request, env);
    if (!session) return err("Authentication required.", 401);
    return json({ username: session.username, expiresAt: session.expiresAt });
  }

  if (path === "/api/auth/logout" && method === "POST") {
    const token = getAuthToken(request);
    await deleteSession(env.KV, token);
    return new Response(null, { status: 204 });
  }

  // ── Folders ───────────────────────────────────────────────────
  if (path === "/api/folders" && method === "GET") {
    const session = await requireAuth(request, env);
    if (!session) return err("Authentication required.", 401);
    const [folders, meta] = await Promise.all([getFolderCatalog(env), readFolderMeta(env)]);
    const coverPhotoIds = {};
    for (const f of folders) {
      if (meta[f]?.coverPhotoId) coverPhotoIds[f] = meta[f].coverPhotoId;
    }
    return json({ folders, coverPhotoIds });
  }

  if (path === "/api/folders" && method === "POST") {
    const session = await requireAuth(request, env);
    if (!session) return err("Authentication required.", 401);
    const body = await request.json().catch(() => ({}));
    const folderName = normalizeFolderName(body.name || "");
    if (!folderName) return err("Folder name is required.");
    await ensureFolderExists(env, folderName);
    const folders = await getFolderCatalog(env);
    return json({ message: "Folder created.", folder: folderName, folders }, 201);
  }

  // /api/folders/:folder/cover
  const coverMatch = path.match(/^\/api\/folders\/([^/]+)\/cover$/);
  if (coverMatch && method === "POST") {
    const session = await requireAuth(request, env);
    if (!session) return err("Authentication required.", 401);
    const folderName = normalizeFolderName(decodeURIComponent(coverMatch[1]));
    const body       = await request.json().catch(() => ({}));
    const photoId    = typeof body.photoId === "string" ? body.photoId.trim() : "";
    if (!folderName || !photoId) return err("Folder name and photoId are required.");
    const entries = await readMetadata(env);
    const photo   = entries.find(e => e.id === photoId && (e.folder || DEFAULT_FOLDER) === folderName);
    if (!photo) return err("Photo not found in this folder.", 404);
    const meta = await readFolderMeta(env);
    meta[folderName] = { ...(meta[folderName] || {}), coverPhotoId: photoId };
    await writeFolderMeta(env, meta);
    return json({ message: "Cover photo updated.", coverPhotoId: photoId });
  }

  // ── Photos ────────────────────────────────────────────────────
  if (path === "/api/photos" && method === "GET") {
    const session = await requireAuth(request, env);
    if (!session) return err("Authentication required.", 401);
    const entries      = await readMetadata(env);
    const folderFilter = normalizeFolderName(new URL(request.url).searchParams.get("folder") || "");
    const filtered     = folderFilter ? entries.filter(e => getPhotoFolder(e) === folderFilter) : entries;
    const sorted       = [...filtered]
      .map(e => ({ ...e, folder: getPhotoFolder(e) }))
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    return json(sorted);
  }

  if (path === "/api/photos" && method === "DELETE") {
    const session = await requireAuth(request, env);
    if (!session) return err("Authentication required.", 401);
    const body     = await request.json().catch(() => ({}));
    const photoIds = Array.isArray(body.photoIds)
      ? [...new Set(body.photoIds.map(id => String(id).trim()).filter(Boolean))]
      : [];
    if (!photoIds.length) return err("Select at least one photo to delete.");
    const entries = await readMetadata(env);
    const byId    = new Map(entries.map(e => [e.id, e]));
    const targets = photoIds.map(id => byId.get(id)).filter(Boolean);
    if (!targets.length) return err("No matching photos found.", 404);
    await Promise.all(targets.map(p => env.R2.delete(getObjectKey(p))));
    const remaining = entries.filter(e => !photoIds.includes(e.id));
    await writeMetadata(env, remaining);
    return json({ message: `Deleted ${targets.length} photo(s).`, deleted: targets.length });
  }

  // /api/photos/:id/view  (owner)
  const photoViewMatch = path.match(/^\/api\/photos\/([^/]+)\/view$/);
  if (photoViewMatch && method === "GET") {
    return handleR2Proxy(request, env, photoViewMatch[1], false);
  }

  // /api/photos/:id/thumb  (owner)
  const photoThumbMatch = path.match(/^\/api\/photos\/([^/]+)\/thumb$/);
  if (photoThumbMatch && method === "GET") {
    const session = await requireAuth(request, env);
    if (!session) return err("Authentication required.", 401);
    const entries = await readMetadata(env);
    const photo   = entries.find(e => e.id === photoThumbMatch[1]);
    if (!photo) return err("Photo not found.", 404);

    if (!isImageMimeType(photo.mimeType)) {
      // video or unknown — try thumb from R2
      return handleThumbProxy(request, env, photo.id, false);
    }
    // Image: proxy through R2 directly
    return handleR2Proxy(request, env, photoThumbMatch[1], false);
  }

  // /api/photos/:id/download  (owner)
  const photoDownloadMatch = path.match(/^\/api\/photos\/([^/]+)\/download$/);
  if (photoDownloadMatch && method === "GET") {
    const session = await requireAuth(request, env);
    if (!session) return err("Authentication required.", 401);
    const entries = await readMetadata(env);
    const photo   = entries.find(e => e.id === photoDownloadMatch[1]);
    if (!photo) return err("Photo not found.", 404);
    const key    = getObjectKey(photo);
    const object = await env.R2.get(key);
    if (!object) return err("File not found in storage.", 404);
    return new Response(object.body, {
      headers: {
        "Content-Type":        photo.mimeType || "application/octet-stream",
        "Content-Disposition": makeContentDisposition("attachment", photo.originalName),
        "Content-Length":      String(object.size || "")
      }
    });
  }

  // ── Upload ────────────────────────────────────────────────────
  if (path === "/api/upload" && method === "POST") {
    return handleUpload(request, env);
  }

  // ── Share links ───────────────────────────────────────────────
  if (path === "/api/share-links" && method === "POST") {
    const session = await requireAuth(request, env);
    if (!session) return err("Authentication required.", 401);

    const body = await request.json().catch(() => ({}));
    const { photoIds, folderNames, expiresInHours } = body;

    const uniqueIds = Array.isArray(photoIds)
      ? [...new Set(photoIds.map(id => String(id).trim()).filter(Boolean))]
      : [];
    const normalizedFolders = Array.isArray(folderNames)
      ? [...new Set(folderNames.map(normalizeFolderName).filter(Boolean))]
      : [];

    const photos    = await readMetadata(env);
    const photosById = new Map(photos.map(p => [p.id, p]));
    const unknownIds = uniqueIds.filter(id => !photosById.has(id));
    if (unknownIds.length) return err("Some selected photos were not found.");

    const folderPhotoIds = photos
      .filter(p => normalizedFolders.includes(getPhotoFolder(p)))
      .map(p => p.id);
    const finalPhotoIds = [...new Set([...uniqueIds, ...folderPhotoIds])];
    if (!finalPhotoIds.length) return err("No photos found for the selected folder or selection.");

    const hours = Number(expiresInHours ?? 8760);
    if (!Number.isFinite(hours) || hours < 1 || hours > 17520) {
      return err("Expiry must be between 1 and 17520 hours (2 years).");
    }

    const now       = Date.now();
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + hours * 3600_000).toISOString();
    const token     = randomHex(24);

    const links         = await readShareLinks(env);
    const usedShortCodes = new Set(links.map(l => l.shortCode).filter(Boolean));
    const baseHint      = normalizedFolders[0] || photosById.get(finalPhotoIds[0])?.originalName || "gallery";
    let shortCode       = `${slugify(baseHint)}-${randomString(SHARE_SLUG_CHARS, 4)}`;
    if (usedShortCodes.has(shortCode)) {
      shortCode = `${slugify(baseHint)}-${randomString(SHARE_SLUG_CHARS, 6)}`;
    }

    links.push({ token, shortCode, photoIds: finalPhotoIds, folderNames: normalizedFolders, createdAt, expiresAt });
    await writeShareLinks(env, links);

    const base = getPublicBase(env);
    return json({
      token,
      shortCode,
      expiresAt,
      photoCount: finalPhotoIds.length,
      url:     `${base}/share/${shortCode}`,
      longUrl: `${base}/share/${token}`
    }, 201);
  }

  if (path === "/api/share-links" && method === "DELETE") {
    const session = await requireAuth(request, env);
    if (!session) return err("Authentication required.", 401);
    const body  = await request.json().catch(() => ({}));
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!token) return err("Token is required.");
    const links   = await readShareLinks(env);
    const updated = links.filter(l => l.token !== token);
    await writeShareLinks(env, updated);
    return json({ message: "Share link deleted." });
  }

  // ── Public share API ──────────────────────────────────────────

  // /api/share/:token
  const shareInfoMatch = path.match(/^\/api\/share\/([^/]+)$/);
  if (shareInfoMatch && method === "GET") {
    const share = await resolveShare(env, shareInfoMatch[1]);
    if (!share)           return err("Share link not found.", 404);
    if (share === "expired") return err("This share link has expired.", 410);

    const [entries, folderMeta] = await Promise.all([readMetadata(env), readFolderMeta(env)]);
    const allowed = new Set(share.photoIds);
    const base    = getPublicBase(env);

    const photos = entries
      .filter(p => allowed.has(p.id))
      .sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt))
      .map(photo => ({
        id:           photo.id,
        originalName: photo.originalName,
        folder:       getPhotoFolder(photo),
        size:         photo.size,
        mimeType:     photo.mimeType,
        uploadedAt:   photo.uploadedAt,
        viewUrl:      `${base}/api/share/${share.token}/photos/${photo.id}/view`,
        thumbUrl:     `${base}/api/share/${share.token}/photos/${photo.id}/thumb`,
        downloadUrl:  `${base}/api/share/${share.token}/photos/${photo.id}/download`
      }));

    const folders       = [...new Set(photos.map(p => p.folder))];
    const primaryFolder = folders[0] || "";
    const savedCoverId  = folderMeta[primaryFolder]?.coverPhotoId;
    const coverPhotoId  = (savedCoverId && allowed.has(savedCoverId))
      ? savedCoverId
      : (photos.find(p => p.mimeType?.startsWith("image/"))?.id || null);

    return json({ createdAt: share.createdAt, expiresAt: share.expiresAt, photoCount: photos.length, folders, coverPhotoId, photos });
  }

  // /api/share/:token/photos/:photoId/view
  const shareViewMatch = path.match(/^\/api\/share\/([^/]+)\/photos\/([^/]+)\/view$/);
  if (shareViewMatch && method === "GET") {
    const share = await resolveShare(env, shareViewMatch[1]);
    if (!share)           return err("Share link not found.", 404);
    if (share === "expired") return err("This share link has expired.", 410);
    if (!share.photoIds.includes(shareViewMatch[2])) return err("Photo not in share.", 403);

    // Proxy directly (public, no auth — the share token IS the auth)
    const entries = await readMetadata(env);
    const photo   = entries.find(e => e.id === shareViewMatch[2]);
    if (!photo) return err("Photo not found.", 404);
    const key    = getObjectKey(photo);
    const object = await env.R2.get(key);
    if (!object) return err("File not found in storage.", 404);

    const headers = new Headers({
      "Content-Type":   photo.mimeType || "application/octet-stream",
      "Accept-Ranges":  "bytes",
      "Cache-Control":  "private, max-age=300"
    });
    if (object.size) headers.set("Content-Length", String(object.size));
    return new Response(object.body, { headers });
  }

  // /api/share/:token/photos/:photoId/thumb
  const shareThumbMatch = path.match(/^\/api\/share\/([^/]+)\/photos\/([^/]+)\/thumb$/);
  if (shareThumbMatch && method === "GET") {
    const share = await resolveShare(env, shareThumbMatch[1]);
    if (!share)           return err("Share link not found.", 404);
    if (share === "expired") return err("This share link has expired.", 410);
    if (!share.photoIds.includes(shareThumbMatch[2])) return err("Photo not in share.", 403);

    const entries = await readMetadata(env);
    const photo   = entries.find(e => e.id === shareThumbMatch[2]);
    if (!photo) return err("Photo not found.", 404);

    // Try dedicated thumb first
    const thumbKey = `thumbs/${photo.id}.jpg`;
    const thumb    = await env.R2.get(thumbKey);
    if (thumb) {
      return new Response(thumb.body, {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" }
      });
    }

    // For images: serve the full object (browser will scale it)
    if (isImageMimeType(photo.mimeType)) {
      const key    = getObjectKey(photo);
      const object = await env.R2.get(key);
      if (object) {
        return new Response(object.body, {
          headers: { "Content-Type": photo.mimeType, "Cache-Control": "public, max-age=3600" }
        });
      }
    }

    // Fallback
    return Response.redirect(`${getPublicBase(env)}/video-fallback.jpg`, 302);
  }

  // /api/share/:token/photos/:photoId/download
  const shareDownloadMatch = path.match(/^\/api\/share\/([^/]+)\/photos\/([^/]+)\/download$/);
  if (shareDownloadMatch && method === "GET") {
    const share = await resolveShare(env, shareDownloadMatch[1]);
    if (!share)           return err("Share link not found.", 404);
    if (share === "expired") return err("This share link has expired.", 410);
    if (!share.photoIds.includes(shareDownloadMatch[2])) return err("Photo not in share.", 403);

    const entries = await readMetadata(env);
    const photo   = entries.find(e => e.id === shareDownloadMatch[2]);
    if (!photo) return err("Photo not found.", 404);
    const key    = getObjectKey(photo);
    const object = await env.R2.get(key);
    if (!object) return err("File not found in storage.", 404);
    return new Response(object.body, {
      headers: {
        "Content-Type":        photo.mimeType || "application/octet-stream",
        "Content-Disposition": makeContentDisposition("attachment", photo.originalName),
        "Content-Length":      String(object.size || "")
      }
    });
  }

  // ── Internal R2 proxy (for owner auth'd requests) ─────────────
  const proxyMatch = path.match(/^\/internal\/r2-proxy\/([^/]+)$/);
  if (proxyMatch && method === "GET") {
    return handleR2Proxy(request, env, decodeURIComponent(proxyMatch[1]), false);
  }

  return err("Not found.", 404);
}
