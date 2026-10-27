# Firebase setup

## Project

- Firebase project: `sachinelearn-academy` (Sachinelearn Academy), on the Spark plan.
- Authentication: email/password is enabled.
- Firestore: production mode, `asia-southeast1` (Singapore).
- Firebase Storage is not enabled. Do not upgrade to Blaze without approval.
- The site is published at <https://sachpsd.github.io/SachinElearnAcademy/> from the `main` branch; Firebase Hosting is not configured.
- The client configuration is in `firebase-config.js`. It identifies the web app and is not an Admin SDK credential. Restrict its API key to the deployed web domains in Google Cloud Console.

## Current connection status

The website now uses Firebase Authentication and Cloud Firestore for accounts, classes, materials, and live-class schedules. Student and teacher passwords are managed by Firebase Authentication and are not written to Firestore. Student FEMIS IDs and teacher TPF numbers are mapped to generated Firebase email addresses internally; users still sign in with their name, ID, and password.

The app is live. Firebase account sign-in is **awaiting the administrator's password reset**:

- The Firestore rules have been published from the Firebase Console. All five composite indexes listed in `firestore.indexes.json` are enabled.
- The administrator Firebase Authentication account and trusted Firestore profile have been created for the email provided by the owner. A password-reset email has been sent; the administrator must use it to set a password before signing in.
- Firebase's Authorized domains form rejected `sachpsd.github.io`; email/password sign-in should be tested after the admin completes the password reset. Do not claim login is working until that test succeeds.
- The Firebase Web API key has not been restricted to the production site domain.
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

2. The administrator login has been created. Use the password-reset email sent to the configured admin email to set a strong password; the old `1234` password is not used.

3. The trusted administrator profile has been created in **Firestore Database → Data** as `users/{ADMIN_UID}`. It contains:

   ```json
   {
     "role": "admin",
     "name": "Academy Administrator",
     "disabled": false
   }
   ```

   This initial profile must be created by a trusted administrator in the console. The public website must not allow users to grant themselves admin privileges.

4. In Google Cloud Console, restrict the Firebase Web API key to the production site and the Firebase APIs the client uses. Avoid broad API-key restrictions that could break Authentication or Firestore. Firebase Console rejected `sachpsd.github.io` when adding it as an Authorized domain, so verify email/password sign-in from the live GitHub Pages URL before onboarding users.

5. After completing the password reset, verify admin login, class and subject setup, teacher/student provisioning, password changes, membership-based access, scheduled release times, and live-class visibility before onboarding students.

## Data and upload limitations

- Firebase Authentication credentials are not stored in Firestore.
- No migration of accounts or other data from browser localStorage has been performed. Existing local accounts/passwords will not work with Firebase.
- Uploaded textbooks, past papers, and other attachments remain local to the uploading browser. Cross-device file downloads require Firebase Storage, which requires a separately approved billing-plan change.
- Live classes use Jitsi Meet. Camera and microphone access require HTTPS; anyone with a room link may be able to join.
