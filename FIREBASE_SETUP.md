# Firebase setup

## Project

- Firebase project: `sachinelearn-academy` (Sachinelearn Academy), on the Spark plan.
- Authentication: email/password is enabled.
- Firestore: production mode, `asia-southeast1` (Singapore).
- Firebase Storage is not enabled. Do not upgrade to Blaze without approval.
- The site is currently published on GitHub Pages; Firebase Hosting is not configured.
- The client configuration is in `firebase-config.js`. It identifies the web app and is not an Admin SDK credential. Restrict its API key to the deployed web domains in Google Cloud Console.

## Current connection status

The local website now uses Firebase Authentication and Cloud Firestore for accounts, classes, materials, and live-class schedules. Student and teacher passwords are managed by Firebase Authentication and are not written to Firestore. Student FEMIS IDs and teacher TPF numbers are mapped to generated Firebase email addresses internally; users still sign in with their name, ID, and password.

The connection is **not ready for real users yet**:

- The Firestore rules have been published from the Firebase Console. All five composite indexes listed in `firestore.indexes.json` are enabled.
- An administrator Firebase Auth account and trusted Firestore admin profile have not been created.
- The Firebase-integrated site changes have not been published to GitHub Pages.
- Existing localStorage accounts and records were not migrated.
- File uploads remain in browser IndexedDB. They are only available in the browser that uploaded them.

## Finish the Firebase connection

1. The indexes have been created in **Firestore Database → Indexes → Manual** and were verified as enabled:
   - `users`: `classId` ascending, `role` ascending.
   - `materials`: `classId`, `subjectId`, and `availableAt` ascending.
   - `materials`: `classId` and `teacherUid` ascending.
   - `liveClasses`: `classId` and `subjectId` ascending.
   - `liveClasses`: `classId` and `teacherUid` ascending.

   If deploying from a machine or Cloud Shell folder containing this project instead, the equivalent command is:

   ```sh
   firebase deploy --only firestore:rules,firestore:indexes --project sachinelearn-academy
   ```

   The published rules match `firestore.rules`. Do not create a permissive temporary rule to make the app work.

2. Create the administrator login in Firebase Console under **Authentication → Users → Add user**. Use an admin email and a strong password; the old `1234` password is not used.

3. In **Firestore Database → Data**, create `users/{ADMIN_UID}` using the UID shown for that Authentication user. The document must contain at least:

   ```json
   {
     "role": "admin",
     "name": "Academy Administrator",
     "disabled": false
   }
   ```

   This initial profile must be created by a trusted administrator in the console. The public website must not allow users to grant themselves admin privileges.

4. Add the actual GitHub Pages hostname (currently expected to be `sachpsd.github.io`) to **Authentication → Settings → Authorized domains**. Restrict the Firebase Web API key to the production site domain and any explicitly needed local development domains.

5. Publish the Firebase-integrated website files to GitHub Pages. Then verify admin login, class and subject setup, teacher/student provisioning, password changes, membership-based access, scheduled release times, and live-class visibility before onboarding students.

## Data and upload limitations

- Firebase Authentication credentials are not stored in Firestore.
- No migration of accounts or other data from browser localStorage has been performed. Existing local accounts/passwords will not work with Firebase.
- Uploaded textbooks, past papers, and other attachments remain local to the uploading browser. Cross-device file downloads require Firebase Storage, which requires a separately approved billing-plan change.
- Live classes use Jitsi Meet. Camera and microphone access require HTTPS; anyone with a room link may be able to join.
