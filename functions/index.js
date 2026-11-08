const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const crypto = require("node:crypto");

admin.initializeApp();
const db = admin.firestore();
const SMTP_HOST = defineSecret("SMTP_HOST");
const SMTP_PORT = defineSecret("SMTP_PORT");
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");
const MAIL_FROM = defineSecret("MAIL_FROM");
const REGION = "asia-south1";

function mailer() {
  const port = Number(SMTP_PORT.value() || 587);
  return nodemailer.createTransport({
    host: SMTP_HOST.value(),
    port,
    secure: port === 465,
    auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() }
  });
}
function sha(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
function dhakaToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}
function validateBooking(data) {
  const { department, doctorName, date, time } = data || {};
  if (![department, doctorName, date, time].every(v => typeof v === "string" && v.trim())) {
    throw new HttpsError("invalid-argument", "Department, doctor, date and time are required.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    throw new HttpsError("invalid-argument", "Invalid appointment date or time.");
  }
  if (date < dhakaToday()) throw new HttpsError("invalid-argument", "Appointment date cannot be in the past.");
}
function requireVerified(request) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Please sign in.");
  if (request.auth.token.email_verified !== true) {
    throw new HttpsError("failed-precondition", "Verify your email address before booking.");
  }
}
function isStaff(request) {
  return ["admin", "receptionist"].includes(request.auth?.token?.role);
}

// Step 1: send a real one-time code to the signed-in, Firebase-verified patient's email.
// The booking payload is held server-side and cannot be changed during OTP verification.
exports.requestAppointmentOtp = onCall({
  region: REGION,
  secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM]
}, async request => {
  requireVerified(request);
  validateBooking(request.data);
  const user = await admin.auth().getUser(request.auth.uid);
  if (!user.email || user.emailVerified !== true) {
    throw new HttpsError("failed-precondition", "A verified email address is required.");
  }
  const email = user.email.trim().toLowerCase();
  const otpRef = db.collection("appointmentOtps").doc(request.auth.uid);
  const previous = await otpRef.get();
  const now = Date.now();
  if (previous.exists && previous.data().lastSentAt?.toMillis &&
      now - previous.data().lastSentAt.toMillis() < 60_000) {
    throw new HttpsError("resource-exhausted", "Please wait one minute before requesting another code.");
  }
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = admin.firestore.Timestamp.fromMillis(now + 10 * 60_000);
  await otpRef.set({
    uid: request.auth.uid,
    email,
    codeHash: sha(code),
    booking: {
      department: request.data.department.trim(),
      doctorName: request.data.doctorName.trim(),
      date: request.data.date,
      time: request.data.time,
      reason: String(request.data.reason || "").slice(0, 1500)
    },
    expiresAt,
    lastSentAt: admin.firestore.FieldValue.serverTimestamp(),
    attempts: 0,
    consumed: false
  });
  try {
    await mailer().sendMail({
      from: MAIL_FROM.value(),
      to: email,
      subject: "Your appointment verification code – CarePoint Hospital",
      text: `Your appointment verification code is ${code}. It expires in 10 minutes. If you did not request this, ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#203446"><h2>Verify your appointment</h2><p>Use this one-time code to confirm your appointment request:</p><div style="font-size:32px;letter-spacing:8px;font-weight:700;padding:18px;background:#f1f5f9;border-radius:12px;text-align:center">${code}</div><p>This code expires in 10 minutes. Never share it with anyone.</p></div>`
    });
  } catch (error) {
    await otpRef.delete();
    console.error("Appointment OTP email failed", error);
    throw new HttpsError("unavailable", "The verification email could not be sent. Please try again later.");
  }
  return { sent: true, destination: email.replace(/^(.).+(@.+)$/, "$1***$2"), expiresInSeconds: 600 };
});

// Step 2: verify OTP and atomically reserve the patient's one appointment for the Dhaka date.
exports.verifyAppointmentOtp = onCall({ region: REGION }, async request => {
  requireVerified(request);
  const code = String(request.data?.code || "").trim();
  if (!/^\d{6}$/.test(code)) throw new HttpsError("invalid-argument", "Enter the six-digit code.");
  const uid = request.auth.uid;
  const otpRef = db.collection("appointmentOtps").doc(uid);
  const user = await admin.auth().getUser(uid);
  const email = String(user.email || "").trim().toLowerCase();
  if (!email || user.emailVerified !== true) throw new HttpsError("failed-precondition", "Verified email is required.");
  const emailKey = sha(email);
  const otpSnap = await otpRef.get();
  if (!otpSnap.exists) throw new HttpsError("not-found", "Request a new verification code.");
  const otp = otpSnap.data();
  if (otp.consumed || otp.expiresAt.toMillis() < Date.now()) {
    await otpRef.delete();
    throw new HttpsError("deadline-exceeded", "The code expired. Request a new one.");
  }
  if (otp.attempts >= 5) {
    await otpRef.delete();
    throw new HttpsError("resource-exhausted", "Too many incorrect attempts. Request a new code.");
  }
  if (sha(code) !== otp.codeHash) {
    await otpRef.update({ attempts: admin.firestore.FieldValue.increment(1) });
    throw new HttpsError("permission-denied", "Incorrect verification code.");
  }
  const profileSnap = await db.collection("users").doc(uid).get();
  if (!profileSnap.exists) throw new HttpsError("failed-precondition", "Patient profile not found.");
  const day = otp.booking.date;
  const lockRef = db.collection("appointmentDailyLocks").doc(`${emailKey}_${day}`);
  const appointmentRef = db.collection("appointments").doc();
  await db.runTransaction(async tx => {
    const [freshOtp, lock] = await Promise.all([tx.get(otpRef), tx.get(lockRef)]);
    if (!freshOtp.exists || freshOtp.data().consumed || freshOtp.data().expiresAt.toMillis() < Date.now()) {
      throw new HttpsError("deadline-exceeded", "The verification code is no longer valid.");
    }
    // Re-check the exact code inside the transaction to close the resend/verify race.
    if (freshOtp.data().codeHash !== sha(code)) {
      throw new HttpsError("permission-denied", "The verification code changed. Request the latest code.");
    }
    if (lock.exists) throw new HttpsError("already-exists", "This email already has an appointment for this Bangladesh calendar day.");
    tx.create(lockRef, {
      emailKey, patientUid: uid, date: day, appointmentId: appointmentRef.id,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.create(appointmentRef, {
      patientUid: uid,
      patientName: profileSnap.data().name || user.displayName || "",
      patientEmail: email,
      department: otp.booking.department,
      doctorName: otp.booking.doctorName,
      doctorUid: null,
      date: day,
      time: otp.booking.time,
      reason: otp.booking.reason,
      status: "confirmed",
      createdBy: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      emailStatus: "pending"
    });
    tx.delete(otpRef);
  });
  return { appointmentId: appointmentRef.id, status: "confirmed" };
});

// Staff-created appointments use the same email+Dhaka-day lock as patient bookings.
exports.createAppointment = onCall({ region: REGION }, async request => {
  requireVerified(request);
  if (!isStaff(request)) throw new HttpsError("permission-denied", "Only authorized reception staff can create appointments for patients.");
  validateBooking(request.data);
  const patientEmail = String(request.data.patientEmail || "").trim().toLowerCase();
  if (!patientEmail) throw new HttpsError("invalid-argument", "Patient email is required.");
  const userRecord = await admin.auth().getUserByEmail(patientEmail).catch(() => null);
  if (!userRecord || !userRecord.emailVerified) {
    throw new HttpsError("failed-precondition", "Patient must have an existing verified account.");
  }
  const profileSnap = await db.collection("users").doc(userRecord.uid).get();
  if (!profileSnap.exists) throw new HttpsError("not-found", "Patient profile not found.");
  const day = request.data.date;
  const lockRef = db.collection("appointmentDailyLocks").doc(`${sha(patientEmail)}_${day}`);
  const appointmentRef = db.collection("appointments").doc();
  await db.runTransaction(async tx => {
    const lock = await tx.get(lockRef);
    if (lock.exists) throw new HttpsError("already-exists", "This email already has an appointment for this Bangladesh calendar day.");
    tx.create(lockRef, {
      emailKey: sha(patientEmail), patientUid: userRecord.uid, date: day,
      appointmentId: appointmentRef.id, createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.create(appointmentRef, {
      patientUid: userRecord.uid, patientName: profileSnap.data().name || "",
      patientEmail, department: request.data.department.trim(), doctorName: request.data.doctorName.trim(),
      doctorUid: null, date: day, time: request.data.time,
      reason: String(request.data.reason || "").slice(0, 1500), status: "confirmed",
      createdBy: request.auth.uid, createdAt: admin.firestore.FieldValue.serverTimestamp(), emailStatus: "pending"
    });
  });
  return { appointmentId: appointmentRef.id, status: "confirmed" };
});

exports.sendAppointmentConfirmation = onDocumentCreated({
  document: "appointments/{appointmentId}",
  region: REGION,
  secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM]
}, async event => {
  const ref = event.data.ref;
  const a = event.data.data();
  if (a.status !== "confirmed" || !a.patientEmail) return;
  const claimed = await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (!current.exists || ["sent", "sending"].includes(current.data().emailStatus)) return false;
    tx.update(ref, {
      emailStatus: "sending",
      emailAttemptedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return true;
  });
  if (!claimed) return;
  try {
    const date = new Date(a.date + "T12:00:00+06:00").toLocaleDateString("en-BD", {
      timeZone: "Asia/Dhaka", day: "numeric", month: "long", year: "numeric"
    });
    await mailer().sendMail({
      from: MAIL_FROM.value(),
      to: a.patientEmail,
      subject: "Appointment Confirmed – CarePoint Hospital",
      html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:28px;color:#203446"><h2 style="color:#137e70">Appointment confirmed</h2><p>Dear ${escapeHtml(a.patientName || "Patient")}, your appointment has been confirmed.</p><table cellpadding="9" style="border-collapse:collapse"><tr><td>Appointment ID</td><td><b>${event.params.appointmentId}</b></td></tr><tr><td>Department</td><td>${escapeHtml(a.department)}</td></tr><tr><td>Doctor</td><td>${escapeHtml(a.doctorName)}</td></tr><tr><td>Date</td><td>${date}</td></tr><tr><td>Time</td><td>${escapeHtml(a.time)}</td></tr></table><p>Please arrive 15–20 minutes early. Thank you for choosing CarePoint Hospital.</p></div>`
    });
    await ref.update({ emailStatus: "sent", emailSentAt: admin.firestore.FieldValue.serverTimestamp() });
  } catch (error) {
    await ref.update({
      emailStatus: "failed", emailError: String(error.message || error).slice(0, 500),
      emailFailedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    throw error;
  }
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
