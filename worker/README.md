# DRKPRTY content Worker

This Worker is the private bridge between the Firebase-authenticated admin panel and the GitHub `content` repository.

## Required Worker variables

- `GITHUB_OWNER`: GitHub account or organization that owns the repository.
- `GITHUB_REPO`: `content`
- `GITHUB_BRANCH`: normally `main`
- `CONTENT_ROOT`: normally `drkprty/works`
- `FIREBASE_WEB_API_KEY`: the Firebase Web API key for `drkprtyart`
- `ALLOWED_ORIGINS`: comma-separated public/admin site origins. Example: `https://art.drkprty.uk,https://username.github.io`
- `ADMIN_EMAILS`: comma-separated Firebase Auth emails allowed to upload/delete.

## Required secret

- `GITHUB_TOKEN`: a fine-grained GitHub personal access token with **Contents: Read and write** permission restricted to the `content` repository.

Never put `GITHUB_TOKEN` in the website repository.

## Endpoints

- `GET /health`
- `GET /asset/<content path>` (public image delivery; works even when the GitHub repository is private)
- `POST /upload?workId=...&filename=...` (Firebase-authenticated)
- `DELETE /file?path=...` (Firebase-authenticated)

After deployment, put the Worker URL in `/js/content-api-config.js`.
