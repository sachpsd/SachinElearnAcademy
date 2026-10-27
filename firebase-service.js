(() => {
  const config = window.SACHINELEARN_FIREBASE_CONFIG;
  if (!config || !config.projectId || !window.firebase) {
    throw new Error("Firebase is not configured. Check firebase-config.js and the Firebase SDK scripts.");
  }

  const app = firebase.initializeApp(config);
  const auth = app.auth();
  const db = app.firestore();
  const provisioningApp = firebase.initializeApp(config, "SachinelearnProvisioning");
  const provisioningAuth = provisioningApp.auth();
  const collections = {
    accounts: "users",
    classes: "classes",
    materials: "materials",
    liveClasses: "liveClasses",
  };
  const knownIds = new Map(Object.keys(collections).map((key) => [key, new Set()]));
  const knownProfiles = new Map();

  function authEmail(role, identifier) {
    const bytes = new TextEncoder().encode(String(identifier).trim().toUpperCase());
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return `${role}.${encoded}@accounts.sachinelearn.academy`;
  }

  function accountProfile(account) {
    const { password, ...profile } = account;
    return profile;
  }

  async function writeRecords(key, items) {
    const collectionName = collections[key];
    if (!collectionName) throw new Error(`Unknown Firebase collection for ${key}.`);
    const oldIds = knownIds.get(key);
    const nextIds = new Set(items.map((item) => String(item.uid || item.id)));
    const batch = db.batch();

    if (key === "accounts") {
      items.forEach((account) => {
        if (!account.uid) throw new Error(`The ${account.name} account is missing its Firebase user ID.`);
        const profile = accountProfile(account);
        batch.set(db.collection("users").doc(account.uid), profile);
        if (account.classId && !account.disabled) {
          batch.set(db.collection("classes").doc(account.classId).collection("members").doc(account.uid), {
            role: account.role,
            classId: account.classId,
            subjectIds: Array.isArray(account.subjectIds) ? account.subjectIds : [],
            name: account.name,
            identifier: account.role === "student" ? account.femisId : account.tpfNumber,
          });
        } else {
          const priorClassId = knownProfiles.get(account.uid)?.classId || account.classId;
          if (priorClassId) {
            batch.delete(db.collection("classes").doc(priorClassId).collection("members").doc(account.uid));
          }
        }
      });
      oldIds.forEach((uid) => {
        if (!nextIds.has(uid)) {
          batch.delete(db.collection("users").doc(uid));
          const priorClassId = knownProfiles.get(uid)?.classId;
          if (priorClassId) {
            batch.delete(db.collection("classes").doc(priorClassId).collection("members").doc(uid));
          }
        }
      });
      for (const account of items) {
        const priorClassId = knownProfiles.get(account.uid)?.classId;
        if (priorClassId && priorClassId !== account.classId) {
          batch.delete(db.collection("classes").doc(priorClassId).collection("members").doc(account.uid));
        }
      }
    } else {
      items.forEach((item) => {
        const id = key === "classes" ? item.id : item.id;
        const data = { ...item };
        if (key === "materials") {
          data.teacherUid = data.teacherUid || auth.currentUser.uid;
          data.availableAt = firebase.firestore.Timestamp.fromMillis(Number.isFinite(data.availableAt) ? data.availableAt : 0);
        }
        if (key === "liveClasses") data.teacherUid = data.teacherUid || auth.currentUser.uid;
        batch.set(db.collection(collectionName).doc(String(id)), data);
      });
      oldIds.forEach((id) => {
        if (!nextIds.has(id)) batch.delete(db.collection(collectionName).doc(id));
      });
    }

    await batch.commit();
    knownIds.set(key, nextIds);
    if (key === "accounts") {
      knownProfiles.clear();
      items.forEach((account) => knownProfiles.set(account.uid, account));
    }
  }

  async function readCollection(key, query) {
    const snapshot = await query.get();
    const records = snapshot.docs.map((document) => {
      const record = { ...document.data(), ...(key === "accounts" ? { uid: document.id } : { id: document.id }) };
      if (key === "materials" && record.availableAt?.toMillis) record.availableAt = record.availableAt.toMillis();
      return record;
    });
    knownIds.set(key, new Set(records.map((record) => String(record.uid || record.id))));
    if (key === "accounts") {
      records.forEach((account) => knownProfiles.set(account.uid, account));
    }
    return records;
  }

  async function signIn(role, name, identifier, password) {
    const email = role === "admin" ? name.trim() : authEmail(role, identifier);
    const credential = await auth.signInWithEmailAndPassword(email, password);
    const profileSnapshot = await db.collection("users").doc(credential.user.uid).get();
    if (!profileSnapshot.exists) {
      await auth.signOut();
      throw new Error("This Firebase account has no academy profile yet. Ask the administrator to finish account setup.");
    }
    const profile = { ...profileSnapshot.data(), uid: credential.user.uid, email: credential.user.email };
    if (profile.disabled) {
      await auth.signOut();
      throw new Error("This academy account has been deactivated. Contact the administrator.");
    }
    if (profile.role !== role) {
      await auth.signOut();
      throw new Error("This account is registered for a different account type.");
    }
    if (role !== "admin" && (
      profile.name.trim().toLowerCase() !== name.trim().toLowerCase()
      || String(profile[role === "student" ? "femisId" : "tpfNumber"]).trim().toUpperCase() !== identifier.trim().toUpperCase()
    )) {
      await auth.signOut();
      throw new Error("The name and ID do not match this account.");
    }

    const classes = await readCollection("classes", db.collection("classes"));
    let accounts;
    if (role === "admin") {
      accounts = await readCollection("accounts", db.collection("users"));
    } else if (role === "teacher") {
      accounts = profile.classId
        ? await readCollection(
          "accounts",
          db.collection("users").where("classId", "==", profile.classId).where("role", "==", "student"),
        )
        : [];
      if (!accounts.some((account) => account.uid === profile.uid)) accounts.push(profile);
    } else {
      accounts = [profile];
    }
    const materialQuery = role === "admin"
      ? db.collection("materials")
      : role === "teacher" && profile.classId
        ? db.collection("materials").where("classId", "==", profile.classId).where("teacherUid", "==", credential.user.uid)
        : role === "student" && profile.classId && profile.subjectIds?.length
          ? db.collection("materials").where("classId", "==", profile.classId)
            .where("subjectId", "in", profile.subjectIds.slice(0, 30))
            .where("availableAt", "<=", firebase.firestore.Timestamp.fromMillis(Date.now()))
          : null;
    const liveClassQuery = role === "admin"
      ? db.collection("liveClasses")
      : role === "teacher" && profile.classId
        ? db.collection("liveClasses").where("classId", "==", profile.classId).where("teacherUid", "==", credential.user.uid)
        : role === "student" && profile.classId && profile.subjectIds?.length
          ? db.collection("liveClasses").where("classId", "==", profile.classId)
            .where("subjectId", "in", profile.subjectIds.slice(0, 30))
          : null;
    const [materials, liveClasses] = await Promise.all([
      materialQuery ? readCollection("materials", materialQuery) : [],
      liveClassQuery ? readCollection("liveClasses", liveClassQuery) : [],
    ]);
    return { user: profile, accounts, classes, materials, liveClasses };
  }

  async function registerAccount(account) {
    const email = authEmail(account.role, account.role === "student" ? account.femisId : account.tpfNumber);
    let credential;
    try {
      credential = await provisioningAuth.createUserWithEmailAndPassword(email, account.password);
      const { password, ...profile } = account;
      const registered = { ...profile, uid: credential.user.uid };
      await db.collection("users").doc(credential.user.uid).set(registered);
      return registered;
    } catch (error) {
      if (credential?.user) await credential.user.delete();
      throw error;
    } finally {
      if (provisioningAuth.currentUser) await provisioningAuth.signOut();
    }
  }

  async function changePassword(currentPassword, newPassword) {
    const user = auth.currentUser;
    if (!user?.email) throw new Error("Your Firebase session has expired. Sign in again.");
    const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
    await user.reauthenticateWithCredential(credential);
    await user.updatePassword(newPassword);
  }

  async function removeProfile(uid) {
    await db.collection("users").doc(uid).delete();
  }

  async function signOut() {
    await auth.signOut();
  }

  window.SachinelearnFirebase = {
    auth,
    signIn,
    signOut,
    registerAccount,
    changePassword,
    removeProfile,
    writeRecords,
    authEmail,
    async loadPublicClasses() {
      return readCollection("classes", db.collection("classes"));
    },
  };
})();
