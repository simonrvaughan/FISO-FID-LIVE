const admin=require("firebase-admin");
const crypto=require("crypto");

admin.initializeApp({
  credential:admin.credential.applicationDefault(),
  databaseURL:"https://fisofid-default-rtdb.europe-west1.firebasedatabase.app"
});
const db=admin.database();

function temporaryPassword(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  return Array.from(crypto.randomBytes(18),b=>chars[b%chars.length]).join("");
}
function parseUsers(){
  let raw=process.env.FISO_INITIAL_USERS_JSON||"";
  if(!raw)throw new Error('Set FISO_INITIAL_USERS_JSON to a JSON array, e.g. [{"userNumber":"123456","name":"Admin User","role":"Admin"}]');
  const users=JSON.parse(raw);
  if(!Array.isArray(users)||!users.length)throw new Error("FISO_INITIAL_USERS_JSON must contain at least one user.");
  return users.map(x=>{
    const userNumber=String(x.userNumber||"").trim();
    const name=String(x.name||"").trim();
    const role=x.role==="Admin"?"Admin":"Operational";
    if(!/^\d{4,10}$/.test(userNumber)||!name)throw new Error("Each initial user needs a 4-10 digit userNumber and a name.");
    return {userNumber,name,role};
  });
}

(async()=>{
  const users=parseUsers();
  for(const x of users){
    const email=`${x.userNumber}@fisofid.internal`;
    const password=temporaryPassword();
    let u;
    try{u=await admin.auth().getUserByEmail(email);await admin.auth().updateUser(u.uid,{password,disabled:false})}
    catch(e){u=await admin.auth().createUser({email,password,displayName:x.userNumber,disabled:false})}
    await admin.auth().setCustomUserClaims(u.uid,{userNumber:x.userNumber,role:x.role,forcePasswordChange:true});
    await db.ref(`fiso/auth/users/${x.userNumber}`).set({userNumber:x.userNumber,name:x.name,role:x.role,enabled:true,uid:u.uid,forcePasswordChange:true,updatedAt:Date.now()});
    console.log(`TEMP PASSWORD ${x.userNumber}: ${password}`);
  }
  console.log("Initial users complete. Store the printed temporary passwords securely; they are not saved in source.");
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
