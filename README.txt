DRKPRTY ART — Firebase + GitHub Content build v13

Firebase project: drkprtyart

Architecture
- GitHub Pages: static HTML/CSS/JS
- Firebase Authentication: panel login (Email/Password)
- Cloud Firestore: site text + artwork metadata
- GitHub repository `content`: artwork image files
- Cloudflare Worker: secure bridge for upload/delete and public image delivery
- Firebase Storage: NOT USED

Firebase setup
1. Authentication > Sign-in method: Email/Password enabled.
2. Authentication > Users: admin user created.
3. Firestore Database: create/enable the database.
4. Publish firestore.rules in Firestore > Rules.
5. Authentication > Settings > Authorized domains: add the production domain / GitHub Pages hostname if needed.

Public website reads Firestore:
- siteContent/main
- works/* ordered by `order`

Each work stores an `image` URL returned by the Worker and a private-management `contentPath` pointing to its file in the GitHub content repository.

Panel path:
/panel/

GitHub image upload setup
1. Deploy /worker/index.js as a Cloudflare Worker.
2. Configure Worker variables described in /worker/README.md.
3. Store the GitHub fine-grained PAT as Worker secret GITHUB_TOKEN.
4. Give the token Contents: Read and write access only to the `content` repo.
5. Put the deployed Worker URL in /js/content-api-config.js.

The GitHub token is never included in the public website.
The Worker verifies the Firebase ID token before allowing uploads/deletes.
The Worker also serves /asset/... publicly, so the GitHub `content` repo can remain private.

V13 changes
- Removed Firebase Storage completely.
- Artwork uploads now go to GitHub `content` through the Cloudflare Worker.
- Replacing/deleting an artwork also removes the old GitHub file.
- Firestore continues to store metadata and image URLs.
