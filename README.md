# CarePoint Hospital Management System

## Firebase project
This repository is configured for Firebase project `mystudytracker-693d3`.

## One-run deployment
The GitHub Actions workflow `.github/workflows/build.yml` runs in order:
1. Checkout and set up Node.js 22.
2. Install frontend dependencies and build the Vite app.
3. Install Cloud Functions dependencies and validate the function syntax.
4. Authenticate to Google Cloud.
5. Deploy Firestore rules/indexes and Storage rules.
6. Deploy Cloud Functions.
7. Deploy the built website to Firebase Hosting.

Pull requests only run validation. Pushes to `main` and manual `workflow_dispatch` runs perform deployment.

### Required GitHub repository secret
Add `FIREBASE_SERVICE_ACCOUNT` in GitHub → Settings → Secrets and variables → Actions. Its value must be the JSON key for a Google service account with permissions to deploy Firebase Hosting, Firestore rules/indexes, Storage rules and Cloud Functions to `mystudytracker-693d3`.

### Required Firebase Functions secrets
Set these once from a trusted terminal using Firebase CLI:
```bash
firebase use mystudytracker-693d3
firebase functions:secrets:set SMTP_HOST
firebase functions:secrets:set SMTP_PORT
firebase functions:secrets:set SMTP_USER
firebase functions:secrets:set SMTP_PASS
firebase functions:secrets:set MAIL_FROM
```
Use a real SMTP provider/app password. Never commit these values.

## Appointment email OTP
A verified patient requests a six-digit code by email. The code expires after 10 minutes, has a 60-second resend cooldown and a five-attempt limit. The server stores only a SHA-256 hash and the booking payload. The appointment is created only after successful verification. The backend enforces one appointment per normalized email address per Asia/Dhaka calendar day using a Firestore transaction. Staff-created appointments use the same daily email lock.

Firebase Authentication email verification remains required before requesting an appointment OTP. The OTP is an additional booking confirmation step, not a replacement for Firebase Auth verification.

## Important setup
- Enable Email/Password in Firebase Authentication.
- Add the Firebase Hosting domain to Authentication → Settings → Authorized domains.
- Configure SMTP secrets before deploying Functions.
- Assign custom claims (`role=admin`, `doctor`, `receptionist`, `lab`) only through a trusted Admin SDK process. A user profile document must never be used to grant privileged access.
- The Firebase web config is public client configuration; protect data with Security Rules and API restrictions. Do not put service-account JSON or SMTP credentials in frontend code.

## Current scope note
The current UI is an initial portal foundation. Full consultations, prescriptions, lab order lifecycle, invoices/payments, complete analytics, staff role administration and medical-history workflows still require implementation and end-to-end testing before clinical production use. Do not use this system for real patient care until those modules, rules and operational procedures have been reviewed and tested.
