# CarePoint Hospital Portal — Firebase migration

This branch adds a React/Vite responsive portal alongside the original PHP/MySQL application. The original application remains on `main`.

## Included in this branch
- Firebase Authentication registration, login, verification-email flow and password reset.
- Patient-facing appointment UI and role-oriented dashboard shells.
- Callable Cloud Function for appointment creation.
- Atomic daily booking lock per Firebase UID and Asia/Dhaka calendar date.
- Server-side confirmation email trigger using SMTP secrets.
- Firestore and Storage security rules.
- Firebase Hosting configuration.

## Important implementation boundaries
This is an initial working foundation, not a completed clinical-grade hospital information system. Doctor schedule availability, custom-claim provisioning, full medical-history workflows, laboratory result review, billing/payment gateway, audit reporting, and staff workflows need further implementation and verification before real patient use.

## Local development
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
```

## Firebase deployment
Install Firebase CLI, authenticate with an account that has access to project `consummate-eon-8h7sp`, then:
```bash
firebase use consummate-eon-8h7sp
firebase deploy --only hosting,firestore:rules,storage
```
Deploy Cloud Functions separately after configuring secrets:
```bash
firebase functions:secrets:set SMTP_HOST
firebase functions:secrets:set SMTP_PORT
firebase functions:secrets:set SMTP_USER
firebase functions:secrets:set SMTP_PASS
firebase functions:secrets:set MAIL_FROM
firebase deploy --only functions
```

## Privileged role setup
Public registration always creates a patient. Never let a user choose admin/doctor/receptionist/lab role in the browser. An authorized operator must provision Firebase custom claims (for example `role: 'admin'`) through a trusted Admin SDK script or protected administrative process. Configure the Authentication authorized domain(s) in Firebase Console.

## Before production
- Enable Email/Password provider in Firebase Authentication.
- Add deployed domain to Authentication authorized domains.
- Create Firestore database and Storage bucket.
- Deploy rules and functions.
- Configure SMTP secrets and test deliverability.
- Configure custom claims for trusted staff.
- Add indexes if Firestore reports missing-index errors.
- Complete clinical privacy/security review and test backups, access controls, auditability, and consent requirements.
- Do not use real patient data until the outstanding workflows and security review are complete.
