(() => {
  const config = window.SACHINELEARN_FIREBASE_CONFIG;
  if (!config || !window.firebase) return;

  const REGISTRATION_APP = "SachinelearnStudentRegistration";
  let registrationApp;
  try {
    registrationApp = firebase.app(REGISTRATION_APP);
  } catch (_) {
    registrationApp = firebase.initializeApp(config, REGISTRATION_APP);
  }
  const registrationAuth = registrationApp.auth();
  const registrationDb = registrationApp.firestore();
  const defaultDb = firebase.app().firestore();

  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);

  function authEmail(identifier) {
    const bytes = new TextEncoder().encode(String(identifier).trim().toUpperCase());
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return `student.${encoded}@accounts.sachinelearn.academy`;
  }

  function premiumModal(title, subtitle, body) {
    const backdrop = document.createElement("div");
    backdrop.className = "premium-modal-backdrop";
    backdrop.innerHTML = `
      <section class="premium-modal" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
        <div class="premium-modal-header">
          <div><span class="premium-badge">Premium academy access</span><h2>${escapeHTML(title)}</h2><p>${escapeHTML(subtitle)}</p></div>
          <button class="premium-modal-close" type="button" aria-label="Close">×</button>
        </div>
        <div class="premium-modal-body">${body}</div>
      </section>`;
    document.body.append(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector(".premium-modal-close").addEventListener("click", close);
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
    document.addEventListener("keydown", function onKey(event) {
      if (event.key === "Escape") { close(); document.removeEventListener("keydown", onKey); }
    });
    return { backdrop, close };
  }

  function showStudentRegistration() {
    const { backdrop } = premiumModal(
      "Create your student account",
      "Submit your details for academy approval. You can sign in after the administrator approves your account.",
      `<form id="premium-registration-form">
        <div class="premium-form-grid">
          <div class="premium-field full"><label for="premium-reg-name">Full student name</label><input id="premium-reg-name" required maxlength="100" autocomplete="name" placeholder="Enter your full name"></div>
          <div class="premium-field"><label for="premium-reg-femis">FEMIS ID</label><input id="premium-reg-femis" required maxlength="40" autocomplete="username" placeholder="Enter FEMIS ID"></div>
          <div class="premium-field"><label for="premium-reg-email">Contact email</label><input id="premium-reg-email" type="email" required maxlength="120" autocomplete="email" placeholder="student@example.com"></div>
          <div class="premium-field"><label for="premium-reg-password">Password</label><input id="premium-reg-password" type="password" required minlength="6" maxlength="100" autocomplete="new-password" placeholder="At least 6 characters"></div>
          <div class="premium-field"><label for="premium-reg-confirm">Confirm password</label><input id="premium-reg-confirm" type="password" required minlength="6" maxlength="100" autocomplete="new-password" placeholder="Re-enter password"></div>
        </div>
        <div class="premium-form-note">Your account starts as <strong>Pending Approval</strong>. The administrator will assign your class and subjects before access is activated.</div>
        <p class="premium-form-message" id="premium-registration-message" aria-live="polite"></p>
        <div class="premium-form-actions"><button class="premium-btn premium-btn-secondary" type="button" data-premium-close>Cancel</button><button class="premium-btn premium-btn-primary" type="submit">Submit for approval</button></div>
      </form>`,
    );

    backdrop.querySelector("[data-premium-close]").addEventListener("click", () => backdrop.remove());
    backdrop.querySelector("#premium-registration-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = event.submitter;
      const message = backdrop.querySelector("#premium-registration-message");
      const name = backdrop.querySelector("#premium-reg-name").value.trim();
      const femisId = backdrop.querySelector("#premium-reg-femis").value.trim().toUpperCase();
      const contactEmail = backdrop.querySelector("#premium-reg-email").value.trim().toLowerCase();
      const password = backdrop.querySelector("#premium-reg-password").value;
      const confirm = backdrop.querySelector("#premium-reg-confirm").value;
      if (password !== confirm) { message.textContent = "Passwords do not match."; return; }
      if (!name || !femisId || !contactEmail) { message.textContent = "Complete all required fields."; return; }
      button.disabled = true;
      message.textContent = "Submitting your request…";
      const generatedEmail = authEmail(femisId);
      let credential;
      try {
        try {
          credential = await registrationAuth.createUserWithEmailAndPassword(generatedEmail, password);
        } catch (error) {
          if (error.code !== "auth/email-already-in-use") throw error;
          credential = await registrationAuth.signInWithEmailAndPassword(generatedEmail, password);
        }
        const uid = credential.user.uid;
        await registrationDb.collection("pendingRegistrations").doc(uid).set({
          uid,
          role: "student",
          name,
          femisId,
          contactEmail,
          status: "pending",
          requestedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await registrationAuth.signOut();
        event.currentTarget.innerHTML = `<div class="premium-success"><strong>Registration submitted.</strong><br>Your account is waiting for administrator approval. After approval, sign in using your name, FEMIS ID and the password you just created.</div><div class="premium-form-actions"><button class="premium-btn premium-btn-primary" type="button" data-done>Done</button></div>`;
        event.currentTarget.querySelector("[data-done]").addEventListener("click", () => backdrop.remove());
      } catch (error) {
        if (registrationAuth.currentUser) await registrationAuth.signOut().catch(() => {});
        const messages = {
          "auth/weak-password": "Choose a stronger password with at least 6 characters.",
          "auth/invalid-email": "The registration account could not be created. Check the FEMIS ID and try again.",
          "auth/wrong-password": "A request already exists for this FEMIS ID. Enter the same password used previously, or contact the administrator.",
          "auth/invalid-credential": "A request already exists for this FEMIS ID. Enter the same password used previously, or contact the administrator.",
          "permission-denied": "Registration is ready in the premium website, but the new Firestore approval rules still need to be deployed by the administrator.",
        };
        message.textContent = messages[error.code] || error.message || "Could not submit registration.";
        button.disabled = false;
      }
    });
  }

  async function loadPendingRegistrations() {
    const snapshot = await defaultDb.collection("pendingRegistrations").where("status", "==", "pending").get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async function loadClasses() {
    const snapshot = await defaultDb.collection("classes").get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  async function rejectRegistration(request) {
    const reason = window.prompt(`Reason for rejecting ${request.name} (optional):`, "");
    if (reason === null) return;
    await defaultDb.collection("pendingRegistrations").doc(request.id).set({
      status: "rejected",
      rejectionReason: reason.trim(),
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    refreshApprovalPanel();
  }

  async function showApprovalDialog(request) {
    const classes = await loadClasses();
    if (!classes.length) {
      window.alert("Create at least one class and its subjects before approving a student.");
      return;
    }
    const classOptions = classes.map((item) => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.name)}</option>`).join("");
    const { backdrop, close } = premiumModal(
      `Approve ${request.name}`,
      "Assign the student's class and subjects. Teacher assignment can be refined later from Manage Student Profiles.",
      `<form id="premium-approval-form">
        <div class="premium-form-grid">
          <div class="premium-field full"><label>Student</label><input value="${escapeHTML(request.name)} · ${escapeHTML(request.femisId)}" disabled></div>
          <div class="premium-field full"><label for="premium-approval-class">Class</label><select id="premium-approval-class" required>${classOptions}</select></div>
          <div class="premium-field full"><label for="premium-approval-subjects">Subjects</label><select id="premium-approval-subjects" multiple size="6" required></select><small>Select one or more subjects using Ctrl/Command where needed.</small></div>
        </div>
        <p class="premium-form-message" id="premium-approval-message" aria-live="polite"></p>
        <div class="premium-form-actions"><button class="premium-btn premium-btn-secondary" type="button" data-cancel>Cancel</button><button class="premium-btn premium-btn-primary" type="submit">Approve student</button></div>
      </form>`,
    );
    const classSelect = backdrop.querySelector("#premium-approval-class");
    const subjectSelect = backdrop.querySelector("#premium-approval-subjects");
    const updateSubjects = () => {
      const classItem = classes.find((item) => item.id === classSelect.value);
      subjectSelect.innerHTML = (classItem?.subjects || []).map((subject) => `<option value="${escapeHTML(subject.id)}">${escapeHTML(subject.name)}</option>`).join("");
      Array.from(subjectSelect.options).forEach((option) => { option.selected = true; });
    };
    classSelect.addEventListener("change", updateSubjects);
    updateSubjects();
    backdrop.querySelector("[data-cancel]").addEventListener("click", close);
    backdrop.querySelector("#premium-approval-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const message = backdrop.querySelector("#premium-approval-message");
      const submit = event.submitter;
      const classItem = classes.find((item) => item.id === classSelect.value);
      const subjectIds = Array.from(subjectSelect.selectedOptions, (option) => option.value);
      if (!classItem || !subjectIds.length) { message.textContent = "Choose a class and at least one subject."; return; }
      submit.disabled = true;
      message.textContent = "Approving student…";
      try {
        const profile = {
          role: "student",
          name: request.name,
          femisId: request.femisId,
          contactEmail: request.contactEmail || "",
          classId: classItem.id,
          subjectIds,
          disabled: false,
          approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
        };
        const batch = defaultDb.batch();
        batch.set(defaultDb.collection("users").doc(request.id), profile);
        batch.set(defaultDb.collection("classes").doc(classItem.id).collection("members").doc(request.id), {
          role: "student", classId: classItem.id, subjectIds, name: request.name, identifier: request.femisId,
        });
        batch.set(defaultDb.collection("pendingRegistrations").doc(request.id), {
          status: "approved",
          approvedClassId: classItem.id,
          approvedSubjectIds: subjectIds,
          reviewedAt: firebase.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await batch.commit();
        close();
        await refreshApprovalPanel();
        window.alert(`${request.name} is approved. The student can now sign in.`);
      } catch (error) {
        message.textContent = error.message || "Could not approve this student.";
        submit.disabled = false;
      }
    });
  }

  async function refreshApprovalPanel() {
    const panel = document.querySelector(".premium-admin-approvals");
    if (!panel) return;
    const list = panel.querySelector(".premium-approval-list");
    try {
      const requests = await loadPendingRegistrations();
      panel.querySelector(".premium-count").textContent = requests.length;
      list.innerHTML = requests.length ? requests.map((request) => `
        <div class="premium-approval-row" data-request-id="${escapeHTML(request.id)}">
          <div class="premium-approval-meta"><strong>${escapeHTML(request.name)}</strong><small>FEMIS ${escapeHTML(request.femisId)} · ${escapeHTML(request.contactEmail || "No contact email")}</small></div>
          <div class="premium-approval-meta"><strong>Pending approval</strong><small>Assign class and subjects before activation</small></div>
          <div class="premium-approval-actions"><button class="premium-btn premium-btn-secondary" data-approve>Approve</button><button class="premium-btn premium-btn-danger" data-reject>Reject</button></div>
        </div>`).join("") : `<div class="premium-form-note">No student registrations are waiting for approval.</div>`;
      list.querySelectorAll("[data-request-id]").forEach((row) => {
        const request = requests.find((item) => item.id === row.dataset.requestId);
        row.querySelector("[data-approve]").addEventListener("click", () => showApprovalDialog(request));
        row.querySelector("[data-reject]").addEventListener("click", () => rejectRegistration(request));
      });
    } catch (error) {
      list.innerHTML = `<div class="premium-form-note">Could not load approval requests: ${escapeHTML(error.message || "Check Firestore permissions.")}</div>`;
    }
  }

  function injectAdminApprovalPanel() {
    const portal = document.querySelector("#portal");
    const content = document.querySelector("#portal-content");
    const role = document.querySelector("#portal-user-role")?.textContent?.trim().toLowerCase();
    if (!portal || portal.classList.contains("hidden") || !content || role !== "admin" || content.querySelector(".premium-admin-approvals")) return;
    const panel = document.createElement("section");
    panel.className = "premium-admin-approvals";
    panel.innerHTML = `<div class="premium-approval-head"><div><span class="portal-eyebrow">PREMIUM ADMISSIONS</span><h3>Student approval queue</h3><p class="portal-subtitle">Review self-registration requests and activate approved students.</p></div><span class="premium-count">…</span></div><div class="premium-approval-list"><div class="premium-form-note">Loading approval requests…</div></div>`;
    content.prepend(panel);
    refreshApprovalPanel();
  }

  function enhanceLoginCard() {
    const loginCard = document.querySelector(".login-card");
    if (!loginCard || loginCard.querySelector(".premium-create-account")) return;
    const block = document.createElement("div");
    block.className = "premium-create-account";
    block.innerHTML = `<p>New student? Create an account and send it for administrator approval.</p><button type="button" data-open-premium-registration>Create student account</button>`;
    loginCard.append(block);
    block.querySelector("button").addEventListener("click", showStudentRegistration);
  }

  function enhancePage() {
    enhanceLoginCard();
    injectAdminApprovalPanel();
  }

  document.addEventListener("DOMContentLoaded", enhancePage);
  const observer = new MutationObserver(() => enhancePage());
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  window.SachinelearnPremium = { showStudentRegistration, refreshApprovalPanel };
})();
