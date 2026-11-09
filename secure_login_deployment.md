# FISO FID Secure Login Deployment — Release 276

## What changed

Release 276 removes the browser-stored Operator password and Admin password hash. The operational application is not loaded until Firebase Authentication has restored or verified a signed-in user. User roles come from Firebase custom claims (`Admin` or `Operational`).

Realtime Database access is now designed to be deny-by-default. The included `database.rules.json` allows authenticated users to read the operational shared data, allows Admin users to write operational shared data, and keeps `fiso/auth`, alert state/history and the push-token collection unreadable from browsers. Push tokens can still be registered by an authenticated user.

The normal Firebase web configuration (`apiKey`, project ID and database URL) remains in browser code. Those values identify the Firebase project and are not treated as passwords. Security is enforced by Firebase Authentication and Realtime Database rules.

## Before publishing Release 276

Do these steps in this order. Do not publish the restrictive database rules before the secure users exist.

### 1. Enable Firebase Authentication

In Firebase Console:

1. Open **Authentication → Sign-in method**.
2. Enable **Email/Password**.

### 2. Deploy the secure Firebase Functions

From the project folder:

```bash
firebase login
firebase use fisofid
firebase functions:secrets:set SMTP_USER
firebase functions:secrets:set SMTP_PASS
cd functions
npm install
cd ..
firebase deploy --only functions
```

`SMTP_PASS` must be a Google App Password, not the normal Gmail password.

### 3. Create the initial users

Generate a Firebase service-account private key from **Project settings → Service accounts** and keep the JSON file outside the website/project folder.

Then run the seed script with the initial users supplied only in your terminal environment (replace the example numbers/names with the users you want):

```bash
cd scripts
npm install
export GOOGLE_APPLICATION_CREDENTIALS="/full/path/to/service-account.json"
export FISO_INITIAL_USERS_JSON='[{"userNumber":"123456","name":"Admin User","role":"Admin"},{"userNumber":"654321","name":"Operational User","role":"Operational"}]'
node seed-auth-users.js
```

The script generates a new random temporary password for each initial user and prints each password once in the terminal. User identities and temporary passwords are not embedded in the website source.

Each user is forced to choose a new private password at first login.

### 4. Deploy the website to Netlify

Use the normal FISO FID deployment process:

1. Replace the local DEV folder contents with Release 276.
2. Zip the **contents** of the folder so `index.html` is at the ZIP root.
3. Upload the ZIP to Netlify.
4. Hard refresh the site.
5. Confirm you can sign in successfully before changing the database rules.

### 5. Publish the Realtime Database security rules

After Release 276 login works, deploy the included rules:

```bash
firebase deploy --only database
```

Alternatively paste the contents of `database.rules.json` into **Firebase Console → Realtime Database → Rules** and publish.

After publishing, an unauthenticated browser should receive `PERMISSION_DENIED` for database reads/writes. An Operational user can read shared operational data but cannot alter Admin-controlled shared datasets. An Admin user can read and write the operational shared datasets.

## Login behaviour

- Login uses the allocated numeric user number plus a private password.
- The password is verified by Firebase Authentication, not JavaScript in the webpage.
- The signed-in session is retained on that device by Firebase; the password itself is not saved by FISO FID.
- `Switch User` / `Log Off` signs out of Firebase.
- Admin status comes from a signed Firebase custom claim and cannot be granted by editing browser JavaScript.
- Admins can use **Manage Users** to create/update users, generate/reset temporary passwords, enable/disable accounts and delete accounts.

## Important limitation

A browser application cannot hide its delivered HTML/JavaScript from someone who is allowed to load it. Release 276 protects the things that must be secret or privileged: passwords are no longer embedded in the frontend, database access is server-enforced, and Admin rights are server-issued claims.

Never place service-account JSON, Gmail App Passwords, Telegram bot tokens, Firebase Admin private keys or other server credentials in the Netlify website folder.
