# Firebase setup

The site currently runs as a static browser app. Its existing accounts, classes, materials, uploads, and live-class listings are not synchronized to Firebase yet. The files in this scaffold define a Firebase Hosting target and initial Firestore/Storage security rules; configure a Firebase project before attempting to deploy.

## Configure a Firebase project

1. Create a Firebase project and register a Web app.
2. Copy `firebase-config.example.js` to `firebase-config.js` and replace the placeholder values with the Web app config from Firebase Console.
3. Enable Firebase Authentication, Firestore, and Storage in the console.
4. Install the Firebase CLI, sign in, and initialize Hosting, Firestore, and Storage in this folder.
5. Deploy the rules before uploading any user data:

   ```text
   firebase deploy --only firestore:rules,storage
   ```

6. Deploy Hosting after the application has been migrated to use Firebase:

   ```text
   firebase deploy --only hosting
   ```

## Required before real users

- The current sign-in, registration, and data management code still uses browser storage. A secure migration to Firebase Authentication, Firestore, and Storage is required before different users or devices can share accounts, uploads, or live-class schedules.
- The rules expect Firebase Authentication custom claims with `role: "admin"` and Firestore membership documents at `classes/{classId}/members/{uid}`. Create these only from a trusted Admin SDK environment. Never put a Firebase service-account key in this website.
- Existing local accounts and data are not automatically migrated by this scaffold. Back up browser data and implement/verify a trusted migration before switching users.
- Live rooms use Jitsi Meet. The room iframe requires an internet connection and a secure HTTPS deployment for camera/microphone permissions. Jitsi Meet is an external conferencing service.
- Firebase Web app configuration is public client configuration, not a server credential. Restrict its API key to the deployed domains in Google Cloud Console.
