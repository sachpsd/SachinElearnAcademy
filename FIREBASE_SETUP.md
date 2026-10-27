# Firebase setup

## Project

- Firebase project: `sachinelearn-academy` (Sachinelearn Academy), on the Spark plan.
- Authentication: email/password is enabled.
- Firestore: production mode, `asia-southeast1` (Singapore).
- Firebase Storage is not enabled. Do not upgrade to Blaze without approval.
- The site is published at <https://sachpsd.github.io/SachinElearnAcademy/> from the `main` branch; Firebase Hosting is not configured.
- The client configuration is in `firebase-config.js`. It identifies the web app and is not an Admin SDK credential. Its API key is restricted to the production GitHub Pages referrer.

## Current connection status

The website now uses Firebase Authentication and Cloud Firestore for accounts, classes, materials, and live-class schedules. Student and teacher passwords are managed by Firebase Authentication and are not written to Firestore. Student FEMIS IDs and teacher TPF numbers are mapped to generated Firebase email addresses internally; users still sign in with their name, ID, and password.

The app is live. Administrator sign-in has not yet been verified with the password set by the account owner:

- The Firestore rules have been published from the Firebase Console. All five composite indexes listed in `firestore.indexes.json` are enabled.
- The administrator Firebase Authentication account and trusted Firestore profile have been created. A password-reset email was sent and the owner reports completing it.
- The live site's Firebase Auth endpoint responds from the GitHub Pages origin. Successful sign-in with the administrator's chosen password has not been verified; do not share that password.
- The Firebase Web API key is restricted to `https://sachpsd.github.io/*` as an HTTP referrer. Its API restriction list remains unchanged.
- Existing localStorage accounts and records were not migrated.
- File uploads remain in browser IndexedDB. They are only available in the browser that uploaded them.

## Teacher weekly planning

Teachers open **My class** and double-click an assigned class to open its term planner. Use **Set term dates** to enter the three term start dates; each term's weeks are calculated as seven-day periods. Select a term, expand a week, choose a content type, and select **Add** to post a lesson, notes, activity questions, quiz, assignment, general post, Dropbox link, or video to that class and week. Week dates control the default student release date, and posts appear under the matching week in the student subject view.

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

2. The administrator login has been created, and the owner reports completing the password reset. The old `1234` password is not used.

3. The trusted administrator profile has been created in **Firestore Database → Data** as `users/{ADMIN_UID}`. It contains:

   ```json
   {
     "role": "admin",
     "name": "Academy Administrator",
     "disabled": false
   }
   ```

   This initial profile must be created by a trusted administrator in the console. The public website must not allow users to grant themselves admin privileges.

4. The Firebase Web API key is restricted in Google Cloud Console to the production referrer `https://sachpsd.github.io/*`. Verify sign-in from the live GitHub Pages URL after completing the password reset.

5. Sign in with the reset password, then verify class and subject setup, teacher/student provisioning, password changes, membership-based access, scheduled release times, and live-class visibility before onboarding students.

## Data and upload limitations

- Firebase Authentication credentials are not stored in Firestore.
- No migration of accounts or other data from browser localStorage has been performed. Existing local accounts/passwords will not work with Firebase.
- Uploaded textbooks, past papers, and other attachments remain local to the uploading browser. Cross-device file downloads require Firebase Storage, which requires a separately approved billing-plan change.
- Live classes use Jitsi Meet. Camera and microphone access require HTTPS; anyone with a room link may be able to join.
