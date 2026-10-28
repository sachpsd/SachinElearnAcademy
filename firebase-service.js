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

  function assignedClassIds(account) {
    if (account.role === "teacher" && Array.isArray(account.classAssignments)) {
      return [...new Set(account.classAssignments.map((assignment) => assignment.classId).filter(Boolean))];
    }
    return account.classId ? [account.classId] : [];
  }

  function materialQueries(role, profile, uid) {
    if (role === "admin") return [db.collection("materials")];
    if (role === "teacher") {
      return assignedClassIds(profile).map((classId) => db.collection("materials")
        .where("classId", "==", classId)
        .where("teacherUid", "==", uid));
    }
    if (role === "student" && profile.classId && Array.isArray(profile.subjectIds) && profile.subjectIds.length) {
      const subjectGroups = [];
      for (let index = 0; index < profile.subjectIds.length; index += 30) {
        subjectGroups.push(profile.subjectIds.slice(index, index + 30));
      }
      return subjectGroups.map((subjectIds) => db.collection("materials")
        .where("classId", "==", profile.classId)
        .where("subjectId", "in", subjectIds)
        .where("availableAt", "<=", firebase.firestore.Timestamp.fromMillis(Date.now())));
    }
    return [];
  }

  function materialRecord(document) {
    const record = { ...document.data(), id: document.id };
    if (record.availableAt?.toMillis) record.availableAt = record.availableAt.toMillis();
    return record;
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
        const classIds = assignedClassIds(account);
        const previousClassIds = assignedClassIds(knownProfiles.get(account.uid) || account);
        classIds.forEach((classId) => {
          if (account.disabled) return;
          const assignment = account.role === "teacher" && Array.isArray(account.classAssignments)
            ? account.classAssignments.find((item) => item.classId === classId)
            : null;
          batch.set(db.collection("classes").doc(classId).collection("members").doc(account.uid), {
            role: account.role,
            classId,
            subjectIds: Array.isArray(assignment?.subjectIds)
              ? assignment.subjectIds
              : Array.isArray(account.subjectIds) ? account.subjectIds : [],
            name: account.name,
            identifier: account.role === "student" ? account.femisId : account.tpfNumber,
          });
        });
        previousClassIds.filter((classId) => !classIds.includes(classId) || account.disabled)
          .forEach((classId) => batch.delete(db.collection("classes").doc(classId).collection("members").doc(account.uid)));
      });
      oldIds.forEach((uid) => {
        if (!nextIds.has(uid)) {
          batch.delete(db.collection("users").doc(uid));
          assignedClassIds(knownProfiles.get(uid) || {}).forEach((classId) => {
            batch.delete(db.collection("classes").doc(classId).collection("members").doc(uid));
          });
        }
      });
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

  function watchMaterials(profile, onUpdate, onError) {
    let active = true;
    let generation = 0;
    let refreshTimer;
    let listeners = [];

    const stopListeners = () => {
      generation += 1;
      listeners.forEach((unsubscribe) => unsubscribe());
      listeners = [];
    };
    const refresh = () => {
      if (!active) return;
      stopListeners();
      const currentGeneration = generation;
      const queries = materialQueries(profile.role, profile, profile.uid);
      if (!queries.length) {
        knownIds.set("materials", new Set());
        onUpdate([]);
        return;
      }
      const recordsByQuery = queries.map(() => []);
      const receivedInitialSnapshot = queries.map(() => false);
      listeners = queries.map((query, index) => query.onSnapshot((snapshot) => {
        if (!active || currentGeneration !== generation) return;
        recordsByQuery[index] = snapshot.docs.map(materialRecord);
        receivedInitialSnapshot[index] = true;
        if (!receivedInitialSnapshot.every(Boolean)) return;
        const records = [...new Map(recordsByQuery.flat().map((item) => [item.id, item])).values()];
        knownIds.set("materials", new Set(records.map((item) => item.id)));
        onUpdate(records);
      }, onError));
    };

    refresh();
    if (profile.role === "student") {
      refreshTimer = window.setInterval(refresh, 60 * 1000);
      document.addEventListener("visibilitychange", refreshWhenVisible);
    }

    function refreshWhenVisible() {
      if (document.visibilityState === "visible") refresh();
    }

    return () => {
      active = false;
      stopListeners();
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
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
      const teacherClassIds = assignedClassIds(profile);
      const classAccounts = await Promise.all(teacherClassIds.map((classId) => readCollection(
        "accounts",
        db.collection("users").where("classId", "==", classId).where("role", "==", "student"),
      )));
      accounts = [...new Map(classAccounts.flat().map((account) => [account.uid, account])).values()];
      if (!accounts.some((account) => account.uid === profile.uid)) accounts.push(profile);
    } else {
      accounts = [profile];
    }
    const teacherClassIds = role === "teacher" ? assignedClassIds(profile) : [];
    const studentMaterialQueries = materialQueries(role, profile, credential.user.uid);
    const liveClassQueries = role === "admin"
      ? [db.collection("liveClasses")]
      : role === "teacher"
        ? teacherClassIds.map((classId) => db.collection("liveClasses").where("classId", "==", classId).where("teacherUid", "==", credential.user.uid))
        : role === "student" && profile.classId && profile.subjectIds?.length
          ? [db.collection("liveClasses").where("classId", "==", profile.classId)
            .where("subjectId", "in", profile.subjectIds.slice(0, 30))]
          : [];
    const [materialResults, liveClassResults] = await Promise.all([
      Promise.all(studentMaterialQueries.map((query) => readCollection("materials", query))),
      Promise.all(liveClassQueries.map((query) => readCollection("liveClasses", query))),
    ]);
    const materials = [...new Map(materialResults.flat().map((item) => [item.id, item])).values()];
    const liveClasses = [...new Map(liveClassResults.flat().map((item) => [item.id, item])).values()];
    knownIds.set("materials", new Set(materials.map((item) => item.id)));
    knownIds.set("liveClasses", new Set(liveClasses.map((item) => item.id)));
    if (role === "teacher") knownIds.set("accounts", new Set(accounts.map((account) => account.uid)));
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
    watchMaterials,
    authEmail,
    async loadPublicClasses() {
      return readCollection("classes", db.collection("classes"));
    },
  };
})();
