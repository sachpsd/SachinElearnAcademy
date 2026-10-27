const STORAGE_KEYS = {
  accounts: "sachinelearn.accounts.v1",
  classes: "sachinelearn.classes.v1",
  materials: "sachinelearn.materials.v1",
  liveClasses: "sachinelearn.liveclasses.v1",
};

let accounts = [];
let classes = [];
let materials = [];
let liveClasses = [];
let activeRole = "student";
let currentUser = null;
let currentView = "overview";
let toastTimer;
let attachmentDatabase;
let attachmentObjectUrls = [];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

async function saveStorage(key, value) {
  await window.SachinelearnFirebase.writeRecords(key, value);
}

function openAttachmentDatabase() {
  if (!("indexedDB" in window)) {
    return Promise.reject(new Error("This browser does not support local file storage."));
  }
  if (!attachmentDatabase) {
    attachmentDatabase = new Promise((resolve, reject) => {
      const request = indexedDB.open("sachinelearn.files.v1", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("attachments")) {
          request.result.createObjectStore("attachments");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open file storage."));
    });
  }
  return attachmentDatabase;
}

async function storeAttachment(id, file) {
  const database = await openAttachmentDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction("attachments", "readwrite");
    transaction.objectStore("attachments").put({ blob: file, name: file.name }, id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error || new Error("Could not save this file."));
    transaction.onabort = () => reject(transaction.error || new Error("Saving this file was cancelled."));
  });
}

async function readAttachment(id) {
  const database = await openAttachmentDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction("attachments", "readonly").objectStore("attachments").get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Could not read this file."));
  });
}

async function deleteAttachments(items) {
  const ids = items.map((item) => item.attachmentId).filter(Boolean);
  if (!ids.length) return;
  try {
    const database = await openAttachmentDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction("attachments", "readwrite");
      const store = transaction.objectStore("attachments");
      ids.forEach((id) => store.delete(id));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Could not remove stored files."));
      transaction.onabort = () => reject(transaction.error || new Error("Removing stored files was cancelled."));
    });
  } catch (error) {
    showToast(error.message || "Could not remove stored files from this browser.");
  }
}

async function hydrateAttachmentLinks(root = $("#portal-content")) {
  const links = $$("[data-attachment-id]", root);
  await Promise.all(links.map(async (link) => {
    try {
      const attachment = await readAttachment(link.dataset.attachmentId);
      if (!link.isConnected) return;
      if (!attachment) {
        link.textContent = "File unavailable in this browser";
        link.removeAttribute("href");
        return;
      }
      const objectUrl = URL.createObjectURL(attachment.blob);
      if (!link.isConnected) {
        URL.revokeObjectURL(objectUrl);
        return;
      }
      attachmentObjectUrls.push(objectUrl);
      link.href = objectUrl;
      link.download = attachment.name;
      link.textContent = `Download ${attachment.name} ↓`;
    } catch (error) {
      if (link.isConnected) link.textContent = "Could not load this file";
      showToast(error.message || "Could not load an uploaded file.");
    }
  }));
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3200);
}

function renderPrograms() {
  const subjects = classes.flatMap((classItem) => classItem.subjects.map((subject) => ({
    ...subject,
    className: classItem.name,
  })));
  $("#program-grid").innerHTML = subjects.length
    ? subjects.map((subject) => `
      <a class="program-card" href="#login" aria-label="Sign in to learn ${escapeHTML(subject.name)}">
        <span class="program-icon" aria-hidden="true">✳</span>
        <span class="program-arrow" aria-hidden="true">↗</span>
        <span class="program-category">${escapeHTML(subject.className)}</span>
        <h3>${escapeHTML(subject.name)}</h3>
        <p>${escapeHTML(subject.description || `Explore ${subject.name} learning resources and weekly lessons.`)}</p>
        <span class="program-link-label">Sign in to explore →</span>
      </a>
    `).join("")
    : `<p class="program-empty">Subjects created by your academy administrator will appear here.</p>`;
}

function normalizedIdentifier(value) {
  return String(value || "").trim().toUpperCase();
}

function accountIdentifier(account) {
  return account.role === "student" ? account.femisId : account.tpfNumber;
}

function setActiveRole(role) {
  activeRole = role;
  $$(".role-tab").forEach((tab) => {
    const selected = tab.dataset.role === role;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
  $("#login-error").textContent = "";
  const isAdmin = role === "admin";
  const nameField = $("#login-name-field");
  const idField = $("#login-id-field");
  nameField.classList.remove("hidden");
  idField.classList.toggle("hidden", isAdmin);
  $("#login-name").required = true;
  $("#login-id").required = !isAdmin;
  $("#login-name").disabled = false;
  $("#login-id").disabled = isAdmin;
  $("#login-name-label").textContent = isAdmin ? "Admin email" : role === "teacher" ? "Teacher name" : "Student name";
  $("#login-name").placeholder = isAdmin ? "Enter your admin email" : role === "teacher" ? "Enter your teacher name" : "Enter your student name";
  $("#login-name").type = isAdmin ? "email" : "text";
  $("#login-name").autocomplete = isAdmin ? "username" : "name";
  $("#login-id-label").textContent = role === "teacher" ? "TPF number" : "FEMIS ID";
  $("#login-id").placeholder = role === "teacher" ? "Enter your TPF number" : "Enter your FEMIS ID";
  $("#login-password").autocomplete = isAdmin ? "current-password" : "current-password";
}

async function signIn(event) {
  event.preventDefault();
  const submitButton = $('button[type="submit"]', event.currentTarget);
  submitButton.disabled = true;
  $("#login-error").textContent = "";
  try {
    const data = await window.SachinelearnFirebase.signIn(
      activeRole,
      $("#login-name").value,
      $("#login-id").value,
      $("#login-password").value,
    );
    currentUser = data.user;
    accounts = data.accounts;
    classes = data.classes;
    materials = data.materials;
    liveClasses = data.liveClasses;
  } catch (error) {
    const messages = {
      "auth/invalid-credential": "The email or password is incorrect.",
      "auth/invalid-email": "Enter a valid admin email address.",
      "auth/too-many-requests": "Too many sign-in attempts. Wait a little and try again.",
      "auth/network-request-failed": "Firebase could not be reached. Check your internet connection.",
    };
    $("#login-error").textContent = messages[error.code] || error.message || "Could not sign in. Check your details and try again.";
    submitButton.disabled = false;
    return;
  }
  currentView = "overview";
  $("#landing").classList.add("hidden");
  $("#site-header").classList.add("hidden");
  $$(".access-section, .programs-section, .steps-section, .site-footer").forEach((section) => section.classList.add("hidden"));
  $("#portal").classList.remove("hidden");
  renderPortal();
  window.scrollTo({ top: 0, behavior: "smooth" });
  submitButton.disabled = false;
}

async function signOut() {
  try {
    await window.SachinelearnFirebase.signOut();
  } catch (error) {
    showToast(error.message || "Could not sign out. Please try again.");
    return;
  }
  currentUser = null;
  $("#portal").classList.add("hidden");
  $("#landing").classList.remove("hidden");
  $("#site-header").classList.remove("hidden");
  $$(".access-section, .programs-section, .steps-section, .site-footer").forEach((section) => section.classList.remove("hidden"));
  renderPrograms();
  $("#login-form").reset();
  $("#login-error").textContent = "";
  setActiveRole("student");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function initials(name) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
}

function renderPortal() {
  attachmentObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  attachmentObjectUrls = [];
  $("#portal-user-name").textContent = currentUser.name;
  $("#portal-user-role").textContent = currentUser.role;
  $("#user-avatar").textContent = initials(currentUser.name);
  const navItems = currentUser.role === "admin"
    ? [["overview", "◫", "Overview"], ["classes", "▤", "Classes & subjects"], ["users", "♙", "Accounts"], ["password", "⌑", "Change password"]]
    : currentUser.role === "teacher"
      ? [["overview", "◫", "Overview"], ["classes", "▤", "My class"], ["materials", "✎", "Teaching materials"], ["live-classes", "◉", "Live classes"], ["password", "⌑", "Change password"]]
      : [["overview", "◫", "Overview"], ["classes", "▤", "My class"], ["materials", "✎", "Class materials"], ["live-classes", "◉", "Live classes"], ["password", "⌑", "Change password"]];

  $("#portal-nav").innerHTML = [...navItems, ["signout", "↗", "Sign out"]].map(([view, icon, label]) => `
    <button type="button" data-view="${view}" class="${(view === "users" && ["users", "teacher-profiles", "student-profiles"].includes(currentView) || currentView === view) ? "active" : ""} ${view === "signout" ? "portal-nav-signout" : ""}">
      <span class="nav-icon" aria-hidden="true">${icon}</span>${label}
    </button>
  `).join("");
  $("#portal-nav").onclick = (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    if (button.dataset.view === "signout") {
      signOut();
      return;
    }
    currentView = button.dataset.view;
    renderPortal();
  };
  $("#portal-breadcrumb").textContent = ({
    "teacher-profiles": "TEACHER PROFILES",
    "student-profiles": "STUDENT PROFILES",
  })[currentView] || currentView.toUpperCase();
  $("#portal-content").innerHTML = currentUser.role === "admin"
    ? renderAdminView()
    : currentUser.role === "teacher"
      ? renderTeacherView()
      : renderStudentView();
  wirePortalActions();
  hydrateAttachmentLinks();
}

function portalHeading(eyebrow, title, subtitle, action = "") {
  return `<div class="portal-heading-row"><div><span class="portal-eyebrow">${eyebrow}</span><h1 class="portal-title">${title}</h1><p class="portal-subtitle">${subtitle}</p></div>${action}</div>`;
}

function statCard(label, value, caption) {
  return `<article class="stat-card"><span class="stat-label">${label}</span><strong class="stat-value">${value}</strong><p class="stat-caption">${caption}</p></article>`;
}

function getAccountClass(account) {
  return classes.find((item) => item.id === account.classId);
}

function classSubjects(classId) {
  return classes.find((item) => item.id === classId)?.subjects || [];
}

function currentClassMaterials() {
  if (!currentUser.classId) return [];
  return materials.filter((item) => item.classId === currentUser.classId
    && (currentUser.role !== "student" || !Number.isFinite(item.availableAt) || item.availableAt <= Date.now())
    && (currentUser.role !== "student" || (Array.isArray(currentUser.subjectIds)
      && currentUser.subjectIds.includes(item.subjectId)
      && (!Array.isArray(item.studentIds) || item.studentIds.includes(currentUser.femisId))))
    && (currentUser.role !== "teacher" || !item.teacherId || item.teacherId === currentUser.tpfNumber))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function teacherSubjects(teacher) {
  const subjects = classSubjects(teacher.classId);
  if (!Array.isArray(teacher.subjectIds)) return subjects;
  return subjects.filter((subject) => teacher.subjectIds.includes(subject.id));
}

function teacherStudents(teacher) {
  const students = accounts.filter((account) => !account.disabled && account.role === "student"
    && account.classId === teacher.classId
    && (account.teacherTpf === teacher.tpfNumber
      || (!account.teacherTpf && Array.isArray(teacher.studentIds) && teacher.studentIds.includes(account.femisId))));
  return students;
}

function materialTypeLabel(type) {
  return ({
    lesson: "Lesson",
    note: "Notes",
    quiz: "Quiz",
    practice: "Practice questions",
    activity: "Activity",
    forum: "Forum post",
    video: "Video",
    assignment: "Assignment",
    dropbox: "Dropbox",
    textbook: "Textbook",
    "exam-paper": "Past year exam paper",
  })[type] || "Learning material";
}

function parseLocalDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
  const date = new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return Number.isNaN(date.getTime())
    || `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` !== value
    ? null
    : date;
}

function academicTerms(classItem, items) {
  const today = new Date();
  const termSettings = [
    { name: "Term 1", weeks: 14, startDate: classItem?.termStartDates?.[0] || classItem?.termStartDate || "" },
    { name: "Term 2", weeks: 14, startDate: classItem?.termStartDates?.[1] || "" },
    { name: "Term 3", weeks: 13, startDate: classItem?.termStartDates?.[2] || "" },
  ];
  return termSettings.map((term) => {
    const start = parseLocalDate(term.startDate);
    const weeks = Array.from({ length: term.weeks }, (_, index) => {
      const weekStart = start ? new Date(start) : null;
      if (weekStart) weekStart.setDate(weekStart.getDate() + index * 7);
      const weekEnd = weekStart ? new Date(weekStart) : null;
      if (weekEnd) weekEnd.setDate(weekEnd.getDate() + 7);
      const weekItems = weekStart && weekEnd
        ? items.filter((item) => {
          const activityDate = Number.isFinite(item.availableAt) ? item.availableAt : item.createdAt;
          return Number.isFinite(activityDate)
            && activityDate >= weekStart.getTime()
            && activityDate < weekEnd.getTime();
        })
        : [];
      const now = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      return {
        number: index + 1,
        start: weekStart,
        end: weekEnd ? new Date(weekEnd.getTime() - 86400000) : null,
        items: weekItems,
        isCurrent: Boolean(weekStart && weekEnd && now >= weekStart.getTime() && now < weekEnd.getTime()),
      };
    });
    const activeWeek = weeks.find((week) => week.isCurrent);
    return {
      ...term,
      year: start?.getFullYear() || today.getFullYear(),
      start,
      weeks,
      activeWeek: activeWeek?.number || 0,
    };
  });
}

function renderStudentWeekItems(items) {
  const sections = [
    { title: "Lessons", types: ["lesson", "note"] },
    { title: "Class activities", types: ["activity", "forum"] },
    { title: "Quizzes", types: ["quiz"] },
    { title: "Practice questions", types: ["practice"] },
    { title: "Videos", types: ["video"] },
    { title: "Other class resources", types: ["assignment", "dropbox"] },
  ];
  return `<div class="subject-learning-sections">${sections.map((section) => {
      const sectionItems = items.filter((item) => section.types.includes(item.type));
      const content = sectionItems.length
        ? `<ul>${sectionItems.map((item) => {
          const resourceLink = item.url
            ? `<a href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer">${item.type === "video" ? "Watch video ↗" : item.type === "dropbox" ? "Open Dropbox ↗" : "Open resource ↗"}</a>`
            : "";
          return `<li><span>${escapeHTML(item.title)}</span>${item.dueDate ? `<small>Due ${escapeHTML(item.dueDate)}</small>` : ""}${resourceLink}</li>`;
        }).join("")}</ul>`
        : `<p class="subject-section-empty">No ${section.title.toLowerCase()} posted yet.</p>`;
      return `<section class="subject-learning-section"><h5>${section.title}<span>${sectionItems.length}</span></h5>${content}</section>`;
    }).join("")}</div>`;
}

function renderStudentSubject(subject, items, classItem) {
  const referenceItems = items.filter((item) => ["textbook", "exam-paper"].includes(item.type));
  const terms = academicTerms(classItem, items.filter((item) => !["textbook", "exam-paper"].includes(item.type)));
  return `<article class="subject-card student-subject-card">
    <div class="student-subject-heading">
      <div><span class="subject-term">YOUR SUBJECT</span><h4>${escapeHTML(subject.name)}</h4></div>
      <span class="subject-count">${items.length} materials</span>
    </div>
    <p class="subject-description">${escapeHTML(subject.description || "Learning resources shared by your teacher.")}</p>
    <section class="subject-reference-materials"><h5>Textbooks & past year exam papers<span>${referenceItems.length}</span></h5>${renderMaterials(referenceItems, "No textbooks or past year exam papers have been uploaded for this subject yet.")}</section>
    <div class="student-academic-terms">${terms.map((term, termIndex) => `<section class="student-term">
      <h5>${escapeHTML(`${term.name} · ${term.year}`)}<span>${term.weeks.length} weeks</span></h5>
      ${term.start ? "" : `<p class="term-dates-prompt">Week dates will appear when your teacher sets the term start dates.</p>`}
      <div class="student-term-weeks">${term.weeks.map((week) => {
        const formatDate = (date) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
        const dateRange = week.start && week.end ? `${formatDate(week.start)} – ${formatDate(week.end)}` : "Dates not set";
        const open = week.isCurrent || (!term.start && termIndex === 0 && week.number === 1);
        return `<details class="student-week" ${open ? "open" : ""}>
          <summary><span>Week ${week.number}</span><small>${escapeHTML(dateRange)}</small><span class="week-material-count">${week.items.length}</span></summary>
          ${renderStudentWeekItems(week.items)}
        </details>`;
      }).join("")}</div>
    </section>`).join("")}</div>
  </article>`;
}

function renderMaterials(items, emptyMessage) {
  if (!items.length) return `<div class="empty-state">${emptyMessage}</div>`;
  return `<div class="material-list">${items.map((item) => {
    const subject = classSubjects(item.classId).find((entry) => entry.id === item.subjectId);
    const link = item.url
      ? `<a class="material-link" href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer">${item.type === "video" ? "Watch video ↗" : item.type === "dropbox" ? "Open Dropbox ↗" : "Open resource ↗"}</a>`
      : "";
    const attachmentLink = item.attachmentId
      ? `<a class="material-link" data-attachment-id="${escapeHTML(item.attachmentId)}" href="#" aria-label="Download ${escapeHTML(item.title)}">Preparing download…</a>`
      : "";
    const scheduledRelease = currentUser.role === "teacher" && Number.isFinite(item.availableAt) && item.availableAt > Date.now()
      ? `<span class="material-scheduled">Hidden from students until ${escapeHTML(new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(item.availableAt))}</span>`
      : "";
    return `<article class="material-card"><div class="material-card-top"><span class="course-tag">${escapeHTML(materialTypeLabel(item.type))}</span><span class="material-meta">${escapeHTML(subject?.name || "Subject")}${item.dueDate ? ` · Due ${escapeHTML(item.dueDate)}` : ""}</span></div><h4>${escapeHTML(item.title)}</h4><p class="material-body">${escapeHTML(item.description).replace(/\n/g, "<br>")}</p>${link}${attachmentLink}${scheduledRelease}<p class="material-author">Posted by ${escapeHTML(item.teacherName)}</p></article>`;
  }).join("")}</div>`;
}

function renderLiveClassesView() {
  const myClass = getAccountClass(currentUser);
  const teacher = currentUser.role === "teacher";
  const assignedSubjects = teacher ? teacherSubjects(currentUser) : myClass?.subjects
    .filter((subject) => (currentUser.subjectIds || []).includes(subject.id)) || [];
  const subjectIds = assignedSubjects.map((subject) => subject.id);
  const sessions = liveClasses
    .filter((session) => session.classId === currentUser.classId
      && subjectIds.includes(session.subjectId)
      && (!teacher || session.teacherId === currentUser.tpfNumber))
    .sort((a, b) => a.startsAt - b.startsAt);
  const action = teacher && assignedSubjects.length
    ? `<button class="button button-dark" type="button" data-action="schedule-live-class">+ Schedule live class</button>`
    : "";
  const heading = portalHeading(
    "LIVE LEARNING",
    "Live classes",
    teacher ? "Schedule an online class and meet your students live." : "Join your teacher for a live online lesson.",
    action,
  );
  const cards = sessions.length
    ? `<div class="live-class-list">${sessions.map((session) => {
      const subject = assignedSubjects.find((item) => item.id === session.subjectId);
      return `<article class="live-class-card"><div class="live-class-details"><span class="course-tag">${escapeHTML(subject?.name || "Subject")}</span><h3>${escapeHTML(session.title)}</h3><p>${escapeHTML(session.description || "Join your teacher for this live class.")}</p><small>${escapeHTML(myClass?.name || "Class")} · ${escapeHTML(session.termName || `Term ${session.termNumber || "—"}`)}, Week ${escapeHTML(session.weekNumber || "—")} · ${escapeHTML(new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(session.startsAt))} · ${escapeHTML(session.teacherName)}</small></div><button class="button button-dark" type="button" data-action="join-live-class" data-live-class-id="${escapeHTML(session.id)}">Join class ↗</button></article>`;
    }).join("")}</div>`
    : `<div class="empty-state">${teacher ? "You have not scheduled any live classes yet." : "Your teacher has not scheduled a live class for your subjects yet."}</div>`;
  return `${heading}<section class="portal-panel"><div class="panel-heading"><h3>${myClass ? `${escapeHTML(myClass.name)} online classes` : "Online classes"}</h3><span>${sessions.length} scheduled</span></div>${cards}<p class="live-class-notice">Video calls use the external Jitsi Meet service. Anyone with a room link may be able to join. Class schedules are shared through Firebase.</p></section>`;
}

function renderStudentView() {
  if (currentView === "password") return renderPasswordView();
  if (currentView === "live-classes") return renderLiveClassesView();
  const myClass = getAccountClass(currentUser);
  const classMaterials = currentClassMaterials();
  const assignmentCount = classMaterials.filter((item) => item.type === "assignment").length;
  if (currentView === "materials") {
    return `${portalHeading("YOUR LEARNING SPACE", "Class materials", myClass ? `${escapeHTML(myClass.name)} · notes, activities, quizzes and more.` : "Learning materials shared by your teachers.")}<section class="portal-panel"><div class="panel-heading"><h3>Latest from your teacher</h3><span>${classMaterials.length} posts</span></div>${renderMaterials(classMaterials, "No class materials have been posted yet.")}</section>`;
  }
  const subjectList = myClass?.subjects || [];
  const visibleSubjects = Array.isArray(currentUser.subjectIds)
    ? subjectList.filter((subject) => currentUser.subjectIds.includes(subject.id))
    : [];
  const latestMaterials = classMaterials.slice(0, 4);
  return `${portalHeading("YOUR LEARNING SPACE", `Welcome back, ${escapeHTML(currentUser.name.split(" ")[0])}.`, "A little progress adds up. Here’s what’s happening in your class.")}<div class="stat-grid">${statCard("MY CLASS", myClass ? escapeHTML(myClass.name) : "—", "Your learning group")}${statCard("SUBJECTS", visibleSubjects.length, "Assigned to you")}${statCard("ASSIGNMENTS", assignmentCount, "Shared by your teacher")}</div><section class="portal-panel"><div class="panel-heading"><h3>${myClass ? `${escapeHTML(myClass.name)} subjects` : "Class enrolment"}</h3><span>${visibleSubjects.length} subjects</span></div>${visibleSubjects.length ? `<div class="subject-grid">${visibleSubjects.map((subject) => renderStudentSubject(subject, classMaterials.filter((item) => item.subjectId === subject.id), myClass)).join("")}</div>` : `<div class="empty-state">You haven’t been assigned subjects yet. Please contact your academy administrator.</div>`}</section><section class="portal-panel"><div class="panel-heading"><h3>Latest class materials</h3><span>${classMaterials.length} posts</span></div>${renderMaterials(latestMaterials, "Your teacher’s lessons, activities, quizzes, practice questions and videos will appear here.")}</section>`;
}

function renderTeacherView() {
  if (currentView === "password") return renderPasswordView();
  if (currentView === "live-classes") return renderLiveClassesView();
  if (currentView === "materials") {
    const action = teacherSubjects(currentUser).length && teacherStudents(currentUser).length ? `<button class="button button-dark" type="button" data-action="new-material">+ Post material</button>` : "";
    return `${portalHeading("TEACHING SPACE", "Teaching materials", "Post lessons and activities, or upload textbooks and past year exam papers for each assigned subject.", action)}<section class="portal-panel"><div class="panel-heading"><h3>Your class posts</h3><span>${currentClassMaterials().length} posts</span></div>${renderMaterials(currentClassMaterials(), "No materials yet. Once the administrator creates subjects for your class, you can share resources here.")}</section>`;
  }
  const myClass = getAccountClass(currentUser);
  const classStudents = teacherStudents(currentUser);
  const assignedSubjects = teacherSubjects(currentUser);
  const subjectCount = assignedSubjects.length;
  const classMaterials = currentClassMaterials();
  if (myClass) {
    const assignedStudentList = classStudents.length
      ? classStudents.map((student) => `<span class="assigned-student">${escapeHTML(student.name)}</span>`).join("")
      : `<p class="portal-subtitle">No students assigned yet. Ask your administrator to update your assignment.</p>`;
    const teacherActions = `<div class="account-row-actions"><button class="button button-light" type="button" data-action="set-term-dates">Set term dates</button>${subjectCount && classStudents.length ? `<button class="button button-dark" type="button" data-action="new-material">+ Post material</button>` : ""}</div>`;
    return `${portalHeading("TEACHING SPACE", `Welcome, ${escapeHTML(currentUser.name.split(" ")[0])}.`, `Your class: ${escapeHTML(myClass.name)}. Share learning materials with your assigned students.`, teacherActions)}<div class="stat-grid">${statCard("MY CLASS", escapeHTML(myClass.name), "Assigned by your administrator")}${statCard("SUBJECTS", subjectCount, "Assigned by your administrator")}${statCard("MY STUDENTS", classStudents.length, "Assigned by your administrator")}</div><section class="portal-panel"><div class="panel-heading"><h3>${escapeHTML(myClass.name)} subjects</h3><span>${classStudents.length} students</span></div>${subjectCount ? `<div class="subject-grid">${assignedSubjects.map((subject) => `<article class="subject-card"><span class="program-icon" aria-hidden="true">✳</span><h4>${escapeHTML(subject.name)}</h4><p>${escapeHTML(subject.description || "Share resources and activities for this subject.")}</p></article>`).join("")}</div>` : `<div class="empty-state">Ask your administrator to assign subjects. Teachers cannot create subjects.</div>`}<div class="assigned-student-list"><h4>Students assigned to you</h4>${assignedStudentList}</div></section><section class="portal-panel"><div class="panel-heading"><h3>Recent class materials</h3><span>${classMaterials.length} posts</span></div>${renderMaterials(classMaterials.slice(0, 4), "Your class materials will appear here after you post them.")}</section>`;
  }
  return `${portalHeading("TEACHING SPACE", `Welcome, ${escapeHTML(currentUser.name.split(" ")[0])}.`, myClass ? `Your class: ${escapeHTML(myClass.name)}. Share learning materials with your students.` : "You have not been assigned to a class yet.", subjectCount ? `<button class="button button-dark" type="button" data-action="new-material">+ Post material</button>` : "")}<div class="stat-grid">${statCard("MY CLASS", myClass ? escapeHTML(myClass.name) : "—", "Assigned by your administrator")}${statCard("SUBJECTS", subjectCount, "Created by your administrator")}${statCard("CLASS MATERIALS", classMaterials.length, "Shared with your students")}</div><section class="portal-panel"><div class="panel-heading"><h3>${myClass ? `${escapeHTML(myClass.name)} subjects` : "Class assignment"}</h3><span>${classStudents.length} students</span></div>${myClass && subjectCount ? `<div class="subject-grid">${myClass.subjects.map((subject) => `<article class="subject-card"><span class="program-icon" aria-hidden="true">✳</span><h4>${escapeHTML(subject.name)}</h4><p>${escapeHTML(subject.description || "Share resources and activities for this subject.")}</p></article>`).join("")}</div>` : `<div class="empty-state">Ask your administrator to assign you to a class and create subjects. Teachers cannot create classes or subjects.</div>`}</section><section class="portal-panel"><div class="panel-heading"><h3>Recent class materials</h3><span>${classMaterials.length} posts</span></div>${renderMaterials(classMaterials.slice(0, 4), "Your class materials will appear here after you post them.")}</section>`;
}

function renderAdminView() {
  if (currentView === "password") return renderPasswordView();
  const activeAccounts = accounts.filter((account) => !account.disabled);
  const students = activeAccounts.filter((account) => account.role === "student").length;
  const teachers = activeAccounts.filter((account) => account.role === "teacher").length;
  if (currentView === "classes") return renderAdminClasses();
  if (currentView === "teacher-profiles" || currentView === "student-profiles") {
    const role = currentView === "teacher-profiles" ? "teacher" : "student";
    const roleLabel = role === "teacher" ? "Teacher" : "Student";
    const profiles = accounts.filter((account) => account.role === role);
    const heading = portalHeading(
      `${roleLabel.toUpperCase()} MANAGEMENT`,
      `Manage ${roleLabel.toLowerCase()} profiles`,
      `Register, edit, assign, and remove ${roleLabel.toLowerCase()} accounts.`,
      `<div class="account-row-actions"><button class="button button-light" type="button" data-action="back-profiles">← Profile management</button><button class="button button-dark" type="button" data-action="new-account" data-role="${role}">+ Register ${roleLabel.toLowerCase()}</button></div>`,
    );
    return `${heading}<section class="portal-panel"><div class="panel-heading"><h3>${roleLabel} profiles</h3><span>${profiles.length} ${roleLabel.toLowerCase()}${profiles.length === 1 ? "" : "s"}</span></div>${renderAccountTable(profiles)}</section>`;
  }
  const action = currentView === "overview"
    ? `<button class="button button-dark" type="button" data-action="new-account">+ Register account</button>`
    : "";
  const heading = portalHeading("ACADEMY MANAGEMENT", currentView === "users" ? "Manage profiles" : "Welcome, admin.", currentView === "users" ? "Choose a profile area to manage the platform’s teachers or students." : "Create classes and subjects, then assign your staff and learners.", action);
  const summary = `<div class="stat-grid">${statCard("STUDENTS", students, "Registered learners")}${statCard("TEACHERS", teachers, "Ready to teach")}${statCard("CLASSES", classes.length, "Created by administrators")}</div>`;
  const users = accounts.filter((account) => account.role !== "admin");
  const accountPanel = currentView === "users"
    ? `<section class="profile-manager-grid"><button class="profile-manager-card" type="button" data-action="manage-profiles" data-profile-role="teacher"><span class="profile-manager-icon" aria-hidden="true">♙</span><span class="profile-manager-copy"><strong>Manage teacher profile</strong><small>Register teachers, edit their details, assign classes, subjects and students.</small></span><span class="profile-manager-count">${teachers} ${teachers === 1 ? "teacher" : "teachers"}</span><span class="profile-manager-arrow" aria-hidden="true">→</span></button><button class="profile-manager-card" type="button" data-action="manage-profiles" data-profile-role="student"><span class="profile-manager-icon" aria-hidden="true">♧</span><span class="profile-manager-copy"><strong>Manage student profile</strong><small>Register students, edit their details, and assign their class, teacher and subjects.</small></span><span class="profile-manager-count">${students} ${students === 1 ? "student" : "students"}</span><span class="profile-manager-arrow" aria-hidden="true">→</span></button></section>`
    : `<section class="portal-panel"><div class="panel-heading"><h3>Recent accounts</h3><span>${users.length} registered</span></div>${renderAccountTable(users.slice(-5))}</section>`;
  return `${heading}${summary}${accountPanel}`;
}

function renderAccountTable(users) {
  if (!users.length) {
    const roleLabel = currentView === "teacher-profiles" ? "teacher" : currentView === "student-profiles" ? "student" : "account";
    return `<div class="empty-state">No ${roleLabel} profiles have been registered yet.<br>Use the registration button above to add one.</div>`;
  }
  const teacherHint = users.length
    ? `<p class="portal-subtitle account-assignment-hint">${users.every((account) => account.role === "student") ? "Select Assign to choose a class, teacher and subjects for a student. Sign-in IDs are fixed; users change their passwords themselves." : "Select Assign to choose a teacher’s class, subjects and students. Use Deactivate or Reactivate to control teacher access."}</p>`
    : "";
  return `${teacherHint}<div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>${users.some((account) => account.role === "teacher") ? "FEMIS ID / TPF number" : "FEMIS ID"}</th><th>Role</th><th>Class</th><th>Actions</th></tr></thead><tbody>${users.map((account) => `<tr><td class="table-name">${escapeHTML(account.name)}</td><td class="table-muted">${escapeHTML(accountIdentifier(account) || "Not set")}</td><td><span class="status-pill">${escapeHTML(account.disabled ? `${account.role} · deactivated` : account.role)}</span></td><td class="table-muted">${escapeHTML(getAccountClass(account)?.name || "Not assigned")}</td><td><div class="account-row-actions">${account.disabled ? `<button class="icon-button" type="button" data-action="reactivate-account" data-identifier="${escapeHTML(accountIdentifier(account))}" data-account-role="${escapeHTML(account.role)}">Reactivate</button>` : `${account.role === "teacher" ? `<button class="icon-button" type="button" data-action="assign-teacher" data-identifier="${escapeHTML(account.tpfNumber)}">Assign</button>` : `<button class="icon-button" type="button" data-action="assign-student" data-identifier="${escapeHTML(account.femisId)}">Assign</button>`}<button class="icon-button" type="button" data-action="edit-account" data-account-role="${escapeHTML(account.role)}" data-identifier="${escapeHTML(accountIdentifier(account) || "")}">Edit</button><button class="icon-button" type="button" data-action="remove-account" data-account-role="${escapeHTML(account.role)}" data-identifier="${escapeHTML(accountIdentifier(account) || account.email || "")}" aria-label="Deactivate ${escapeHTML(account.name)}">Deactivate</button>`}</div></td></tr>`).join("")}</tbody></table></div>`;
}

function renderAdminClasses() {
  const heading = portalHeading(
    "ACADEMY MANAGEMENT",
    "Classes & subjects",
    "Administrators create classes and subjects, then assign teachers and students.",
    `<button class="button button-dark" type="button" data-action="new-class">+ Create class</button>`,
  );
  const classCards = classes.length
    ? `<div class="class-grid">${classes.map((classItem) => {
      const studentCount = accounts.filter((account) => !account.disabled && account.role === "student" && account.classId === classItem.id).length;
      const teacher = accounts.find((account) => !account.disabled && account.role === "teacher" && account.classId === classItem.id);
      return `<article class="class-card"><div class="class-card-heading"><div><span class="portal-eyebrow">CLASS</span><h3>${escapeHTML(classItem.name)}</h3></div><span class="course-tag">${studentCount} students</span></div><p class="class-teacher">${teacher ? `Teacher: ${escapeHTML(teacher.name)}` : "No teacher assigned yet"}</p><div class="panel-heading"><h4>Subjects</h4><span>${classItem.subjects.length}</span></div>${classItem.subjects.length ? `<ul class="subject-list">${classItem.subjects.map((subject) => `<li><div class="subject-list-copy"><strong>${escapeHTML(subject.name)}</strong><span>${escapeHTML(subject.description || "")}</span></div><div class="account-row-actions"><button class="icon-button" type="button" data-action="edit-subject" data-class-id="${escapeHTML(classItem.id)}" data-subject-id="${escapeHTML(subject.id)}">Edit</button><button class="icon-button" type="button" data-action="remove-subject" data-class-id="${escapeHTML(classItem.id)}" data-subject-id="${escapeHTML(subject.id)}" aria-label="Remove ${escapeHTML(subject.name)}">Remove</button></div></li>`).join("")}</ul>` : `<div class="empty-state compact-empty">No subjects created yet.</div>`}<div class="class-card-actions"><div class="account-row-actions"><button class="button button-light" type="button" data-action="new-subject" data-class-id="${escapeHTML(classItem.id)}">+ Add subject</button><button class="button button-light" type="button" data-action="edit-class" data-class-id="${escapeHTML(classItem.id)}">Edit class</button></div><button class="icon-button" type="button" data-action="remove-class" data-class-id="${escapeHTML(classItem.id)}" aria-label="Remove ${escapeHTML(classItem.name)}">Remove class</button></div></article>`;
    }).join("")}</div>`
    : `<div class="empty-state">No classes yet. Create a class first, then add subjects and register teachers or students into it.</div>`;
  return `${heading}<section class="portal-panel"><div class="panel-heading"><h3>Academy classes</h3><span>${classes.length} classes</span><button class="button button-light" type="button" data-action="new-subject" ${classes.length ? "" : "disabled"}>+ Create subject</button></div>${classCards}</section>`;
}

function wirePortalActions() {
  $$("[data-action]", $("#portal-content")).forEach((button) => {
    button.addEventListener("click", async () => {
      const { action } = button.dataset;
      if (action === "new-account") showAccountModal(button.dataset.role || "student");
      if (action === "manage-profiles") {
        currentView = button.dataset.profileRole === "teacher" ? "teacher-profiles" : "student-profiles";
        renderPortal();
      }
      if (action === "back-profiles") {
        currentView = "users";
        renderPortal();
      }
      if (action === "assign-student") showStudentAssignmentModal(button.dataset.identifier);
      if (action === "assign-teacher") showTeacherAssignmentModal(button.dataset.identifier);
      if (action === "new-class") showClassModal();
      if (action === "new-subject") showSubjectModal(button.dataset.classId || "");
      if (action === "new-material") showMaterialModal();
      if (action === "schedule-live-class") showLiveClassModal();
      if (action === "join-live-class") joinLiveClass(button.dataset.liveClassId);
      if (action === "set-term-dates") showTermDatesModal();
      if (action === "new-password") showPasswordModal();
      if (action === "edit-account") showAccountEditModal(button.dataset.accountRole, button.dataset.identifier);
      if (action === "edit-class") showClassModal(button.dataset.classId);
      if (action === "edit-subject") showSubjectModal(button.dataset.classId, button.dataset.subjectId);
      if (action === "remove-account") await removeAccount(button.dataset.accountRole, button.dataset.identifier);
      if (action === "reactivate-account") await reactivateAccount(button.dataset.accountRole, button.dataset.identifier);
      if (action === "remove-class") await removeClass(button.dataset.classId);
      if (action === "remove-subject") await removeSubject(button.dataset.classId, button.dataset.subjectId);
    });
  });
}

function showModal(title, description, body) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><div><span class="portal-eyebrow">SACHINELEARN ACADEMY</span><h2 id="modal-title">${title}</h2><p>${description}</p></div><button class="modal-close" type="button" aria-label="Close dialog">×</button></div>${body}</section>`;
  document.body.append(backdrop);
  const close = () => backdrop.remove();
  $(".modal-close", backdrop).addEventListener("click", close);
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
  backdrop.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  $(".modal-close", backdrop).focus();
  return { backdrop, close };
}

function showLiveClassModal() {
  const assignedClasses = classes.filter((classItem) => classItem.id === currentUser.classId);
  if (!assignedClasses.length) {
    showToast("Ask your administrator to assign your class and subjects first.");
    return;
  }
  const { backdrop, close } = showModal("Schedule a live class", "Choose the assigned class, subject, term week, and start time for your online lesson.", `
    <form class="admin-form" id="live-class-form">
      <div class="form-grid">
        <div class="full-width"><label for="live-class-class">Class</label><select id="live-class-class" name="classId" required>${assignedClasses.map((classItem) => `<option value="${escapeHTML(classItem.id)}">${escapeHTML(classItem.name)}</option>`).join("")}</select><p class="select-help">Only classes assigned to you by the administrator can be selected.</p></div>
        <div class="full-width"><label for="live-class-subject">Subject</label><select id="live-class-subject" name="subjectId" required></select></div>
        <div class="full-width"><label for="live-class-title">Class title</label><input id="live-class-title" name="title" required maxlength="100" placeholder="e.g. Mathematics revision"></div>
        <div class="full-width"><label for="live-class-description">What students should prepare (optional)</label><textarea id="live-class-description" name="description" rows="3" maxlength="500" placeholder="Add a short note for your students"></textarea></div>
        <div><label for="live-class-term">Term</label><select id="live-class-term" name="termNumber" required><option value="1">Term 1 (14 weeks)</option><option value="2">Term 2 (14 weeks)</option><option value="3">Term 3 (13 weeks)</option></select></div>
        <div><label for="live-class-week">Week</label><select id="live-class-week" name="weekNumber" required></select></div>
        <div class="full-width"><label for="live-class-start">Start date and time</label><input id="live-class-start" name="startsAt" type="datetime-local" required><p class="select-help" id="live-class-week-dates">Students assigned to this class and subject will see the session in their Live classes page.</p></div>
      </div>
      <div class="admin-form-actions"><button class="button button-dark" type="submit">Schedule class</button><p class="form-message" id="live-class-error" aria-live="polite"></p></div>
    </form>
  `);
  const start = new Date(Date.now() + 5 * 60 * 1000);
  start.setSeconds(0, 0);
  const localStart = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const classSelect = $("#live-class-class", backdrop);
  const subjectSelect = $("#live-class-subject", backdrop);
  const termSelect = $("#live-class-term", backdrop);
  const weekSelect = $("#live-class-week", backdrop);
  const startsAtInput = $("#live-class-start", backdrop);
  const weekDates = $("#live-class-week-dates", backdrop);
  const assignedSubjectsForClass = (classItem) => {
    const subjects = classItem?.subjects || [];
    return classItem?.id === currentUser.classId && Array.isArray(currentUser.subjectIds)
      ? subjects.filter((subject) => currentUser.subjectIds.includes(subject.id))
      : subjects;
  };
  const updateSubjects = () => {
    const classItem = assignedClasses.find((item) => item.id === classSelect.value);
    const subjects = assignedSubjectsForClass(classItem);
    subjectSelect.innerHTML = subjects.map((subject) => `<option value="${escapeHTML(subject.id)}">${escapeHTML(subject.name)}</option>`).join("");
    subjectSelect.disabled = !subjects.length;
  };
  const updateWeekOptions = (setDefaultDate = false, resetWeek = false) => {
    const termNumber = Number(termSelect.value);
    const term = academicTerms(classes.find((item) => item.id === classSelect.value), [])[termNumber - 1];
    const selectedWeek = resetWeek ? "1" : weekSelect.value || "1";
    weekSelect.innerHTML = term.weeks.map((week) => `<option value="${week.number}">Week ${week.number}${week.start ? ` · ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(week.start)}` : ""}</option>`).join("");
    weekSelect.value = term.weeks.some((week) => String(week.number) === selectedWeek) ? selectedWeek : "1";
    const week = term.weeks[Number(weekSelect.value) - 1];
    if (week.start && week.end) {
      const localValue = (date, hours = 10, minutes = 0) => {
        const value = new Date(date);
        value.setHours(hours, minutes, 0, 0);
        return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      };
      startsAtInput.min = localValue(week.start, 0);
      startsAtInput.max = localValue(week.end, 23, 59);
      weekDates.textContent = `Selected week: ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(week.start)} – ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(week.end)}. The class time must fall within this week.`;
      if (setDefaultDate) startsAtInput.value = localValue(week.start);
    } else {
      startsAtInput.removeAttribute("min");
      startsAtInput.removeAttribute("max");
      weekDates.textContent = "Term dates are not set for this class. Ask the administrator to configure them; you can still select a term week and a start time.";
      if (setDefaultDate) startsAtInput.value = localStart;
    }
  };
  updateSubjects();
  updateWeekOptions(true, true);
  classSelect.addEventListener("change", () => {
    updateSubjects();
    updateWeekOptions(true, true);
  });
  termSelect.addEventListener("change", () => updateWeekOptions(true, true));
  weekSelect.addEventListener("change", () => updateWeekOptions(true));
  $("#live-class-form", backdrop).addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const classId = String(formData.get("classId"));
    const subjectId = String(formData.get("subjectId"));
    const termNumber = Number(formData.get("termNumber"));
    const weekNumber = Number(formData.get("weekNumber"));
    const title = String(formData.get("title")).trim();
    const description = String(formData.get("description")).trim();
    const startsAtInput = String(formData.get("startsAt"));
    const startsAt = new Date(startsAtInput).getTime();
    const error = $("#live-class-error", backdrop);
    const classItem = assignedClasses.find((item) => item.id === classId);
    const availableSubjects = assignedSubjectsForClass(classItem);
    const term = academicTerms(classItem, [])[termNumber - 1];
    const week = term?.weeks[weekNumber - 1];
    if (!classItem || !availableSubjects.some((subject) => subject.id === subjectId) || !week || !title || !Number.isFinite(startsAt)) {
      error.textContent = "Choose an assigned class, subject, term week, and valid start time.";
      return;
    }
    if (startsAt <= Date.now()) {
      error.textContent = "Choose a start time in the future.";
      return;
    }
    if (week.start && week.end && (startsAt < week.start.getTime() || startsAt >= new Date(week.end.getTime() + 86400000).getTime())) {
      error.textContent = `The start time must be within Term ${termNumber}, Week ${weekNumber}.`;
      return;
    }
    const id = `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const randomBytes = new Uint8Array(16);
    window.crypto.getRandomValues(randomBytes);
    const room = `sachinelearn-live-${[...randomBytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    liveClasses.push({
      id,
      room,
      title,
      description,
      classId: classItem.id,
      subjectId,
      termNumber,
      termName: term.name,
      termYear: term.year,
      weekNumber,
      teacherId: currentUser.tpfNumber,
      teacherUid: currentUser.uid,
      teacherName: currentUser.name,
      startsAt,
    });
    try {
      await saveStorage(STORAGE_KEYS.liveClasses, liveClasses);
    } catch (error) {
      liveClasses = liveClasses.filter((item) => item.id !== id);
      $("#live-class-error", backdrop).textContent = error.message || "Could not save this live class.";
      return;
    }
    close();
    currentView = "live-classes";
    renderPortal();
    showToast("Live class scheduled.");
  });
}

function joinLiveClass(liveClassId) {
  const session = liveClasses.find((item) => item.id === liveClassId
    && (item.classId === currentUser.classId || (currentUser.classIds || []).includes(item.classId))
    && (currentUser.role === "teacher"
      ? item.teacherId === currentUser.tpfNumber
      : (currentUser.subjectIds || []).includes(item.subjectId)));
  if (!session) {
    showToast("This live class is not available for your account.");
    return;
  }
  const room = String(session.room || "");
  if (!/^sachinelearn-live-[a-z0-9-]+$/i.test(room)) {
    showToast("This live class has an invalid room address.");
    return;
  }
  const roomUrl = `https://meet.jit.si/${encodeURIComponent(room)}#userInfo.displayName=%22${encodeURIComponent(currentUser.name)}%22`;
  showModal("Live online class", "Your call uses Jitsi Meet, an external service. Allow camera and microphone access when prompted.", `
    <div class="live-room"><iframe title="Jitsi live classroom" src="${roomUrl}" allow="camera; microphone; fullscreen; display-capture; autoplay" referrerpolicy="no-referrer"></iframe></div>
  `);
}

function showStudentAssignmentModal(femisId) {
  const student = accounts.find((account) => !account.disabled && account.role === "student"
    && normalizedIdentifier(account.femisId) === normalizedIdentifier(femisId));
  if (!student) return;
  if (!classes.length) {
    showToast("Create a class before assigning a student.");
    return;
  }
  const selectedClass = classes.find((item) => item.id === student.classId) || classes[0];
  const assignedTeacher = accounts.find((account) => !account.disabled && account.role === "teacher"
    && account.classId === selectedClass.id
    && (student.teacherTpf === account.tpfNumber || (!student.teacherTpf && account.studentIds?.includes(student.femisId))));
  const { backdrop, close } = showModal(
    `Assign ${escapeHTML(student.name)}`,
    "Choose the student’s class, teacher and subjects.",
    `<form class="admin-form" id="student-assignment-form">
      <div class="form-grid">
        <div class="full-width"><label for="student-class">Class</label><select id="student-class" name="classId" required>${classes.map((item) => `<option value="${escapeHTML(item.id)}" ${item.id === selectedClass.id ? "selected" : ""}>${escapeHTML(item.name)}</option>`).join("")}</select></div>
        <div class="full-width"><label for="student-teacher">Teacher</label><select id="student-teacher" name="teacherTpf" required></select></div>
        <div class="full-width"><label for="student-subjects">Subjects</label><select id="student-subjects" name="subjectIds" multiple size="4"></select><p class="select-help">Choose the subjects this teacher will teach this student. Use Ctrl or Command to select multiple.</p></div>
      </div>
      <div class="admin-form-actions"><button class="button button-dark" type="submit">Save student assignments</button><p class="form-message" id="student-assignment-error" aria-live="polite"></p></div>
    </form>`,
  );
  const classSelect = $("#student-class", backdrop);
  const teacherSelect = $("#student-teacher", backdrop);
  const subjectSelect = $("#student-subjects", backdrop);
  const initialSubjectIds = Array.isArray(student.subjectIds)
    ? student.subjectIds
    : assignedTeacher ? teacherSubjects(assignedTeacher).map((subject) => subject.id) : [];

  const updateSubjects = (selectedIds) => {
    const teacher = accounts.find((account) => !account.disabled && account.role === "teacher" && account.tpfNumber === teacherSelect.value);
    const allowedSubjects = teacher ? teacherSubjects(teacher) : [];
    subjectSelect.innerHTML = allowedSubjects
      .map((subject) => `<option value="${escapeHTML(subject.id)}">${escapeHTML(subject.name)}</option>`).join("");
    Array.from(subjectSelect.options).forEach((option) => { option.selected = selectedIds.includes(option.value); });
  };
  const updateTeachers = (keepExisting) => {
    const currentTeacherTpf = keepExisting ? teacherSelect.value : student.teacherTpf || assignedTeacher?.tpfNumber || "";
    const classTeachers = accounts.filter((account) => !account.disabled && account.role === "teacher" && account.classId === classSelect.value);
    teacherSelect.innerHTML = `<option value="">Choose a teacher</option>${classTeachers.map((teacher) => `<option value="${escapeHTML(teacher.tpfNumber)}">${escapeHTML(teacher.name)}</option>`).join("")}`;
    teacherSelect.value = classTeachers.some((teacher) => teacher.tpfNumber === currentTeacherTpf) ? currentTeacherTpf : "";
    const selectedIds = keepExisting
      ? Array.from(subjectSelect.selectedOptions, (option) => option.value)
      : initialSubjectIds;
    updateSubjects(selectedIds);
  };
  classSelect.addEventListener("change", () => updateTeachers(false));
  teacherSelect.addEventListener("change", () => updateSubjects([]));
  updateTeachers(false);

  $("#student-assignment-form", backdrop).addEventListener("submit", async (event) => {
    event.preventDefault();
    const classItem = classes.find((item) => item.id === classSelect.value);
    const teacher = accounts.find((account) => !account.disabled && account.role === "teacher" && account.tpfNumber === teacherSelect.value);
    const subjectIds = Array.from(subjectSelect.selectedOptions, (option) => option.value);
    const error = $("#student-assignment-error", backdrop);
    if (!classItem || !teacher || teacher.classId !== classItem.id) {
      error.textContent = "Choose a teacher assigned to the selected class.";
      return;
    }
    if (!subjectIds.length || !subjectIds.every((id) => teacherSubjects(teacher).some((subject) => subject.id === id))) {
      error.textContent = "Choose at least one subject assigned to this teacher.";
      return;
    }
    const previousTeachers = accounts.filter((account) => account.role === "teacher"
      && account.tpfNumber !== teacher.tpfNumber
      && (account.tpfNumber === student.teacherTpf || account.studentIds?.includes(student.femisId)));
    previousTeachers.forEach((oldTeacher) => {
      oldTeacher.studentIds = (oldTeacher.studentIds || []).filter((id) => id !== student.femisId);
      materials = materials.map((item) => item.teacherId === oldTeacher.tpfNumber && Array.isArray(item.studentIds)
        ? { ...item, studentIds: item.studentIds.filter((id) => id !== student.femisId) }
        : item);
    });
    student.classId = classItem.id;
    student.teacherTpf = teacher.tpfNumber;
    student.subjectIds = subjectIds;
    teacher.studentIds = [...new Set([...(teacher.studentIds || []), student.femisId])];
    materials = materials.map((item) => item.teacherId === teacher.tpfNumber && item.classId === classItem.id
      ? { ...item, studentIds: [...new Set([...(item.studentIds || []), student.femisId])] }
      : item);
    try {
      await saveStorage(STORAGE_KEYS.accounts, accounts);
      await saveStorage(STORAGE_KEYS.materials, materials);
    } catch (saveError) {
      error.textContent = saveError.message || "Could not save the assignments.";
      return;
    }
    close();
    renderPortal();
    showToast(`${student.name} was assigned to ${teacher.name} in ${classItem.name}.`);
  });
}

function showTeacherAssignmentModal(tpfNumber) {
  const teacher = accounts.find((account) => account.role === "teacher"
    && normalizedIdentifier(account.tpfNumber) === normalizedIdentifier(tpfNumber));
  if (!teacher) return;
  if (!classes.length) {
    showToast("Create a class before assigning a teacher.");
    return;
  }
  const selectedClass = classes.find((item) => item.id === teacher.classId) || classes[0];
  const initialSubjects = Array.isArray(teacher.subjectIds)
    ? teacher.subjectIds
    : selectedClass.subjects.map((subject) => subject.id);
  const initialStudents = Array.isArray(teacher.studentIds)
    ? teacher.studentIds
    : accounts.filter((account) => account.role === "student" && account.classId === selectedClass.id)
      .map((account) => account.femisId);
  const { backdrop, close } = showModal(
    `Assign ${escapeHTML(teacher.name)}`,
    "Choose the teacher’s class, subjects and students.",
    `<form class="admin-form" id="teacher-assignment-form">
      <div class="form-grid">
        <div class="full-width"><label for="teacher-class">Class</label><select id="teacher-class" name="classId" required>${classes.map((item) => `<option value="${escapeHTML(item.id)}" ${item.id === selectedClass.id ? "selected" : ""}>${escapeHTML(item.name)}</option>`).join("")}</select></div>
        <div class="full-width"><label for="teacher-subjects">Subjects</label><select id="teacher-subjects" name="subjectIds" multiple size="4"></select><p class="select-help">Select one or more subjects. Use Ctrl or Command to select multiple.</p></div>
        <div class="full-width"><label for="teacher-students">Students</label><select id="teacher-students" name="studentIds" multiple size="6"></select><p class="select-help">Selected students will be assigned to this teacher and class. Use Ctrl or Command to select multiple.</p></div>
      </div>
      <div class="admin-form-actions"><button class="button button-dark" type="submit">Save assignments</button><p class="form-message" id="teacher-assignment-error" aria-live="polite"></p></div>
    </form>`,
  );
  const classSelect = $("#teacher-class", backdrop);
  const subjectSelect = $("#teacher-subjects", backdrop);
  const studentSelect = $("#teacher-students", backdrop);
  const populateOptions = (select, options, selectedValues) => {
    select.innerHTML = options.map((option) => `<option value="${escapeHTML(option.value)}">${escapeHTML(option.label)}</option>`).join("");
    Array.from(select.options).forEach((option) => {
      option.selected = selectedValues.includes(option.value);
    });
  };
  const updateAssignmentOptions = (keepExisting = true) => {
    const classId = classSelect.value;
    const classItem = classes.find((item) => item.id === classId);
    const previousSubjects = keepExisting
      ? Array.from(subjectSelect.selectedOptions, (option) => option.value)
      : initialSubjects;
    const previousStudents = keepExisting
      ? Array.from(studentSelect.selectedOptions, (option) => option.value)
      : initialStudents;
    populateOptions(
      subjectSelect,
      (classItem?.subjects || []).map((subject) => ({ value: subject.id, label: subject.name })),
      previousSubjects,
    );
    populateOptions(
      studentSelect,
      accounts.filter((account) => account.role === "student" && account.classId === classId)
        .map((account) => ({ value: account.femisId, label: `${account.name} · ${account.femisId}` })),
      previousStudents,
    );
  };
  classSelect.addEventListener("change", () => updateAssignmentOptions(true));
  updateAssignmentOptions(false);
  $("#teacher-assignment-form", backdrop).addEventListener("submit", async (event) => {
    event.preventDefault();
    const classId = classSelect.value;
    const classItem = classes.find((item) => item.id === classId);
    const subjectIds = Array.from(subjectSelect.selectedOptions, (option) => option.value);
    const studentIds = Array.from(studentSelect.selectedOptions, (option) => option.value);
    const error = $("#teacher-assignment-error", backdrop);
    if (!classItem) {
      error.textContent = "Choose a valid class.";
      return;
    }
    if (!subjectIds.length || !subjectIds.every((id) => classItem.subjects.some((subject) => subject.id === id))) {
      error.textContent = "Assign at least one subject from the selected class.";
      return;
    }
    const selectedStudents = accounts.filter((account) => account.role === "student"
      && account.classId === classItem.id
      && studentIds.includes(account.femisId));
    if (selectedStudents.length !== studentIds.length) {
      error.textContent = "One or more selected students are no longer available. Refresh and try again.";
      return;
    }
    const previousStudentIds = new Set([
      ...(teacher.studentIds || []),
      ...accounts.filter((account) => account.role === "student" && account.teacherTpf === teacher.tpfNumber)
        .map((account) => account.femisId),
    ]);
    previousStudentIds.forEach((previousId) => {
      if (studentIds.includes(previousId)) return;
      const previousStudent = accounts.find((account) => account.role === "student" && account.femisId === previousId);
      if (previousStudent?.teacherTpf === teacher.tpfNumber) {
        delete previousStudent.teacherTpf;
        delete previousStudent.subjectIds;
      }
    });
    selectedStudents.forEach((student) => {
      if (student.teacherTpf && student.teacherTpf !== teacher.tpfNumber) {
        const previousTeacher = accounts.find((account) => account.role === "teacher" && account.tpfNumber === student.teacherTpf);
        if (previousTeacher) previousTeacher.studentIds = (previousTeacher.studentIds || []).filter((id) => id !== student.femisId);
        materials = materials.map((item) => item.teacherId === student.teacherTpf && Array.isArray(item.studentIds)
          ? { ...item, studentIds: item.studentIds.filter((id) => id !== student.femisId) }
          : item);
      }
      student.teacherTpf = teacher.tpfNumber;
      student.subjectIds = [...subjectIds];
    });
    teacher.classId = classItem.id;
    teacher.subjectIds = subjectIds;
    teacher.studentIds = [...studentIds];
    selectedStudents.forEach((student) => { student.classId = classItem.id; });
    const validSubjectIds = new Set(subjectIds);
    materials = materials.filter((item) => item.teacherId !== teacher.tpfNumber
      || (item.classId === classItem.id && validSubjectIds.has(item.subjectId)));
    materials.forEach((item) => {
      if (item.teacherId === teacher.tpfNumber) item.studentIds = [...studentIds];
    });
    try {
      await saveStorage(STORAGE_KEYS.accounts, accounts);
      await saveStorage(STORAGE_KEYS.materials, materials);
    } catch (saveError) {
      $("#teacher-assignment-error", backdrop).textContent = saveError.message || "Could not save the assignments.";
      return;
    }
    close();
    renderPortal();
    showToast(`${teacher.name}’s class, subjects and students were updated.`);
  });
}

function showClassModal(classId = "") {
  const classItem = classes.find((item) => item.id === classId);
  if (classId && !classItem) return;
  const editing = Boolean(classItem);
  const { backdrop, close } = showModal(editing ? "Edit class" : "Create a class", "Only administrators can manage academy classes.", `
    <form class="admin-form" id="class-form">
      <label for="class-name">Class name</label>
      <input id="class-name" name="name" required maxlength="80" placeholder="e.g. Year 10 Blue" value="${escapeHTML(classItem?.name || "")}">
      <div class="admin-form-actions"><button class="button button-dark" type="submit">${editing ? "Save class" : "Create class"}</button><p class="form-message" id="class-error" aria-live="polite"></p></div>
    </form>
  `);
  $("#class-form", backdrop).addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name")).trim();
    if (!name) return;
    if (classes.some((item) => item !== classItem && item.name.toLowerCase() === name.toLowerCase())) {
      $("#class-error", backdrop).textContent = "A class with this name already exists.";
      return;
    }
    if (classItem) classItem.name = name;
    else classes.push({ id: `class-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, subjects: [] });
    try {
      await saveStorage(STORAGE_KEYS.classes, classes);
    } catch (error) {
      $("#class-error", backdrop).textContent = error.message || "Could not save this class.";
      return;
    }
    renderPrograms();
    close();
    renderPortal();
    showToast(classItem ? `${name} class updated.` : `${name} class created.`);
  });
}

function showSubjectModal(selectedClassId = "", subjectId = "") {
  if (!classes.length) {
    showToast("Create a class before adding subjects.");
    return;
  }
  const selectedClass = classes.find((item) => item.id === selectedClassId) || classes[0];
  const subject = selectedClass.subjects.find((item) => item.id === subjectId);
  if (subjectId && !subject) return;
  const editing = Boolean(subject);
  const { backdrop, close } = showModal(editing ? "Edit subject" : "Create a subject", "Subjects can only be managed by an administrator.", `
    <form class="admin-form" id="subject-form">
      <div class="form-grid">
        <div class="full-width"><label for="subject-class">Class</label><select id="subject-class" name="classId" required ${editing ? "disabled" : ""}>${classes.map((item) => `<option value="${escapeHTML(item.id)}" ${item.id === selectedClass.id ? "selected" : ""}>${escapeHTML(item.name)}</option>`).join("")}</select></div>
        <div class="full-width"><label for="subject-name">Subject name</label><input id="subject-name" name="name" required maxlength="80" placeholder="e.g. Mathematics" value="${escapeHTML(subject?.name || "")}"></div>
        <div class="full-width"><label for="subject-description">Description (optional)</label><textarea id="subject-description" name="description" rows="3" maxlength="240" placeholder="A short overview of the subject">${escapeHTML(subject?.description || "")}</textarea></div>
      </div>
      <div class="admin-form-actions"><button class="button button-dark" type="submit">${editing ? "Save subject" : "Create subject"}</button><p class="form-message" id="subject-error" aria-live="polite"></p></div>
    </form>
  `);
  $("#subject-form", backdrop).addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const classItem = classes.find((item) => item.id === (subject ? selectedClass.id : formData.get("classId")));
    const name = String(formData.get("name")).trim();
    const description = String(formData.get("description")).trim();
    if (!classItem || !name) {
      $("#subject-error", backdrop).textContent = "Choose a class and enter a subject name.";
      return;
    }
    if (classItem.subjects.some((item) => item !== subject && item.name.toLowerCase() === name.toLowerCase())) {
      $("#subject-error", backdrop).textContent = "This subject already exists in the selected class.";
      return;
    }
    if (subject) {
      subject.name = name;
      subject.description = description;
    } else {
      classItem.subjects.push({ id: `subject-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name, description });
    }
    try {
      await saveStorage(STORAGE_KEYS.classes, classes);
    } catch (error) {
      $("#subject-error", backdrop).textContent = error.message || "Could not save this subject.";
      return;
    }
    renderPrograms();
    close();
    renderPortal();
    showToast(subject ? `${name} updated in ${classItem.name}.` : `${name} added to ${classItem.name}.`);
  });
}

function showAccountEditModal(role, identifier) {
  const identifierProperty = role === "student" ? "femisId" : "tpfNumber";
  const account = accounts.find((item) => item.role === role
    && normalizedIdentifier(item[identifierProperty]) === normalizedIdentifier(identifier));
  if (!account) return;
  const { backdrop, close } = showModal(`Edit ${role} account`, "Update the account name. Sign-in IDs are fixed to the Firebase login; users can change their own passwords.", `
    <form class="admin-form" id="edit-account-form">
      <div class="form-grid">
        <div class="full-width"><label for="edit-account-name">${role === "student" ? "Student name" : "Teacher name"}</label><input id="edit-account-name" name="name" required maxlength="80" value="${escapeHTML(account.name)}"></div>
        <div class="full-width"><label for="edit-account-identifier">${role === "student" ? "FEMIS ID" : "TPF number"}</label><input id="edit-account-identifier" value="${escapeHTML(account[identifierProperty])}" disabled></div>
      </div>
      <div class="admin-form-actions"><button class="button button-dark" type="submit">Save changes</button><p class="form-message" id="edit-account-error" aria-live="polite"></p></div>
    </form>
  `);
  $("#edit-account-form", backdrop).addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name")).trim();
    const error = $("#edit-account-error", backdrop);
    if (!name) {
      error.textContent = "Enter a name.";
      return;
    }
    account.name = name;
    if (role === "teacher") {
      materials.filter((item) => item.teacherId === account.tpfNumber)
        .forEach((item) => { item.teacherName = name; });
    }
    try {
      await saveStorage(STORAGE_KEYS.accounts, accounts);
      if (role === "teacher") await saveStorage(STORAGE_KEYS.materials, materials);
    } catch (saveError) {
      error.textContent = saveError.message || "Could not save this account.";
      return;
    }
    close();
    renderPortal();
    showToast(`${name}’s account was updated.`);
  });
}

function showAccountModal(initialRole = "student") {
  if (!classes.length) {
    currentView = "classes";
    renderPortal();
    showToast("Create a class before registering students or teachers.");
    return;
  }
  const { backdrop, close } = showModal("Quick register", "Create a sign-in and assign a class in one step.", `
    <form class="admin-form" id="account-form">
      <div class="form-grid">
        <div class="full-width"><label for="new-role">Register</label><select id="new-role" name="role" required><option value="student">Student</option><option value="teacher">Teacher</option></select></div>
        <div class="full-width"><label for="new-name" id="new-name-label">Student name</label><input id="new-name" name="name" autocomplete="name" required maxlength="80" placeholder="Enter student’s full name"></div>
        <div class="full-width"><label for="new-identifier" id="new-identifier-label">FEMIS ID</label><input id="new-identifier" name="identifier" type="text" autocomplete="username" required maxlength="40" placeholder="Enter student’s FEMIS ID"></div>
        <div class="full-width"><label for="new-password">Set a password</label><input id="new-password" name="password" type="password" autocomplete="new-password" minlength="6" required maxlength="100" placeholder="At least 6 characters"></div>
        <div class="full-width"><label for="new-class">Class</label><select id="new-class" name="classId" required>${classes.map((item, index) => `<option value="${escapeHTML(item.id)}" ${index === 0 ? "selected" : ""}>${escapeHTML(item.name)}</option>`).join("")}</select></div>
        <div class="full-width hidden" id="new-teacher-field"><label for="new-teacher">Assign teacher (optional)</label><select id="new-teacher" name="teacherTpf"><option value="">Choose a teacher</option></select></div>
        <fieldset class="full-width assignment-checklist hidden" id="new-subject-field"><legend id="new-subject-legend">Subjects</legend><div class="checklist-options" id="new-subject-options"></div><p class="select-help">Click each subject to select it.</p></fieldset>
      </div>
      <p class="registration-hint">They can sign in with their name, ID, and the password you set.</p>
      <div class="admin-form-actions"><button class="button button-dark" type="submit">Register student</button><p class="form-message" id="account-error" aria-live="polite"></p></div>
    </form>
  `);
  const roleSelect = $("#new-role", backdrop);
  roleSelect.value = initialRole === "teacher" ? "teacher" : "student";
  const classSelect = $("#new-class", backdrop);
  const teacherField = $("#new-teacher-field", backdrop);
  const teacherSelect = $("#new-teacher", backdrop);
  const subjectField = $("#new-subject-field", backdrop);
  const subjectOptions = $("#new-subject-options", backdrop);
  const submitButton = $('button[type="submit"]', backdrop);

  const updateSubjects = () => {
    const role = roleSelect.value;
    const classItem = classes.find((item) => item.id === classSelect.value);
    const teacher = role === "student"
      ? accounts.find((account) => !account.disabled && account.role === "teacher" && account.tpfNumber === teacherSelect.value && account.classId === classSelect.value)
      : null;
    const availableSubjects = role === "teacher"
      ? classItem?.subjects || []
      : teacher ? teacherSubjects(teacher) : [];
    const showSubjects = role === "teacher" || Boolean(teacher);
    subjectField.classList.toggle("hidden", !showSubjects);
    $("#new-subject-legend", backdrop).textContent = role === "teacher" ? "Subjects this teacher will teach" : "Subjects for this student";
    subjectOptions.innerHTML = availableSubjects.length
      ? availableSubjects.map((subject) => `<label class="check-option"><input type="checkbox" name="subjectIds" value="${escapeHTML(subject.id)}"><span>${escapeHTML(subject.name)}</span></label>`).join("")
      : `<span class="checklist-empty">${role === "teacher" ? "No subjects in this class yet. Add them in Classes & subjects." : "This teacher has no subjects assigned yet."}</span>`;
  };
  const updateTeachers = () => {
    const classTeachers = accounts.filter((account) => !account.disabled && account.role === "teacher" && account.classId === classSelect.value);
    teacherSelect.innerHTML = `<option value="">Choose a teacher</option>${classTeachers.map((teacher) => `<option value="${escapeHTML(teacher.tpfNumber)}">${escapeHTML(teacher.name)}</option>`).join("")}`;
    teacherField.classList.toggle("hidden", roleSelect.value !== "student");
    updateSubjects();
  };
  const updateRoleFields = () => {
    const isStudent = roleSelect.value === "student";
    $("#new-name-label", backdrop).textContent = isStudent ? "Student name" : "Teacher name";
    $("#new-name", backdrop).placeholder = isStudent ? "Enter student’s full name" : "Enter teacher’s full name";
    $("#new-identifier-label", backdrop).textContent = isStudent ? "FEMIS ID" : "TPF number";
    $("#new-identifier", backdrop).placeholder = isStudent ? "Enter student’s FEMIS ID" : "Enter teacher’s TPF number";
    submitButton.textContent = isStudent ? "Register student" : "Register teacher";
    updateTeachers();
  };
  roleSelect.addEventListener("change", updateRoleFields);
  classSelect.addEventListener("change", updateTeachers);
  teacherSelect.addEventListener("change", updateSubjects);
  updateRoleFields();

  $("#account-form", backdrop).addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name")).trim();
    const role = String(formData.get("role"));
    const identifier = normalizedIdentifier(formData.get("identifier"));
    const password = String(formData.get("password"));
    const classId = String(formData.get("classId"));
    const teacherTpf = role === "student" ? String(formData.get("teacherTpf") || "") : "";
    const subjectIds = $$('input[name="subjectIds"]:checked', backdrop).map((input) => input.value);
    const classItem = classes.find((item) => item.id === classId);
    const selectedTeacher = teacherTpf
      ? accounts.find((account) => !account.disabled && account.role === "teacher" && account.tpfNumber === teacherTpf && account.classId === classId)
      : null;
    const identifierProperty = role === "student" ? "femisId" : "tpfNumber";
    const existing = accounts.some((account) => account.role === role
      && normalizedIdentifier(account[identifierProperty]) === identifier);
    const error = $("#account-error", backdrop);
    if (existing) { error.textContent = `This ${role === "student" ? "FEMIS ID" : "TPF number"} is already registered.`; return; }
    if (!name || !identifier || !["student", "teacher"].includes(role) || password.length < 6 || !classItem) { error.textContent = "Enter a name, ID, password and valid class."; return; }
    if (role === "teacher" && (!subjectIds.length || !subjectIds.every((id) => classItem.subjects.some((subject) => subject.id === id)))) {
      error.textContent = "Choose at least one subject for this teacher.";
      return;
    }
    if (role === "student" && teacherTpf && (!selectedTeacher || !subjectIds.length || !subjectIds.every((id) => teacherSubjects(selectedTeacher).some((subject) => subject.id === id)))) {
      error.textContent = "Choose a teacher and at least one of their subjects, or leave the teacher unassigned.";
      return;
    }
    let account = {
      name,
      [identifierProperty]: identifier,
      role,
      classId,
      subjectIds: [...subjectIds],
      ...(role === "teacher" ? { studentIds: [] } : {}),
      ...(selectedTeacher ? { teacherTpf: selectedTeacher.tpfNumber } : {}),
    };
    try {
      account = await window.SachinelearnFirebase.registerAccount({
        ...account,
        password,
        ...(role === "teacher" ? { studentIds: [] } : {}),
      });
    } catch (error) {
      const authMessages = {
        "auth/email-already-in-use": `This ${role === "student" ? "FEMIS ID" : "TPF number"} already has a Firebase login.`,
        "auth/weak-password": "Choose a stronger password with at least 6 characters.",
        "auth/network-request-failed": "Firebase could not be reached. Check the internet connection.",
      };
      $("#account-error", backdrop).textContent = authMessages[error.code] || error.message || "Could not register this account.";
      return;
    }
    accounts.push(account);
    if (selectedTeacher) selectedTeacher.studentIds = [...new Set([...(selectedTeacher.studentIds || []), identifier])];
    if (selectedTeacher) {
      materials = materials.map((item) => item.teacherId === selectedTeacher.tpfNumber && item.classId === classId
        ? { ...item, studentIds: [...new Set([...(item.studentIds || []), identifier])] }
        : item);
    }
    try {
      await saveStorage(STORAGE_KEYS.accounts, accounts);
      if (selectedTeacher) await saveStorage(STORAGE_KEYS.materials, materials);
    } catch (error) {
      $("#account-error", backdrop).textContent = error.message || "The account was created but its academy profile could not be saved.";
      return;
    }
    close();
    renderPortal();
    showToast(`${role === "student" ? "Student" : "Teacher"} account created for ${name}.`);
  });
}

function showMaterialModal() {
  const myClass = getAccountClass(currentUser);
  const assignedSubjects = teacherSubjects(currentUser);
  const assignedStudents = teacherStudents(currentUser);
  if (!myClass || !assignedSubjects.length || !assignedStudents.length) {
    showToast("Ask your administrator to assign your class, subjects and students first.");
    return;
  }
  const types = [
    ["lesson", "Lesson"],
    ["note", "Notes"],
    ["quiz", "Quiz"],
    ["practice", "Practice questions"],
    ["activity", "Activity"],
    ["forum", "Forum post"],
    ["video", "Video"],
    ["assignment", "Assignment"],
    ["dropbox", "Dropbox"],
    ["textbook", "Upload textbook"],
    ["exam-paper", "Upload past year exam paper"],
  ];
  const { backdrop, close } = showModal("Post class material", "Share a resource with students in your class.", `
    <form class="admin-form" id="material-form">
      <div class="form-grid">
        <div><label for="material-type">Material type</label><select id="material-type" name="type" required>${types.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div>
        <div><label for="material-subject">Subject</label><select id="material-subject" name="subjectId" required>${assignedSubjects.map((subject) => `<option value="${escapeHTML(subject.id)}">${escapeHTML(subject.name)}</option>`).join("")}</select></div>
        <div class="full-width"><label for="material-title">Title</label><input id="material-title" name="title" required maxlength="100" placeholder="Give this post a title"></div>
        <div class="full-width"><label for="material-description" id="material-description-label">Content / instructions</label><textarea id="material-description" name="description" rows="5" required maxlength="5000" placeholder="Write the notes, activity, questions, or instructions for your students"></textarea></div>
        <div class="full-width hidden" id="material-file-field"><label for="material-file">Choose a file (PDF, DOC, DOCX or ODT)</label><input id="material-file" name="attachment" type="file" accept=".pdf,.doc,.docx,.odt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text"><p class="select-help">Maximum file size: 50 MB. Files are saved in this browser only and are not available to students on other devices.</p></div>
        <div class="full-width hidden" id="material-url-field"><label for="material-url" id="material-url-label">Resource link</label><input id="material-url" name="url" type="url" maxlength="500" placeholder="https://"></div>
        <div class="full-width hidden" id="material-due-field"><label for="material-due">Due date (optional)</label><input id="material-due" name="dueDate" type="date"></div>
        <div class="full-width"><label for="material-available-at">Keep hidden from students until (optional)</label><input id="material-available-at" name="availableAt" type="datetime-local"><p class="select-help">Students will not see this post, its links or its contents before this local date and time. Leave blank to publish it immediately.</p></div>
      </div>
      <div class="admin-form-actions"><button class="button button-dark" type="submit">Publish to class</button><p class="form-message" id="material-error" aria-live="polite"></p></div>
    </form>
  `);
  const typeSelect = $("#material-type", backdrop);
  const urlField = $("#material-url-field", backdrop);
  const dueField = $("#material-due-field", backdrop);
  const fileField = $("#material-file-field", backdrop);
  const fileInput = $("#material-file", backdrop);
  const urlInput = $("#material-url", backdrop);
  const updateMaterialFields = () => {
    const type = typeSelect.value;
    const needsUrl = type === "video" || type === "dropbox";
    const needsFile = type === "textbook" || type === "exam-paper";
    urlField.classList.toggle("hidden", !needsUrl);
    fileField.classList.toggle("hidden", !needsFile);
    dueField.classList.toggle("hidden", type !== "assignment");
    urlInput.required = needsUrl;
    fileInput.required = needsFile;
    if (!needsFile) fileInput.value = "";
    $("#material-description", backdrop).required = !needsFile;
    $("#material-url-label", backdrop).textContent = type === "video" ? "Video URL" : "Dropbox URL";
    $("#material-description-label", backdrop).textContent = needsFile
      ? "Description (optional)"
      : ["quiz", "practice"].includes(type) ? "Questions and instructions"
        : type === "forum" ? "Forum post" : type === "assignment" ? "Assignment instructions" : "Content / instructions";
    $("#material-description", backdrop).placeholder = type === "quiz"
      ? "Write quiz questions and answer choices for your students"
      : type === "practice" ? "Write practice questions for students to work through"
        : type === "forum" ? "Share a discussion prompt or question with your class"
          : type === "lesson" ? "Write lesson notes or learning instructions"
            : "Write the notes, activity, or instructions for your students";
  };
  typeSelect.addEventListener("change", updateMaterialFields);
  updateMaterialFields();

  $("#material-form", backdrop).addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const type = String(formData.get("type"));
    const title = String(formData.get("title")).trim();
    const description = String(formData.get("description")).trim();
    const subjectId = String(formData.get("subjectId"));
    const url = String(formData.get("url") || "").trim();
    const attachment = formData.get("attachment");
    const availableAtInput = String(formData.get("availableAt") || "");
    const availableAt = availableAtInput ? new Date(availableAtInput).getTime() : null;
    const error = $("#material-error", backdrop);
    const needsFile = type === "textbook" || type === "exam-paper";
    const allowedFile = attachment instanceof File && /\.(pdf|doc|docx|odt)$/i.test(attachment.name);
    if (!types.some(([value]) => value === type) || !assignedSubjects.some((subject) => subject.id === subjectId) || !title || (!needsFile && !description)) {
      error.textContent = "Choose a subject and enter a title and the required content.";
      return;
    }
    if (needsFile && (!allowedFile || attachment.size === 0 || attachment.size > 50 * 1024 * 1024)) {
      error.textContent = "Choose a non-empty PDF, DOC, DOCX or ODT file no larger than 50 MB.";
      return;
    }
    if (availableAtInput && (!Number.isFinite(availableAt) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(availableAtInput))) {
      error.textContent = "Choose a valid date and time to release this post.";
      return;
    }
    if ((type === "video" || type === "dropbox") && !isSafeExternalUrl(url)) {
      error.textContent = "Enter a valid link beginning with https:// or http://.";
      return;
    }
    if (url && !isSafeExternalUrl(url)) {
      error.textContent = "Resource links must begin with https:// or http://.";
      return;
    }
    const dueDate = String(formData.get("dueDate") || "");
    const materialId = `material-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const material = {
      id: materialId,
      type,
      title,
      description,
      url,
      dueDate,
      ...(needsFile ? { attachmentId: materialId } : {}),
      ...(availableAt !== null ? { availableAt } : {}),
      classId: myClass.id,
      subjectId,
      teacherId: currentUser.tpfNumber,
      studentIds: assignedStudents.map((student) => student.femisId),
      teacherName: currentUser.name,
      createdAt: Date.now(),
    };
    const submitButton = $('button[type="submit"]', event.currentTarget);
    submitButton.disabled = true;
    error.textContent = "";
    try {
      if (needsFile) await storeAttachment(materialId, attachment);
      materials.unshift(material);
      await saveStorage(STORAGE_KEYS.materials, materials);
    } catch (saveError) {
      materials = materials.filter((item) => item.id !== materialId);
      if (needsFile) await deleteAttachments([{ attachmentId: materialId }]);
      error.textContent = saveError.message || "Could not save this material. Check browser storage and try again.";
      submitButton.disabled = false;
      return;
    }
    close();
    renderPortal();
    showToast(availableAt !== null && availableAt > Date.now()
      ? `${materialTypeLabel(type)} scheduled for ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(availableAt)}.`
      : `${materialTypeLabel(type)} published to ${myClass.name}.`);
  });
}

function showTermDatesModal() {
  const myClass = getAccountClass(currentUser);
  if (!myClass || currentUser.role !== "teacher") {
    showToast("Ask your administrator to assign your class before setting term dates.");
    return;
  }
  const termDates = myClass.termStartDates || [myClass.termStartDate || "", "", ""];
  const { backdrop, close } = showModal("Set term dates", `Set the start dates for each term in ${escapeHTML(myClass.name)}. Terms 1 and 2 have 14 weeks each; Term 3 has 13 weeks.`, `
    <form class="admin-form" id="term-dates-form">
      <div class="form-grid">
        <div class="full-width"><label for="term-start-date-1">Term 1 start date (14 weeks)</label><input id="term-start-date-1" name="termStartDate1" type="date" required value="${escapeHTML(termDates[0] || "")}"></div>
        <div class="full-width"><label for="term-start-date-2">Term 2 start date (14 weeks)</label><input id="term-start-date-2" name="termStartDate2" type="date" required value="${escapeHTML(termDates[1] || "")}"></div>
        <div class="full-width"><label for="term-start-date-3">Term 3 start date (13 weeks)</label><input id="term-start-date-3" name="termStartDate3" type="date" required value="${escapeHTML(termDates[2] || "")}"><p class="select-help">Each week runs for seven days from its start date. Term start dates must follow the end of the previous term.</p></div>
      </div>
      <div class="admin-form-actions"><button class="button button-dark" type="submit">Save term dates</button><p class="form-message" id="term-dates-error" aria-live="polite"></p></div>
    </form>
  `);
  $("#term-dates-form", backdrop).addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const dates = [1, 2, 3].map((termNumber) => String(formData.get(`termStartDate${termNumber}`) || ""));
    const parsedDates = dates.map((date) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      const parsed = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
      const formatted = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
      return Number.isNaN(parsed.getTime()) || formatted !== date ? null : parsed;
    });
    if (parsedDates.some((date) => !date)) {
      $("#term-dates-error", backdrop).textContent = "Enter a valid start date for all three terms.";
      return;
    }
    const termLengths = [14, 14, 13];
    for (let index = 0; index < parsedDates.length - 1; index += 1) {
      const minimumNextStart = new Date(parsedDates[index]);
      minimumNextStart.setDate(minimumNextStart.getDate() + termLengths[index] * 7);
      if (parsedDates[index + 1] < minimumNextStart) {
        $("#term-dates-error", backdrop).textContent = `Term ${index + 2} must start after Term ${index + 1}'s ${termLengths[index]} weeks have finished.`;
        return;
      }
    }
    myClass.termStartDates = dates;
    delete myClass.termStartDate;
    try {
      await saveStorage(STORAGE_KEYS.classes, classes);
    } catch (error) {
      $("#term-dates-error", backdrop).textContent = error.message || "Could not save term dates.";
      return;
    }
    close();
    renderPortal();
    showToast(`Term dates for ${myClass.name} were updated.`);
  });
}

function isSafeExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function renderPasswordView() {
  return `${portalHeading("ACCOUNT SETTINGS", "Change password", "Choose a new password for your account.")}<section class="portal-panel"><div class="panel-heading"><h3>Password security</h3><span>${escapeHTML(accountIdentifier(currentUser) || currentUser.email || "")}</span></div><p class="portal-subtitle">Enter your current password, then choose a new one.</p><button class="button button-dark" type="button" data-action="new-password">Update password</button></section>`;
}

function showPasswordModal() {
  const { backdrop, close } = showModal("Change your password", "Choose a new password you can remember.", `
    <form class="admin-form" id="password-form">
      <div class="form-grid">
        <div class="full-width"><label for="current-password">Current password</label><input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required></div>
        <div class="full-width"><label for="new-user-password">New password</label><input id="new-user-password" name="newPassword" type="password" autocomplete="new-password" minlength="6" maxlength="100" required placeholder="At least 6 characters"></div>
        <div class="full-width"><label for="confirm-password">Confirm new password</label><input id="confirm-password" name="confirmPassword" type="password" autocomplete="new-password" minlength="6" maxlength="100" required></div>
      </div>
      <div class="admin-form-actions"><button class="button button-dark" type="submit">Save new password</button><p class="form-message" id="password-error" aria-live="polite"></p></div>
    </form>
  `);
  $("#password-form", backdrop).addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const currentPassword = String(formData.get("currentPassword"));
    const newPassword = String(formData.get("newPassword"));
    const confirmPassword = String(formData.get("confirmPassword"));
    const error = $("#password-error", backdrop);
    if (newPassword.length < 6) { error.textContent = "Your new password must be at least 6 characters."; return; }
    if (newPassword !== confirmPassword) { error.textContent = "The new passwords do not match."; return; }
    try {
      await window.SachinelearnFirebase.changePassword(currentPassword, newPassword);
    } catch (passwordError) {
      error.textContent = passwordError.code === "auth/wrong-password" || passwordError.code === "auth/invalid-credential"
        ? "Your current password is incorrect."
        : passwordError.message || "Could not update your password.";
      return;
    }
    close();
    showToast("Your password has been changed.");
  });
}

async function removeAccount(role, identifier) {
  const account = accounts.find((item) => item.role === role
    && normalizedIdentifier(accountIdentifier(item) || item.email) === normalizedIdentifier(identifier));
  if (!account) return;
  if (!window.confirm(`Deactivate ${account.name}'s sign-in? The Firebase login will be retained but blocked until you reactivate this profile.`)) return;
  account.disabled = true;
  try {
    await saveStorage(STORAGE_KEYS.accounts, accounts);
  } catch (error) {
    showToast(error.message || "Could not deactivate this account.");
    return;
  }
  renderPortal();
  showToast(`${account.name}'s profile was deactivated.`);
}

async function reactivateAccount(role, identifier) {
  const account = accounts.find((item) => item.role === role
    && normalizedIdentifier(accountIdentifier(item)) === normalizedIdentifier(identifier));
  if (!account || !account.disabled) return;
  account.disabled = false;
  try {
    await saveStorage(STORAGE_KEYS.accounts, accounts);
  } catch (error) {
    account.disabled = true;
    showToast(error.message || "Could not reactivate this account.");
    return;
  }
  renderPortal();
  showToast(`${account.name}'s profile was reactivated.`);
}

async function removeClass(classId) {
  const classItem = classes.find((item) => item.id === classId);
  if (!classItem) return;
  const classAccounts = accounts.filter((account) => account.classId === classId);
  const studentCount = classAccounts.filter((account) => account.role === "student").length;
  const teacherCount = classAccounts.filter((account) => account.role === "teacher").length;
  const materialCount = materials.filter((item) => item.classId === classId).length;
  const details = [
    studentCount ? `${studentCount} student${studentCount === 1 ? "" : "s"}` : "",
    teacherCount ? `${teacherCount} teacher${teacherCount === 1 ? "" : "s"}` : "",
    classItem.subjects.length ? `${classItem.subjects.length} subject${classItem.subjects.length === 1 ? "" : "s"}` : "",
    materialCount ? `${materialCount} material${materialCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  const impact = details.length ? ` This also removes ${details.join(", ")}.` : "";
  if (!window.confirm(`Remove the ${classItem.name} class?${impact} Accounts will be retained without a class assignment.`)) return;
  const removedMaterials = materials.filter((item) => item.classId === classId);
  classes = classes.filter((item) => item.id !== classId);
  accounts.forEach((account) => {
    if (account.classId === classId) {
      account.classId = "";
      account.subjectIds = [];
      delete account.teacherTpf;
      account.studentIds = [];
    }
  });
  materials = materials.filter((item) => item.classId !== classId);
  liveClasses = liveClasses.filter((item) => item.classId !== classId);
  try {
    await saveStorage(STORAGE_KEYS.classes, classes);
    await saveStorage(STORAGE_KEYS.accounts, accounts);
    await saveStorage(STORAGE_KEYS.materials, materials);
    await saveStorage(STORAGE_KEYS.liveClasses, liveClasses);
  } catch (error) {
    showToast(error.message || "Could not remove the class and its data.");
    return;
  }
  await deleteAttachments(removedMaterials);
  renderPrograms();
  renderPortal();
  showToast(`${classItem.name} and its class data were removed.`);
}

async function removeSubject(classId, subjectId) {
  const classItem = classes.find((item) => item.id === classId);
  const subject = classItem?.subjects.find((item) => item.id === subjectId);
  if (!classItem || !subject) return;
  const materialCount = materials.filter((item) => item.classId === classId && item.subjectId === subjectId).length;
  const impact = materialCount ? ` This also removes ${materialCount} related material${materialCount === 1 ? "" : "s"}.` : "";
  if (!window.confirm(`Remove ${subject.name} from ${classItem.name}?${impact} Student and teacher assignments to it will be removed.`)) return;
  const removedMaterials = materials.filter((item) => item.classId === classId && item.subjectId === subjectId);
  classItem.subjects = classItem.subjects.filter((item) => item.id !== subjectId);
  accounts.forEach((account) => {
    if (account.classId === classId) {
      account.subjectIds = (account.subjectIds || []).filter((id) => id !== subjectId);
    }
  });
  materials = materials.filter((item) => item.classId !== classId || item.subjectId !== subjectId);
  liveClasses = liveClasses.filter((item) => item.classId !== classId || item.subjectId !== subjectId);
  try {
    await saveStorage(STORAGE_KEYS.classes, classes);
    await saveStorage(STORAGE_KEYS.accounts, accounts);
    await saveStorage(STORAGE_KEYS.materials, materials);
    await saveStorage(STORAGE_KEYS.liveClasses, liveClasses);
  } catch (error) {
    showToast(error.message || "Could not remove this subject.");
    return;
  }
  await deleteAttachments(removedMaterials);
  renderPrograms();
  renderPortal();
  showToast(`${subject.name} was removed from ${classItem.name}.`);
}

$$(".role-tab").forEach((tab) => tab.addEventListener("click", () => setActiveRole(tab.dataset.role)));
$("#login-form").addEventListener("submit", signIn);
$("#signout-button").addEventListener("click", signOut);
setActiveRole("student");
$("#current-year").textContent = new Date().getFullYear();
renderPrograms();
window.SachinelearnFirebase.loadPublicClasses()
  .then((publicClasses) => {
    classes = publicClasses;
    renderPrograms();
  })
  .catch((error) => {
    showToast(error.message || "Could not load academy subjects from Firebase.");
  });
