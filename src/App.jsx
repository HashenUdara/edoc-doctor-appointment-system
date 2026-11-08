import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signOut, reload } from "firebase/auth";
import { collection, doc, getDoc, getDocs, query, where, orderBy, limit } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "./firebase";
const roles = ["patient", "doctor", "receptionist", "admin", "lab"];
const money = n => new Intl.NumberFormat("en-BD",{style:"currency",currency:"BDT",maximumFractionDigits:0}).format(Number(n||0));
const today = () => new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Dhaka",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

export default function App(){
  const [user,setUser]=useState(null),[profile,setProfile]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [mode,setMode]=useState("login"),[email,setEmail]=useState(""),[password,setPassword]=useState(""),[name,setName]=useState("");
  const [appointments,setAppointments]=useState([]),[stats,setStats]=useState({patients:0,appointments:0,tests:0,revenue:0});
  const [department,setDepartment]=useState("Medicine"),[doctorName,setDoctorName]=useState("Available doctor"),[date,setDate]=useState(today()),[time,setTime]=useState("10:00"),[reason,setReason]=useState("");
  const [patientEmail,setPatientEmail]=useState(""),[testName,setTestName]=useState("CBC"),[testPrice,setTestPrice]=useState("500");
  const [appointmentOtp,setAppointmentOtp]=useState(""),[otpPending,setOtpPending]=useState(false);

  useEffect(()=>onAuthStateChanged(auth,async u=>{
    setUser(u);setProfile(null);setAppointments([]);
    if(!u)return;
    const snap=await getDoc(doc(db,"users",u.uid));
    if(snap.exists())setProfile(snap.data());
  }),[]);

  async function refresh(){
    if(!user)return;
    const role=profile?.role||"patient";
    const base=collection(db,"appointments");
    let q;
    if(role==="patient")q=query(base,where("patientUid","==",user.uid),orderBy("createdAt","desc"),limit(50));
    else if(role==="doctor")q=query(base,where("doctorUid","==",user.uid),orderBy("createdAt","desc"),limit(100));
    else q=query(base,orderBy("createdAt","desc"),limit(100));
    try{const s=await getDocs(q);setAppointments(s.docs.map(d=>({id:d.id,...d.data()})))}catch(e){setError(e.message)}
    if(role==="admin"||role==="receptionist"){
      try{
        const [p,a,t,paid]=await Promise.all([
          getDocs(collection(db,"patients")),getDocs(collection(db,"appointments")),(role==="admin"?getDocs(collection(db,"testOrders")):Promise.resolve({size:0})),getDocs(query(collection(db,"payments"),where("status","==","paid")) )
        ]);
        setStats({patients:p.size,appointments:a.size,tests:t.size,revenue:paid.docs.reduce((n,d)=>n+Number(d.data().amount||0),0)});
      }catch(e){setError(e.message)}
    }
  }
  useEffect(()=>{if(user&&profile)refresh()},[user,profile]);

  async function register(e){
    e.preventDefault();setBusy(true);setError("");setNotice("");
    try{
      const cred=await createUserWithEmailAndPassword(auth,email.trim().toLowerCase(),password);
      await sendEmailVerification(cred.user);
      // Public registration always creates a patient. Privileged roles must be assigned by a trusted administrator.
      const {setDoc,serverTimestamp}=await import("firebase/firestore");
      await setDoc(doc(db,"users",cred.user.uid),{uid:cred.user.uid,name,email:email.trim().toLowerCase(),role:"patient",emailVerified:false,createdAt:serverTimestamp()});
      setNotice("Verification email sent. Open the link in your inbox, then return here and refresh verification.");
    }catch(e){setError(e.message)}finally{setBusy(false)}
  }
  async function login(e){e.preventDefault();setBusy(true);setError("");try{await signInWithEmailAndPassword(auth,email.trim(),password)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function verify(){setBusy(true);try{await reload(auth.currentUser);const u=auth.currentUser;await u.getIdToken(true);const {updateDoc,doc:docRef}=await import("firebase/firestore");await updateDoc(docRef(db,"users",u.uid),{emailVerified:u.emailVerified});setNotice(u.emailVerified?"Email verified. You can book appointments now.":"Email is not verified yet. Check your inbox.");setProfile(p=>({...p,emailVerified:u.emailVerified}))}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function resetPassword(){if(!email)return setError("Enter your email address first.");try{await sendPasswordResetEmail(auth,email);setNotice("Password reset email sent.")}catch(e){setError(e.message)}}
  async function book(e){
    e.preventDefault();setBusy(true);setError("");setNotice("");
    try{
      const requestOtp=httpsCallable(functions,"requestAppointmentOtp");
      const result=await requestOtp({department,doctorName,date,time,reason});
      setOtpPending(true);setAppointmentOtp("");
      setNotice("A six-digit verification code was sent to "+result.data.destination+". Enter it below to confirm your appointment. The code expires in 10 minutes.");
    }catch(e){setError(e.message||"Unable to send the verification code.")}finally{setBusy(false)}
  }
  async function verifyAppointmentCode(e){
    e.preventDefault();setBusy(true);setError("");setNotice("");
    try{
      const verifyOtp=httpsCallable(functions,"verifyAppointmentOtp");
      const result=await verifyOtp({code:appointmentOtp});
      setOtpPending(false);setAppointmentOtp("");
      setNotice("Appointment confirmed. Appointment ID: "+result.data.appointmentId);
      await refresh();
    }catch(e){setError(e.message||"Unable to verify the code.")}finally{setBusy(false)}
  }
  async function manualBook(e){
    e.preventDefault();setBusy(true);setError("");
    try{const create=httpsCallable(functions,"createAppointment");const result=await create({department,doctorName,date,time,reason,patientEmail:patientEmail.trim().toLowerCase()});setNotice("Patient appointment created: "+result.data.appointmentId);await refresh()}catch(e){setError(e.message)}finally{setBusy(false)}
  }
  async function addTest(e){
    e.preventDefault();setBusy(true);setError("");
    try{const {addDoc,serverTimestamp}=await import("firebase/firestore");await addDoc(collection(db,"testCatalog"),{name:testName,price:Number(testPrice),active:true,createdAt:serverTimestamp()});setNotice("Test added to catalogue.");}catch(e){setError(e.message)}finally{setBusy(false)}
  }
  if(!user)return <main className="auth-shell"><section className="auth-art"><div className="brand"><span className="brand-mark">✚</span> CarePoint</div><div><p className="eyebrow">CONNECTED CARE, MADE SIMPLE</p><h1>Better care starts with a better experience.</h1><p>Appointments, medical records and hospital services in one secure place.</p></div><small>Hospital management portal · Bangladesh</small></section><section className="auth-panel"><div className="auth-card"><span className="eyebrow">WELCOME TO CAREPOINT</span><h2>{mode==="register"?"Create your patient account":"Sign in to your portal"}</h2><p className="muted">Use your email address to securely access hospital services.</p><form onSubmit={mode==="register"?register:login}>{mode==="register"&&<label>Full name<input required value={name} onChange={e=>setName(e.target.value)} placeholder="Your full name"/></label>}<label>Email address<input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@gmail.com"/></label><label>Password<input type="password" minLength="6" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 6 characters"/></label><button className="primary" disabled={busy}>{busy?"Please wait…":mode==="register"?"Create account":"Sign in"}</button></form>{mode==="login"&&<button className="link-button" onClick={resetPassword}>Forgot password?</button>}<p className="switch">{mode==="login"?"New patient?":"Already registered?"} <button className="link-button" onClick={()=>setMode(mode==="login"?"register":"login")}>{mode==="login"?"Create an account":"Sign in"}</button></p>{error&&<p className="alert error">{error}</p>}{notice&&<p className="alert success">{notice}</p>}</div></section></main>;

  if(!profile)return <main className="center-screen"><div className="spinner"/><p>Loading your secure portal…</p></main>;
  if(!user.emailVerified)return <main className="center-screen"><div className="verify-card"><div className="icon-circle">✉</div><p className="eyebrow">EMAIL VERIFICATION REQUIRED</p><h2>Check your inbox</h2><p>We sent a verification link to <b>{user.email}</b>. Verify your address before accessing appointments.</p><button className="primary" onClick={()=>sendEmailVerification(user)}>Resend verification email</button><button className="secondary" onClick={verify}>I've verified my email · Refresh</button><button className="link-button" onClick={()=>signOut(auth)}>Sign out</button>{error&&<p className="alert error">{error}</p>}{notice&&<p className="alert success">{notice}</p>}</div></main>;

  const role=profile.role||"patient";
  const title={patient:"Patient portal",doctor:"Doctor workspace",admin:"Hospital overview",receptionist:"Reception desk",lab:"Laboratory"}[role]||"Patient portal";
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">✚</span> CarePoint</div><div className="side-label">WORKSPACE</div><div className="nav-item active">▦ <span>Overview</span></div><div className="nav-item">▣ <span>Appointments</span></div><div className="nav-item">♡ <span>Patient records</span></div><div className="nav-item">⌁ <span>Diagnostics</span></div><div className="side-bottom"><div className="avatar">{(profile.name||user.email)[0].toUpperCase()}</div><div className="user-meta"><b>{profile.name||"Account"}</b><small>{role}</small></div><button title="Sign out" className="logout" onClick={()=>signOut(auth)}>↗</button></div></aside><main className="main-area"><header className="topbar"><div><span className="eyebrow">CAREPOINT HOSPITAL</span><h1>{title}</h1></div><div className="top-actions"><span className="status-dot">● Verified</span><button className="secondary compact" onClick={refresh}>↻ Refresh</button></div></header><div className="content">
      {error&&<p className="alert error">{error}</p>}{notice&&<p className="alert success">{notice}</p>}
      {(role==="admin"||role==="receptionist")&&<div className="stats-grid"><Stat label="Registered patients" value={stats.patients}/><Stat label="Appointments" value={stats.appointments}/><Stat label="Test orders" value={stats.tests}/><Stat label="Collected revenue" value={money(stats.revenue)}/></div>}
      {role==="patient"&&<><div className="welcome-card"><div><span className="eyebrow">YOUR HEALTH, IN ONE PLACE</span><h2>Hello, {profile.name||"there"} 👋</h2><p>Book a consultation and keep track of your care journey.</p></div><div className="patient-id">PATIENT ACCOUNT<small>{user.uid.slice(0,10).toUpperCase()}</small></div></div><section className="panel"><div className="panel-head"><div><span className="eyebrow">ONLINE BOOKING</span><h2>Book an appointment</h2></div><span className="pill">1 booking per day</span></div><form className="form-grid" onSubmit={book}><label>Department<select value={department} onChange={e=>setDepartment(e.target.value)}>{["Medicine","Cardiology","Dermatology","Pediatrics","Gynecology","Orthopedics","Neurology","ENT"].map(x=><option>{x}</option>)}</select></label><label>Doctor<input required value={doctorName} onChange={e=>setDoctorName(e.target.value)}/></label><label>Date<input type="date" min={today()} required value={date} onChange={e=>setDate(e.target.value)}/></label><label>Preferred time<input type="time" required value={time} onChange={e=>setTime(e.target.value)}/></label><label className="full">Reason for visit<textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Briefly describe your concern"/></label><div className="full"><button className="primary" disabled={busy}>{busy?"Please wait…":"Send email verification code →"}</button><small className="muted">A one-time code is sent to your verified email. The appointment is created only after the code is confirmed.</small></div>{otpPending&&<div className="full otp-panel"><label>Email verification code<input inputMode="numeric" autoComplete="one-time-code" maxLength="6" pattern="[0-9]{6}" required value={appointmentOtp} onChange={e=>setAppointmentOtp(e.target.value.replace(/\\D/g,"").slice(0,6))} placeholder="Enter 6-digit code"/></label><button type="button" className="primary" disabled={busy||appointmentOtp.length!==6} onClick={verifyAppointmentCode}>{busy?"Verifying…":"Verify code & book appointment"}</button><small className="muted">The code expires after 10 minutes. You can request another code after the resend cooldown.</small></div></form></section></>}
      {(role==="admin"||role==="receptionist")&&<section className="panel"><div className="panel-head"><div><span className="eyebrow">FRONT DESK</span><h2>Create patient appointment</h2></div></div><form className="form-grid" onSubmit={manualBook}><label>Verified patient email<input type="email" required value={patientEmail} onChange={e=>setPatientEmail(e.target.value)} placeholder="patient@gmail.com"/></label><label>Department<input value={department} onChange={e=>setDepartment(e.target.value)}/></label><label>Doctor name<input value={doctorName} onChange={e=>setDoctorName(e.target.value)}/></label><label>Date<input type="date" min={today()} value={date} onChange={e=>setDate(e.target.value)}/></label><label>Time<input type="time" value={time} onChange={e=>setTime(e.target.value)}/></label><label className="full">Reason<textarea value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="full"><button className="primary">Create appointment</button></div></form></section>}
      {(role==="admin"||role==="lab")&&<section className="panel"><div className="panel-head"><div><span className="eyebrow">DIAGNOSTICS</span><h2>Test catalogue</h2></div></div><form className="form-grid" onSubmit={addTest}><label>Test name<input value={testName} onChange={e=>setTestName(e.target.value)} required/></label><label>Price (BDT)<input type="number" min="0" value={testPrice} onChange={e=>setTestPrice(e.target.value)} required/></label><div><button className="primary">Add test</button></div></form></section>}
      <section className="panel"><div className="panel-head"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>{role==="patient"?"Your appointments":"Appointment queue"}</h2></div><span className="pill">{appointments.length} records</span></div>{appointments.length===0?<div className="empty"><span>▤</span><b>No appointments yet</b><p>New appointments will appear here.</p></div>:<div className="table-wrap"><table><thead><tr><th>Appointment</th><th>Patient</th><th>Department / Doctor</th><th>Date & time</th><th>Status</th></tr></thead><tbody>{appointments.map(a=><tr key={a.id}><td><b>{a.id.slice(0,8).toUpperCase()}</b></td><td>{a.patientName||a.patientEmail||"Patient"}</td><td>{a.department}<small>{a.doctorName}</small></td><td>{a.date}<small>{a.time}</small></td><td><span className="pill">{a.status||"pending"}</span></td></tr>)}</tbody></table></div>}</section>
      <p className="footer-note">CarePoint · Secure hospital services · Bangladesh Standard Time</p>
    </div></main></div>
}
function Stat({label,value}){return <div className="stat-card"><span>{label}</span><strong>{value}</strong><small>Live database figures</small></div>}
