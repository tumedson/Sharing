# Client Photo Share

A simple website to upload photos and let clients download the exact original files.

## Features

- Upload multiple photos at once
- Keeps original image quality (no resizing or compression)
- Client gallery with previews
- One-click download of original files with original filename
- Optional cloud storage using Amazon S3 (or S3-compatible providers)
- Expiring private share links for selected photos

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Start the app:

```bash
npm run dev
```

3. Open:

- http://localhost:3000

## Notes

- Uploaded files are stored in `uploads/`.
- Metadata is stored in `uploads/metadata.json`.
- Share links are stored in `uploads/share-links.json`.
- Upload size/count are not capped by app code; only server resources and proxy settings apply.

## Owner Login Protection

The dashboard is now protected.

- Only the owner can upload photos and create share links.
- Client share links (`/share/:token`) remain public until expiry.

Set owner credentials with environment variables:

- `OWNER_USERNAME=your-username`
- `OWNER_PASSWORD=your-strong-password`
- `AUTH_SESSION_TTL_HOURS=24` (optional, default: 24)

## Cloud Storage (Option 2)

By default, the app uses local storage.

To enable S3 storage, set:

- `STORAGE_PROVIDER=s3`
- `S3_BUCKET=your-bucket-name`
- `AWS_REGION=your-region` (example: `us-east-1`)

Optional for S3-compatible services:

- `S3_ENDPOINT=https://your-endpoint`
- `S3_FORCE_PATH_STYLE=true`
- `AWS_ACCESS_KEY_ID=your-access-key`
- `AWS_SECRET_ACCESS_KEY=your-secret-key`

Example:

```bash
STORAGE_PROVIDER=s3 \
S3_BUCKET=my-photo-bucket \
AWS_REGION=us-east-1 \
OWNER_USERNAME=studioowner \
OWNER_PASSWORD=replace-this-password \
npm run dev
```

## Expiring Share Links (Option 3)

1. Select photos in the gallery.
2. Choose expiry in hours (1 to 168).
3. Click "Create Link from Selected".
4. Send the generated link to your client.

Clients can only access selected photos until the link expires.

## Deploy Online (Render)

This project is ready for Render using the included [render.yaml](render.yaml).

Important:

- Use S3 in production so your original files are not lost during restarts.
- Set strong owner credentials.

### 1) Push this project to GitHub

Render deploys from your GitHub repository.

### 2) Create the Render service

1. Open Render dashboard.
2. Click New and choose Blueprint.
3. Select your GitHub repo.
4. Render will read [render.yaml](render.yaml) and create the service.

### 3) Set environment variables in Render

Required:

- OWNER_USERNAME
- OWNER_PASSWORD
- STORAGE_PROVIDER=s3
- S3_BUCKET
- AWS_REGION
- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY

Optional:

- S3_ENDPOINT
- S3_FORCE_PATH_STYLE=true
- AUTH_SESSION_TTL_HOURS=24

### 4) Deploy and open your live URL

- After deploy, visit the URL Render gives you.
- Health endpoint: [server.js](server.js#L287) serves /health.

### 5) First login

- Sign in with your OWNER_USERNAME and OWNER_PASSWORD.
- Upload photos and generate expiring client links.
