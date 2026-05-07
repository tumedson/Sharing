const express = require("express");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const sharp = require("sharp");
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const app = express();
const port = process.env.PORT || 3000;
const STORAGE_PROVIDER = (process.env.STORAGE_PROVIDER || "local").toLowerCase();
const USE_S3 = STORAGE_PROVIDER === "s3";
const OWNER_USERNAME = process.env.OWNER_USERNAME || "eli";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || "password";
const AUTH_SESSION_TTL_HOURS = Number(process.env.AUTH_SESSION_TTL_HOURS || 24);
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/+$/g, "");

const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.AWS_REGION;
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE === "true";

const UPLOAD_DIR = path.join(__dirname, "uploads");
const TEMP_UPLOAD_DIR = path.join(UPLOAD_DIR, "tmp");
const THUMB_DIR = path.join(UPLOAD_DIR, "thumbs");
const METADATA_FILE = path.join(UPLOAD_DIR, "metadata.json");
const SHARE_LINKS_FILE = path.join(UPLOAD_DIR, "share-links.json");
const FOLDERS_FILE = path.join(UPLOAD_DIR, "folders.json");
const ownerSessions = new Map();
const DEFAULT_FOLDER = "General";
const SHARE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const SHARE_SLUG_SUFFIX_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";
const THUMB_VERSION = "v2";
const THUMB_MAX_SIZE = 720;
const THUMB_QUALITY = 68;

let s3Client = null;

if (USE_S3) {
  if (!S3_BUCKET || !S3_REGION) {
    console.error("Missing S3_BUCKET or AWS_REGION for S3 mode.");
    process.exit(1);
  }

  const clientConfig = {
    region: S3_REGION,
    forcePathStyle: S3_FORCE_PATH_STYLE
  };

  if (S3_ENDPOINT) {
    clientConfig.endpoint = S3_ENDPOINT;
  }

  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    clientConfig.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    };
  }

  s3Client = new S3Client(clientConfig);
}

function sanitizeFileName(fileName) {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizeFolderName(input) {
  if (typeof input !== "string") return "";

  const cleaned = input
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);

  if (!cleaned || cleaned === "." || cleaned === "..") {
    return "";
  }

  return cleaned;
}

function getPhotoFolder(photo) {
  return normalizeFolderName(photo.folder) || DEFAULT_FOLDER;
}

function getAuthToken(req) {
  const header = req.get("authorization") || "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }

  if (typeof req.query.auth === "string") {
    return req.query.auth.trim();
  }

  return "";
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of ownerSessions.entries()) {
    if (new Date(session.expiresAt).getTime() <= now) {
      ownerSessions.delete(token);
    }
  }
}

function issueOwnerSession() {
  cleanupExpiredSessions();

  const token = crypto.randomBytes(32).toString("hex");
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

  ownerSessions.set(token, {
    createdAt,
    expiresAt,
    username: OWNER_USERNAME
  });

  return {
    token,
    createdAt,
    expiresAt
  };
}

function resolveSession(token) {
  if (!token) return null;

  cleanupExpiredSessions();
  const session = ownerSessions.get(token);
  if (!session) return null;

  return {
    token,
    ...session
  };
}

function requireOwnerAuth(req, res, next) {
  const token = getAuthToken(req);
  const session = resolveSession(token);

  if (!session) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }

  req.ownerSession = session;
  next();
}

function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isS3Photo(photo) {
  if (!photo) return false;
  if (photo.storageType) return photo.storageType === "s3";
  return Boolean(photo.objectKey);
}

function getLocalStoredName(photo) {
  return photo.storedName || photo.objectKey;
}

function getS3ObjectKey(photo) {
  return photo.objectKey || photo.storedName;
}

function makeContentDisposition(dispositionType, originalName) {
  const safeName = sanitizeFileName(originalName || "photo");
  return `${dispositionType}; filename="${safeName}"`;
}

function buildPublicShareUrl(req, token) {
  return `${resolvePublicBaseUrl(req)}/share/${token}`;
}

function buildShortShareUrl(req, shortCode) {
  return `${resolvePublicBaseUrl(req)}/s/${shortCode}`;
}

function resolvePublicBaseUrl(req) {
  if (PUBLIC_BASE_URL) {
    return PUBLIC_BASE_URL;
  }

  const hostHeader = String(req.get("host") || "").trim();
  if (!hostHeader) {
    return `${req.protocol}://localhost:${port}`;
  }

  const [hostname, portPart] = hostHeader.split(":");
  const isIpv4Host = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname);

  if (isIpv4Host) {
    const nipHost = `${hostname.replace(/\./g, "-")}.nip.io`;
    const withPort = portPart ? `${nipHost}:${portPart}` : nipHost;
    return `${req.protocol}://${withPort}`;
  }

  return `${req.protocol}://${hostHeader}`;
}

function generateShareCode(length = 10) {
  let code = "";
  const bytes = crypto.randomBytes(length);

  for (let i = 0; i < length; i += 1) {
    code += SHARE_CODE_CHARS[bytes[i] % SHARE_CODE_CHARS.length];
  }

  return code;
}

function slugifyShareLabel(input) {
  const value = String(input || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  const trimmed = value.slice(0, 26).replace(/-+$/g, "");
  return trimmed || "gallery";
}

function makeRandomSuffix(length = 4) {
  let suffix = "";
  const bytes = crypto.randomBytes(length);

  for (let i = 0; i < length; i += 1) {
    suffix += SHARE_SLUG_SUFFIX_CHARS[bytes[i] % SHARE_SLUG_SUFFIX_CHARS.length];
  }

  return suffix;
}

function generateReadableShareCode(baseHint, usedCodes) {
  const base = slugifyShareLabel(baseHint);

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = `${base}-${makeRandomSuffix(4)}`;
    if (!usedCodes.has(candidate)) {
      return candidate;
    }
  }

  return `${base}-${makeRandomSuffix(6)}`;
}

function isShareExpired(shareLink) {
  return Date.now() > new Date(shareLink.expiresAt).getTime();
}

async function readJsonArray(filePath) {
  try {
    const data = await fsp.readFile(filePath, "utf8");
    const parsed = JSON.parse(data);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function ensureStorageFiles() {
  await fsp.mkdir(UPLOAD_DIR, { recursive: true });
  await fsp.mkdir(TEMP_UPLOAD_DIR, { recursive: true });
  await fsp.mkdir(THUMB_DIR, { recursive: true });

  if (!fs.existsSync(METADATA_FILE)) {
    await fsp.writeFile(METADATA_FILE, "[]", "utf8");
  }

  if (!fs.existsSync(SHARE_LINKS_FILE)) {
    await fsp.writeFile(SHARE_LINKS_FILE, "[]", "utf8");
  }

  if (!fs.existsSync(FOLDERS_FILE)) {
    await fsp.writeFile(FOLDERS_FILE, JSON.stringify([DEFAULT_FOLDER], null, 2), "utf8");
  }
}

function isImageMimeType(mimeType) {
  return typeof mimeType === "string" && mimeType.startsWith("image/");
}

function isVideoMimeType(mimeType) {
  return typeof mimeType === "string" && mimeType.startsWith("video/");
}

function getThumbPath(photoId) {
  return path.join(THUMB_DIR, `${photoId}-${THUMB_VERSION}.jpg`);
}

async function ensureLocalThumb(photo) {
  if (!photo || !photo.id || !isImageMimeType(photo.mimeType) || isS3Photo(photo)) {
    return null;
  }

  const sourcePath = path.join(UPLOAD_DIR, getLocalStoredName(photo));
  const thumbPath = getThumbPath(photo.id);

  const [sourceStat, thumbStat] = await Promise.all([
    fsp.stat(sourcePath).catch(() => null),
    fsp.stat(thumbPath).catch(() => null)
  ]);

  if (!sourceStat) {
    return null;
  }

  const thumbOutdated = !thumbStat || thumbStat.mtimeMs < sourceStat.mtimeMs;
  if (thumbOutdated) {
    await sharp(sourcePath)
      .rotate()
      .resize({
        width: THUMB_MAX_SIZE,
        height: THUMB_MAX_SIZE,
        fit: "inside",
        withoutEnlargement: true
      })
      .jpeg({ quality: THUMB_QUALITY, mozjpeg: true })
      .toFile(thumbPath);
  }

  return thumbPath;
}

async function readMetadata() {
  return readJsonArray(METADATA_FILE);
}

async function writeMetadata(entries) {
  await fsp.writeFile(METADATA_FILE, JSON.stringify(entries, null, 2), "utf8");
}

async function readShareLinks() {
  return readJsonArray(SHARE_LINKS_FILE);
}

async function writeShareLinks(links) {
  await fsp.writeFile(SHARE_LINKS_FILE, JSON.stringify(links, null, 2), "utf8");
}

async function readFolders() {
  const folders = await readJsonArray(FOLDERS_FILE);
  const normalized = folders.map(normalizeFolderName).filter(Boolean);
  const deduped = [...new Set([DEFAULT_FOLDER, ...normalized])];
  return deduped;
}

async function writeFolders(folders) {
  const normalized = folders.map(normalizeFolderName).filter(Boolean);
  const deduped = [...new Set([DEFAULT_FOLDER, ...normalized])];
  await fsp.writeFile(FOLDERS_FILE, JSON.stringify(deduped, null, 2), "utf8");
}

async function getFolderCatalog() {
  const [savedFolders, entries] = await Promise.all([readFolders(), readMetadata()]);
  const fromPhotos = entries.map((entry) => getPhotoFolder(entry));
  return [...new Set([DEFAULT_FOLDER, ...savedFolders, ...fromPhotos])].sort((a, b) => a.localeCompare(b));
}

async function ensureFolderExists(folderName) {
  const normalized = normalizeFolderName(folderName) || DEFAULT_FOLDER;
  const folders = await readFolders();
  if (!folders.includes(normalized)) {
    folders.push(normalized);
    await writeFolders(folders);
  }
  return normalized;
}

async function resolveShare(identifier) {
  const links = await readShareLinks();
  const share = links.find((item) => item.token === identifier || item.shortCode === identifier);

  if (!share) {
    throw createHttpError(404, "Share link not found.");
  }

  if (isShareExpired(share)) {
    throw createHttpError(410, "This share link has expired.");
  }

  return share;
}

async function createS3AccessUrl(photo, dispositionType, expiresInSeconds = 300) {
  const key = getS3ObjectKey(photo);

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ResponseContentType: photo.mimeType,
    ResponseContentDisposition: makeContentDisposition(dispositionType, photo.originalName)
  });

  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

async function persistUploadedFile(file) {
  if (!USE_S3) {
    return {
      storageType: "local",
      storedName: file.filename,
      objectKey: null
    };
  }

  const key = `photos/${file.filename}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: fs.createReadStream(file.path),
      ContentType: file.mimetype
    })
  );

  await fsp.unlink(file.path).catch(() => {});

  return {
    storageType: "s3",
    storedName: key,
    objectKey: key
  };
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, USE_S3 ? TEMP_UPLOAD_DIR : UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const safeOriginal = sanitizeFileName(file.originalname);
    cb(null, `${unique}--${safeOriginal}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    cb(null, true);
  }
});

app.use(express.json());
app.use((req, res, next) => {
  const noCachePaths = ["/", "/script.js", "/share.js", "/styles.css"];
  if (noCachePaths.includes(req.path) || req.path.startsWith("/share/")) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
  }
  next();
});
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    storage: USE_S3 ? "s3" : "local",
    time: new Date().toISOString()
  });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body || {};

  if (username !== OWNER_USERNAME || password !== OWNER_PASSWORD) {
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }

  const session = issueOwnerSession();
  res.status(201).json({
    token: session.token,
    username: OWNER_USERNAME,
    expiresAt: session.expiresAt
  });
});

app.get("/api/auth/me", requireOwnerAuth, (req, res) => {
  res.json({
    username: req.ownerSession.username,
    expiresAt: req.ownerSession.expiresAt
  });
});

app.post("/api/auth/logout", requireOwnerAuth, (req, res) => {
  ownerSessions.delete(req.ownerSession.token);
  res.status(204).send();
});

app.get("/api/photos", requireOwnerAuth, async (_req, res, next) => {
  try {
    const entries = await readMetadata();
    const folderFilter = normalizeFolderName(_req.query.folder || "") || "";

    const filtered = folderFilter
      ? entries.filter((entry) => getPhotoFolder(entry) === folderFilter)
      : entries;

    const sorted = [...filtered]
      .map((entry) => ({
        ...entry,
        folder: getPhotoFolder(entry)
      }))
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

    res.json(sorted);
  } catch (error) {
    next(error);
  }
});

app.get("/api/folders", requireOwnerAuth, async (_req, res, next) => {
  try {
    const folders = await getFolderCatalog();
    res.json({ folders });
  } catch (error) {
    next(error);
  }
});

app.post("/api/folders", requireOwnerAuth, async (req, res, next) => {
  try {
    const folderName = normalizeFolderName(req.body?.name || "");
    if (!folderName) {
      res.status(400).json({ error: "Folder name is required." });
      return;
    }

    await ensureFolderExists(folderName);
    const folders = await getFolderCatalog();
    res.status(201).json({
      message: "Folder created.",
      folder: folderName,
      folders
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/upload", requireOwnerAuth, upload.array("photos"), async (req, res, next) => {
  try {
    const uploadedFiles = req.files || [];

    if (!uploadedFiles.length) {
      res.status(400).json({ error: "No files uploaded." });
      return;
    }

    const folder = await ensureFolderExists(req.body?.folder || DEFAULT_FOLDER);
    const entries = await readMetadata();

    const newEntries = [];

    for (const file of uploadedFiles) {
      const persistedFile = await persistUploadedFile(file);

      newEntries.push({
        id: crypto.randomUUID(),
        storedName: persistedFile.storedName,
        objectKey: persistedFile.objectKey,
        storageType: persistedFile.storageType,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        folder,
        uploadedAt: new Date().toISOString()
      });
    }

    const updatedEntries = [...entries, ...newEntries];
    await writeMetadata(updatedEntries);

    res.status(201).json({
      message: "Upload successful.",
      items: newEntries
    });
  } catch (error) {
    if (USE_S3 && Array.isArray(req.files)) {
      const cleanupTasks = req.files
        .map((file) => file && file.path)
        .filter(Boolean)
        .map((filePath) => fsp.unlink(filePath).catch(() => {}));

      await Promise.all(cleanupTasks);
    }

    next(error);
  }
});

app.delete("/api/photos", requireOwnerAuth, async (req, res, next) => {
  try {
    const photoIds = Array.isArray(req.body?.photoIds)
      ? [...new Set(req.body.photoIds.map((id) => String(id).trim()).filter(Boolean))]
      : [];

    if (!photoIds.length) {
      res.status(400).json({ error: "Select at least one photo to delete." });
      return;
    }

    const entries = await readMetadata();
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const targets = photoIds.map((id) => byId.get(id)).filter(Boolean);

    if (!targets.length) {
      res.status(404).json({ error: "No matching photos found." });
      return;
    }

    for (const photo of targets) {
      if (isS3Photo(photo)) {
        const key = getS3ObjectKey(photo);
        await s3Client.send(
          new DeleteObjectCommand({
            Bucket: S3_BUCKET,
            Key: key
          })
        );
      } else {
        const filePath = path.join(UPLOAD_DIR, getLocalStoredName(photo));
        await fsp.unlink(filePath).catch(() => {});
      }
    }

    const remaining = entries.filter((entry) => !photoIds.includes(entry.id));
    await writeMetadata(remaining);

    res.json({
      message: `Deleted ${targets.length} photo(s).`,
      deleted: targets.length
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/photos/:id/view", requireOwnerAuth, async (req, res, next) => {
  try {
    const entries = await readMetadata();
    const photo = entries.find((entry) => entry.id === req.params.id);

    if (!photo) {
      res.status(404).json({ error: "Photo not found." });
      return;
    }

    if (isS3Photo(photo)) {
      const signedUrl = await createS3AccessUrl(photo, "inline");
      res.redirect(signedUrl);
      return;
    }

    const filePath = path.join(UPLOAD_DIR, getLocalStoredName(photo));

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "File missing on server." });
      return;
    }

    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
});

app.get("/api/photos/:id/thumb", requireOwnerAuth, async (req, res, next) => {
  try {
    const entries = await readMetadata();
    const photo = entries.find((entry) => entry.id === req.params.id);

    if (!photo) {
      res.status(404).json({ error: "Photo not found." });
      return;
    }

    if (!isImageMimeType(photo.mimeType)) {
      res.status(415).json({ error: "Thumbnail not available for this file type." });
      return;
    }

    if (isS3Photo(photo)) {
      const signedUrl = await createS3AccessUrl(photo, "inline", 300);
      res.redirect(signedUrl);
      return;
    }

    const thumbPath = await ensureLocalThumb(photo);
    if (!thumbPath) {
      res.status(404).json({ error: "Thumbnail unavailable." });
      return;
    }

    res.set("Cache-Control", "public, max-age=86400");
    res.sendFile(thumbPath);
  } catch (error) {
    next(error);
  }
});

app.get("/api/photos/:id/download", requireOwnerAuth, async (req, res, next) => {
  try {
    const entries = await readMetadata();
    const photo = entries.find((entry) => entry.id === req.params.id);

    if (!photo) {
      res.status(404).json({ error: "Photo not found." });
      return;
    }

    if (isS3Photo(photo)) {
      const signedUrl = await createS3AccessUrl(photo, "attachment");
      res.redirect(signedUrl);
      return;
    }

    const filePath = path.join(UPLOAD_DIR, getLocalStoredName(photo));

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "File missing on server." });
      return;
    }

    res.download(filePath, photo.originalName);
  } catch (error) {
    next(error);
  }
});

app.post("/api/share-links", requireOwnerAuth, async (req, res, next) => {
  try {
    const { photoIds, folderNames, expiresInHours } = req.body || {};

    const uniqueIds = Array.isArray(photoIds)
      ? [...new Set(photoIds.map((id) => String(id).trim()).filter(Boolean))]
      : [];
    const normalizedFolders = Array.isArray(folderNames)
      ? [...new Set(folderNames.map(normalizeFolderName).filter(Boolean))]
      : [];

    const photos = await readMetadata();
    const photosById = new Map(photos.map((photo) => [photo.id, photo]));
    const unknownIds = uniqueIds.filter((id) => !photosById.has(id));

    if (unknownIds.length) {
      res.status(400).json({ error: "Some selected photos were not found." });
      return;
    }

    const folderPhotoIds = photos
      .filter((photo) => normalizedFolders.includes(getPhotoFolder(photo)))
      .map((photo) => photo.id);

    const finalPhotoIds = [...new Set([...uniqueIds, ...folderPhotoIds])];

    if (!finalPhotoIds.length) {
      res.status(400).json({ error: "No photos found for the selected folder or selection." });
      return;
    }

    const hours = Number(expiresInHours ?? 72);
    if (!Number.isFinite(hours) || hours < 1 || hours > 8760) {
      res.status(400).json({ error: "Expiry must be between 1 and 8760 hours." });
      return;
    }

    const now = Date.now();
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + hours * 60 * 60 * 1000).toISOString();
    const token = crypto.randomBytes(24).toString("hex");

    const links = await readShareLinks();
    const usedShortCodes = new Set(links.map((item) => item.shortCode).filter(Boolean));
    const baseHint =
      normalizedFolders[0] ||
      photosById.get(finalPhotoIds[0])?.originalName ||
      "gallery";
    let shortCode = generateReadableShareCode(baseHint, usedShortCodes);

    if (usedShortCodes.has(shortCode)) {
      shortCode = `${slugifyShareLabel(baseHint)}-${generateShareCode(6).toLowerCase()}`;
    }

    links.push({
      token,
      shortCode,
      photoIds: finalPhotoIds,
      folderNames: normalizedFolders,
      createdAt,
      expiresAt
    });
    await writeShareLinks(links);

    res.status(201).json({
      token,
      shortCode,
      expiresAt,
      photoCount: finalPhotoIds.length,
      url: buildShortShareUrl(req, shortCode),
      longUrl: buildPublicShareUrl(req, token)
    });
  } catch (error) {
    next(error);
  }
});

app.get("/s/:code", (req, res) => {
  res.redirect(302, `/share/${encodeURIComponent(req.params.code)}`);
});

app.get("/share/:token", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "share.html"));
});

app.get("/api/share/:token", async (req, res, next) => {
  try {
    const share = await resolveShare(req.params.token);
    const entries = await readMetadata();
    const allowed = new Set(share.photoIds);

    const photos = entries
      .filter((photo) => allowed.has(photo.id))
      .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
      .map((photo) => ({
        id: photo.id,
        originalName: photo.originalName,
        folder: getPhotoFolder(photo),
        size: photo.size,
        mimeType: photo.mimeType,
        uploadedAt: photo.uploadedAt,
        viewUrl: `/api/share/${share.token}/photos/${photo.id}/view`,
        thumbUrl: `/api/share/${share.token}/photos/${photo.id}/thumb`,
        downloadUrl: `/api/share/${share.token}/photos/${photo.id}/download`
      }));

    res.json({
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      photoCount: photos.length,
      folders: [...new Set(photos.map((photo) => photo.folder))],
      photos
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/share/:token/photos/:photoId/view", async (req, res, next) => {
  try {
    const share = await resolveShare(req.params.token);

    if (!share.photoIds.includes(req.params.photoId)) {
      throw createHttpError(403, "This photo is not included in the share link.");
    }

    const entries = await readMetadata();
    const photo = entries.find((entry) => entry.id === req.params.photoId);

    if (!photo) {
      throw createHttpError(404, "Photo not found.");
    }

    if (isS3Photo(photo)) {
      const signedUrl = await createS3AccessUrl(photo, "inline", 120);
      res.redirect(signedUrl);
      return;
    }

    const filePath = path.join(UPLOAD_DIR, getLocalStoredName(photo));

    if (!fs.existsSync(filePath)) {
      throw createHttpError(404, "File missing on server.");
    }

    if (isVideoMimeType(photo.mimeType)) {
      const stat = await fsp.stat(filePath);
      const fileSize = stat.size;
      const rangeHeader = req.headers.range;

      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;
        const fileStream = fs.createReadStream(filePath, { start, end });

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": photo.mimeType
        });
        fileStream.pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": photo.mimeType,
          "Accept-Ranges": "bytes"
        });
        fs.createReadStream(filePath).pipe(res);
      }
      return;
    }

    res.sendFile(filePath);
  } catch (error) {
    next(error);
  }
});

app.get("/api/share/:token/photos/:photoId/download", async (req, res, next) => {
  try {
    const share = await resolveShare(req.params.token);

    if (!share.photoIds.includes(req.params.photoId)) {
      throw createHttpError(403, "This photo is not included in the share link.");
    }

    const entries = await readMetadata();
    const photo = entries.find((entry) => entry.id === req.params.photoId);

    if (!photo) {
      throw createHttpError(404, "Photo not found.");
    }

    if (isS3Photo(photo)) {
      const signedUrl = await createS3AccessUrl(photo, "attachment", 120);
      res.redirect(signedUrl);
      return;
    }

    const filePath = path.join(UPLOAD_DIR, getLocalStoredName(photo));

    if (!fs.existsSync(filePath)) {
      throw createHttpError(404, "File missing on server.");
    }

    res.download(filePath, photo.originalName);
  } catch (error) {
    next(error);
  }
});

app.get("/api/share/:token/photos/:photoId/thumb", async (req, res, next) => {
  try {
    const share = await resolveShare(req.params.token);

    if (!share.photoIds.includes(req.params.photoId)) {
      throw createHttpError(403, "This photo is not included in the share link.");
    }

    const entries = await readMetadata();
    const photo = entries.find((entry) => entry.id === req.params.photoId);

    if (!photo) {
      throw createHttpError(404, "Photo not found.");
    }

    if (!isImageMimeType(photo.mimeType)) {
      throw createHttpError(415, "Thumbnail not available for this file type.");
    }

    if (isS3Photo(photo)) {
      const signedUrl = await createS3AccessUrl(photo, "inline", 300);
      res.redirect(signedUrl);
      return;
    }

    const thumbPath = await ensureLocalThumb(photo);
    if (!thumbPath) {
      throw createHttpError(404, "Thumbnail unavailable.");
    }

    res.set("Cache-Control", "public, max-age=86400");
    res.sendFile(thumbPath);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ error: error.message });
    return;
  }

  if (error.status) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  console.error(error);
  res.status(500).json({ error: "Unexpected server error." });
});

ensureStorageFiles()
  .then(() => {
    app.listen(port, () => {
      console.log(`Photo sharing app running at http://localhost:${port}`);
      console.log(`Storage provider: ${USE_S3 ? "s3" : "local"}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize storage:", error);
    process.exit(1);
  });
