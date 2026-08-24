import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const defaults = {
  site: {
    artistName: "Eduardo Wolffel",
    email: "hello@drkprty.uk",
    availableLabel: "Available",
    soldLabel: "Sold"
  },
  works: [
    { id: "work-01", title: "Untitled I", year: "2026", dimensions: "100 × 80 cm", medium: "Acrylic on canvas", status: "available", image: "assets/work-01.svg", order: 0 },
    { id: "work-02", title: "Untitled II", year: "2026", dimensions: "120 × 100 cm", medium: "Mixed media on canvas", status: "available", image: "assets/work-02.svg", order: 1 },
    { id: "work-03", title: "Untitled III", year: "2026", dimensions: "90 × 120 cm", medium: "Acrylic on canvas", status: "sold", image: "assets/work-03.svg", order: 2 }
  ]
};

let siteContent = structuredClone(defaults);
const grid = document.querySelector("#works-grid");
const footerYear = document.querySelector("#footer-year");
const navLinks = [...document.querySelectorAll(".nav-link")];
const menuToggle = document.querySelector(".menu-toggle");
const siteMenu = document.querySelector(".site-menu");

function esc(value="") { return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function applySiteText() {
  const { artistName, email, availableLabel, soldLabel } = siteContent.site;
  document.title = artistName || "Eduardo Wolffel";
  document.querySelectorAll('.artist-name, .site-footer-inner span:first-child').forEach(el => el.textContent = artistName || 'Eduardo Wolffel');
  const emailEl = document.querySelector('.contact-email');
  emailEl.textContent = email || 'hello@drkprty.uk';
  emailEl.href = `mailto:${email || 'hello@drkprty.uk'}`;
  const labels = document.querySelectorAll('.availability-key span');
  if (labels[0]) labels[0].lastChild.textContent = ` ${availableLabel || 'Available'}`;
  if (labels[1]) labels[1].lastChild.textContent = ` ${soldLabel || 'Sold'}`;
}

function renderWorks() {
  grid.innerHTML = siteContent.works.map((work, index) => `
    <article class="work-card" style="--reveal-delay: ${index % 3 * 90}ms">
      <div class="work-image-wrap">
        <img class="work-image" src="${esc(work.image)}" alt="${esc(work.title)}, ${esc(work.year)}" loading="${index < 4 ? "eager" : "lazy"}" />
      </div>
      <div class="work-details">
        <div class="work-title-row">
          <h2 class="work-title">${esc(work.title)}, ${esc(work.year)}</h2>
          <i class="status-dot ${work.status === 'sold' ? 'sold' : 'available'}" aria-label="${esc(work.status)}"></i>
        </div>
        <p class="work-meta">${esc(work.dimensions)}<br>${esc(work.medium)}</p>
      </div>
    </article>
  `).join("");
}

function setMenu(open) {
  if (window.innerWidth > 760) open = false;
  menuToggle.classList.toggle("is-open", open);
  siteMenu.classList.toggle("is-open", open);
  document.body.classList.toggle("menu-open", open);
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
}

menuToggle.addEventListener("click", () => setMenu(!siteMenu.classList.contains("is-open")));
navLinks.forEach(link => link.addEventListener("click", () => setMenu(false)));
document.addEventListener("click", event => { if (!siteMenu.contains(event.target) && !menuToggle.contains(event.target)) setMenu(false); });

function updateActiveNav() {
  const contact = document.querySelector("#contact");
  const isContact = window.scrollY + window.innerHeight * 0.35 >= contact.offsetTop;
  navLinks.forEach(link => link.classList.toggle("is-active", (isContact && link.getAttribute("href") === "#contact") || (!isContact && link.getAttribute("href") === "#works")));
}

function initScrollReveal() {
  const cards=[...document.querySelectorAll('.work-card')];
  if(!cards.length)return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches||!('IntersectionObserver'in window)){cards.forEach(c=>c.classList.add('is-visible'));return}
  document.body.classList.add('reveal-ready');
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');observer.unobserve(entry.target)}}),{threshold:.16,rootMargin:'0px 0px -8% 0px'});
  cards.forEach(card=>observer.observe(card));
}

async function loadContent() {
  try {
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const settingsSnap = await getDoc(doc(db, "siteContent", "main"));
    if (settingsSnap.exists()) siteContent.site = { ...siteContent.site, ...settingsSnap.data() };

    const worksSnap = await getDocs(query(collection(db, "works"), orderBy("order", "asc")));
    if (!worksSnap.empty) {
      siteContent.works = worksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
  } catch (error) {
    console.warn("Firestore unavailable; using local starter content.", error);
  }

  applySiteText();
  renderWorks();
  initScrollReveal();
  updateActiveNav();
}

footerYear.textContent=`© ${new Date().getFullYear()}`;
window.addEventListener('scroll',updateActiveNav,{passive:true});
window.addEventListener('resize',()=>{if(window.innerWidth>760)setMenu(false)});
loadContent();
