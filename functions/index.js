const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {onDocumentCreated}=require("firebase-functions/v2/firestore");
const {defineSecret}=require("firebase-functions/params");
const admin=require("firebase-admin");
const nodemailer=require("nodemailer");
admin.initializeApp();
const db=admin.firestore();
const SMTP_HOST=defineSecret("SMTP_HOST"),SMTP_PORT=defineSecret("SMTP_PORT"),SMTP_USER=defineSecret("SMTP_USER"),SMTP_PASS=defineSecret("SMTP_PASS"),MAIL_FROM=defineSecret("MAIL_FROM");

function dhakaDate(value){
  const d=new Date(value+"T12:00:00+06:00");
  if(Number.isNaN(d.getTime()))throw new HttpsError("invalid-argument","Invalid appointment date.");
  return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Dhaka",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
}
exports.createAppointment=onCall({region:"asia-south1"},async request=>{
  if(!request.auth)throw new HttpsError("unauthenticated","Please sign in.");
  if(request.auth.token.email_verified!==true)throw new HttpsError("failed-precondition","Verify your email before booking.");
  const {department,doctorName,date,time,reason="",patientEmail}=request.data||{};
  if(!department||!doctorName||!date||!time)throw new HttpsError("invalid-argument","Department, doctor, date and time are required.");
  const staff=["admin","receptionist"].includes(request.auth.token.role);
  const patientUid=staff&&patientEmail?(await db.collection("users").where("email","==",String(patientEmail).toLowerCase()).limit(1).get()).docs[0]?.id:request.auth.uid;
  if(!patientUid)throw new HttpsError("not-found","Patient account was not found.");
  const patientSnap=await db.collection("users").doc(patientUid).get();
  if(!patientSnap.exists)throw new HttpsError("not-found","Patient profile was not found.");
  const firebasePatient=await admin.auth().getUser(patientUid);
  if(firebasePatient.emailVerified!==true)throw new HttpsError("failed-precondition","Patient must have a verified email.");
  const day=dhakaDate(date);
  const lockId=patientUid+"_"+day;
  const lockRef=db.collection("appointmentDailyLocks").doc(lockId);
  const apptRef=db.collection("appointments").doc();
  await db.runTransaction(async tx=>{
    const lock=await tx.get(lockRef);
    if(lock.exists)throw new HttpsError("already-exists","This Gmail already has an appointment for this Bangladesh calendar day.");
    tx.create(lockRef,{patientUid,date:day,appointmentId:apptRef.id,createdAt:admin.firestore.FieldValue.serverTimestamp()});
    tx.create(apptRef,{patientUid,patientName:patientSnap.data().name||"",patientEmail:patientSnap.data().email,department:String(department),doctorName:String(doctorName),doctorUid:null,date:day,time:String(time),reason:String(reason).slice(0,1500),status:"confirmed",createdBy:request.auth.uid,createdAt:admin.firestore.FieldValue.serverTimestamp(),emailStatus:"pending"});
  });
  return {appointmentId:apptRef.id,status:"confirmed"};
});

exports.sendAppointmentConfirmation=onDocumentCreated({document:"appointments/{appointmentId}",region:"asia-south1",secrets:[SMTP_HOST,SMTP_PORT,SMTP_USER,SMTP_PASS,MAIL_FROM]},async event=>{
  const ref=event.data.ref;const a=event.data.data();
  if(a.status!=="confirmed"||!a.patientEmail)return;
  const claim=await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);if(!snap.exists||snap.data().emailStatus==="sent"||snap.data().emailStatus==="sending")return false;
    tx.update(ref,{emailStatus:"sending",emailAttemptedAt:admin.firestore.FieldValue.serverTimestamp()});return true;
  });
  if(!claim)return;
  try{
    const transporter=nodemailer.createTransport({host:SMTP_HOST.value(),port:Number(SMTP_PORT.value()||587),secure:Number(SMTP_PORT.value())===465,auth:{user:SMTP_USER.value(),pass:SMTP_PASS.value()}});
    const date=new Date(a.date+"T12:00:00+06:00").toLocaleDateString("en-BD",{timeZone:"Asia/Dhaka",day:"numeric",month:"long",year:"numeric"});
    await transporter.sendMail({from:MAIL_FROM.value(),to:a.patientEmail,subject:"Appointment Confirmed – CarePoint Hospital",html:`<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:28px;color:#203446"><h2 style="color:#137e70">Appointment confirmed</h2><p>Dear ${escapeHtml(a.patientName||"Patient")}, your appointment has been confirmed.</p><table cellpadding="9" style="border-collapse:collapse"><tr><td>Appointment ID</td><td><b>${event.params.appointmentId}</b></td></tr><tr><td>Department</td><td>${escapeHtml(a.department)}</td></tr><tr><td>Doctor</td><td>${escapeHtml(a.doctorName)}</td></tr><tr><td>Date</td><td>${date}</td></tr><tr><td>Time</td><td>${escapeHtml(a.time)}</td></tr></table><p>Please arrive 15–20 minutes early. Thank you for choosing CarePoint Hospital.</p></div>`});
    await ref.update({emailStatus:"sent",emailSentAt:admin.firestore.FieldValue.serverTimestamp()});
  }catch(error){await ref.update({emailStatus:"failed",emailError:String(error.message||error).slice(0,500),emailFailedAt:admin.firestore.FieldValue.serverTimestamp()});throw error;}
});
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
