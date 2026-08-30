import type { AgentPatchProposal, EngineeringRequirement } from "@sisyphus/domain";
import type { WorkforcePlan } from "./openrouter.js";

type LocalSiteBrief = {
  readonly name: string;
  readonly topic: string;
  readonly productStatement: string;
  readonly actionLabel: string;
  readonly focusLabel: string;
  readonly includesSisyphus: boolean;
};

export function createLocalStaticFallbackPlan(request: string): WorkforcePlan {
  const brief = localSiteBrief(request);
  return {
    specification: `Deliver a responsive browser-only prototype for ${brief.name} that runs without generated package commands.`,
    requirements: [
      {
        id: "REQ-01",
        title: `Build the ${brief.name} local web prototype`,
        acceptanceCriteria: [
          "Creates a complete responsive browser experience with semantic HTML, dedicated styling, and client-side interaction logic.",
          "Presents the requested product or brand directly in the document title and primary page heading.",
          "Runs as a dependency-free static site that the guarded local executor can serve and verify on loopback.",
        ],
        specialistRole: "frontend",
      },
    ],
  };
}

export function createLocalStaticFallbackProposal(input: {
  readonly request: string;
  readonly requirement: Pick<EngineeringRequirement, "id" | "title">;
  readonly iteration: number;
}): AgentPatchProposal {
  const brief = localSiteBrief(input.request);
  return {
    safeActivity: "editing-files",
    safeActivityDetail: `Built a browser-only ${brief.name} prototype for local preview.`,
    summary: `Created a dependency-free local web prototype for ${brief.name} after selecting the local static execution path.`,
    files: [
      { path: "index.html", content: html({ brief, requirement: input.requirement }) },
      { path: "styles.css", content: styles() },
      { path: "script.js", content: script() },
    ],
  };
}

function localSiteBrief(request: string): LocalSiteBrief {
  const normalized = request.replaceAll(/\s+/gu, " ").trim();
  const lower = normalized.toLowerCase();
  const name = namedSubject(normalized) ?? "Studio Edit";
  const isCommerce = /\b(?:shop|store|clothing|fashion|dress|product|catalog|retail)\b/iu.test(lower);
  const isAuthentication = /\b(?:auth(?:entication)?|login|sign[ -]?in|register|account|dashboard)\b/iu.test(lower);
  const includesSisyphus = /\bsisyphus\b/iu.test(lower);
  if (isAuthentication) {
    return {
      name,
      topic: "a deliberate account experience",
      productStatement: "A polished front-end flow for access, identity, and a focused member dashboard.",
      actionLabel: "Open account preview",
      focusLabel: "Account flow",
      includesSisyphus,
    };
  }
  if (isCommerce) {
    return {
      name,
      topic: "a considered digital storefront",
      productStatement: "A shopping experience that gives the edit, the products, and the next action equal weight.",
      actionLabel: "Explore the edit",
      focusLabel: "Product edit",
      includesSisyphus,
    };
  }
  return {
    name,
    topic: "a focused digital launch",
    productStatement: "A clear narrative, a purposeful interface, and an interaction layer that makes the brief tangible.",
    actionLabel: "See the prototype",
    focusLabel: "Launch preview",
    includesSisyphus,
  };
}

function namedSubject(request: string): string | undefined {
  const zudio = request.match(/\bzudio\b/iu);
  if (zudio !== null) return "Zudio";
  const match = request.match(/\b(?:for|called|named)\s+([A-Za-z0-9][A-Za-z0-9 '&-]{1,44})/iu);
  if (match?.[1] === undefined) return undefined;
  const candidate = match[1]
    .replace(/\b(?:with|that|where|and)\b.*$/iu, "")
    .trim()
    .replaceAll(/\s+/gu, " ");
  return candidate.length >= 2 ? candidate : undefined;
}

function html(input: {
  readonly brief: LocalSiteBrief;
  readonly requirement: Pick<EngineeringRequirement, "id" | "title">;
}): string {
  const name = escapeHtml(input.brief.name);
  const topic = escapeHtml(input.brief.topic);
  const statement = escapeHtml(input.brief.productStatement);
  const action = escapeHtml(input.brief.actionLabel);
  const focus = escapeHtml(input.brief.focusLabel);
  const requirement = escapeHtml(input.requirement.title);
  const sisyphusNote = input.brief.includesSisyphus
    ? '<p class="hero__note">Sisyphus gives an AI Engineering HR team a shared view of who is building, reviewing, and shipping each project.</p>'
    : '<p class="hero__note">Built as a working browser prototype. Interactions run locally and no generated commands run on this machine.</p>';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${name} local web prototype">
    <title>${name} | Sisyphus local prototype</title>
    <link rel="stylesheet" href="styles.css">
    <script src="script.js" defer></script>
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <a class="wordmark" href="#top" aria-label="${name} home"><span>01</span>${name}</a>
      <button class="menu-button" type="button" data-menu-button aria-expanded="false" aria-controls="site-navigation">Menu</button>
      <nav id="site-navigation" class="site-nav" data-menu>
        <a href="#edit">The edit</a>
        <a href="#approach">Approach</a>
        <a href="#contact">Visit</a>
      </nav>
    </header>

    <main id="main">
      <section id="top" class="hero" aria-labelledby="hero-title">
        <div class="hero__copy" data-reveal>
          <p class="eyebrow">${focus} / 2026</p>
          <h1 id="hero-title">${name} makes room for a sharper point of view.</h1>
          <p class="hero__lede">${statement}</p>
          ${sisyphusNote}
          <div class="hero__actions">
            <a class="button button--ink" href="#edit">${action}</a>
            <button class="text-button" type="button" data-open-panel>What is this?</button>
          </div>
        </div>
        <div class="hero__art" aria-hidden="true" data-reveal>
          <span class="hero__shape hero__shape--one"></span>
          <span class="hero__shape hero__shape--two"></span>
          <span class="hero__caption">${topic}</span>
        </div>
      </section>

      <section id="edit" class="edit" aria-labelledby="edit-title">
        <div class="section-heading" data-reveal>
          <p class="eyebrow">Selected moments</p>
          <h2 id="edit-title">Less noise. More intent.</h2>
          <p>Each card reacts to your attention. Save a look, then open its short story.</p>
        </div>
        <div class="product-grid">
          <article class="product-card" data-reveal>
            <div class="product-card__image product-card__image--clay"><span>01</span></div>
            <div class="product-card__meta"><h3>After hours</h3><p>Soft structure, clear lines.</p></div>
            <button class="save-button" type="button" data-save aria-pressed="false">Save <span aria-hidden="true">+</span></button>
          </article>
          <article class="product-card product-card--shift" data-reveal>
            <div class="product-card__image product-card__image--blue"><span>02</span></div>
            <div class="product-card__meta"><h3>Daily measure</h3><p>Pieces chosen for repeat wear.</p></div>
            <button class="save-button" type="button" data-save aria-pressed="false">Save <span aria-hidden="true">+</span></button>
          </article>
          <article class="product-card" data-reveal>
            <div class="product-card__image product-card__image--lime"><span>03</span></div>
            <div class="product-card__meta"><h3>Bright side</h3><p>A little colour changes the pace.</p></div>
            <button class="save-button" type="button" data-save aria-pressed="false">Save <span aria-hidden="true">+</span></button>
          </article>
        </div>
      </section>

      <section id="approach" class="manifesto" aria-labelledby="approach-title">
        <p class="manifesto__number" aria-hidden="true">/ 02</p>
        <div data-reveal>
          <p class="eyebrow">The approach</p>
          <h2 id="approach-title">A local site should still feel finished.</h2>
          <p>Typography, spacing, colour, and motion are all doing the same job: moving someone from curiosity to a clear next step.</p>
          <p class="manifesto__detail">Current task: ${requirement}</p>
        </div>
      </section>

      <section id="contact" class="contact" aria-labelledby="contact-title">
        <div data-reveal>
          <p class="eyebrow">Stay in the loop</p>
          <h2 id="contact-title">A new edit, when it is worth opening.</h2>
        </div>
        <form class="signup" data-signup novalidate>
          <label for="email">Email address</label>
          <div class="signup__row">
            <input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required>
            <button class="button button--acid" type="submit">Join</button>
          </div>
          <p class="form-message" data-form-message role="status"></p>
        </form>
      </section>
    </main>

    <footer class="site-footer"><span>${name}</span><span>Local static delivery by Sisyphus</span><span>© 2026</span></footer>
    <dialog class="info-panel" data-info-panel aria-labelledby="panel-title">
      <div>
        <button class="close-button" type="button" data-close-panel aria-label="Close information panel">×</button>
        <p class="eyebrow">Local static fallback</p>
        <h2 id="panel-title">This is a real browser experience, delivered without a server.</h2>
        <p>The fallback writes separate structure, style, and interaction files. It is for safe local previews. Server, API, and database work belongs in the AWS sandbox path.</p>
      </div>
    </dialog>
  </body>
</html>`;
}

function styles(): string {
  return `:root {
  color-scheme: light;
  --ink: #1b2430;
  --paper: #f4f0e8;
  --acid: #d9ff4f;
  --clay: #e88464;
  --blue: #8aa9d7;
  --lime: #a6c98d;
  --line: rgba(27, 36, 48, 0.18);
  --serif: Georgia, "Times New Roman", serif;
  --sans: Inter, ui-sans-serif, system-ui, sans-serif;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--sans); }
button, input { font: inherit; }
button { cursor: pointer; }
a { color: inherit; text-decoration: none; }
.skip-link { position: fixed; left: 1rem; top: -5rem; z-index: 10; background: var(--ink); color: var(--paper); padding: .75rem 1rem; }
.skip-link:focus { top: 1rem; }
.site-header { align-items: center; border-bottom: 1px solid var(--line); display: grid; grid-template-columns: 1fr auto; min-height: 5.4rem; padding: 0 4.5vw; position: relative; }
.wordmark { font-size: 1.12rem; font-weight: 800; letter-spacing: -.05em; }
.wordmark span { color: #61717f; font-size: .7rem; letter-spacing: .08em; margin-right: .6rem; vertical-align: middle; }
.site-nav { display: flex; gap: 1.7rem; font-size: .82rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
.site-nav a { border-bottom: 1px solid transparent; padding: .4rem 0; }
.site-nav a:hover, .site-nav a:focus-visible { border-color: var(--ink); }
.menu-button { display: none; }
.hero { display: grid; gap: 2rem; grid-template-columns: 1.1fr .9fr; min-height: 42rem; padding: 6rem 7vw 5rem; }
.hero__copy { align-self: center; max-width: 44rem; }
.eyebrow { font-size: .7rem; font-weight: 800; letter-spacing: .13em; margin: 0 0 1.1rem; text-transform: uppercase; }
h1, h2, h3, p { margin-top: 0; }
h1, h2 { font-family: var(--serif); font-weight: 400; letter-spacing: -.06em; }
h1 { font-size: clamp(3.4rem, 7.3vw, 7.4rem); line-height: .88; margin-bottom: 2rem; }
h2 { font-size: clamp(2.5rem, 4.6vw, 5rem); line-height: .94; }
.hero__lede { font-size: clamp(1.05rem, 1.5vw, 1.35rem); line-height: 1.55; max-width: 34rem; }
.hero__note { border-left: 2px solid var(--acid); font-size: .86rem; line-height: 1.55; margin: 1.5rem 0 2rem; max-width: 33rem; padding-left: .8rem; }
.hero__actions { align-items: center; display: flex; flex-wrap: wrap; gap: 1.2rem; }
.button { align-items: center; border: 1px solid var(--ink); display: inline-flex; font-size: .78rem; font-weight: 800; justify-content: center; letter-spacing: .09em; min-height: 3.2rem; padding: 0 1.4rem; text-transform: uppercase; transition: transform 180ms ease, box-shadow 180ms ease; }
.button:hover, .button:focus-visible { box-shadow: 5px 5px 0 var(--ink); transform: translate(-3px, -3px); }
.button--ink { background: var(--ink); color: var(--paper); }
.button--acid { background: var(--acid); color: var(--ink); }
.text-button { background: transparent; border: 0; border-bottom: 1px solid var(--ink); color: var(--ink); font-size: .82rem; padding: .35rem 0; }
.hero__art { background: var(--ink); min-height: 28rem; overflow: hidden; position: relative; }
.hero__shape { display: block; position: absolute; transition: transform 500ms cubic-bezier(.2,.8,.2,1); }
.hero__shape--one { background: var(--clay); border-radius: 50% 42% 24% 50%; height: 18rem; left: 12%; top: 16%; transform: rotate(-17deg); width: 13rem; }
.hero__shape--two { background: var(--acid); bottom: -8%; clip-path: polygon(0 0, 100% 19%, 82% 100%, 9% 84%); height: 17rem; right: -3%; width: 18rem; }
.hero__art:hover .hero__shape--one { transform: rotate(-6deg) translate(1.1rem, -.7rem); }
.hero__art:hover .hero__shape--two { transform: rotate(8deg) translate(-.8rem, -1.2rem); }
.hero__caption { bottom: 1.5rem; color: var(--paper); font-family: var(--serif); font-size: 1.15rem; left: 1.5rem; max-width: 13rem; position: absolute; }
.edit { border-top: 1px solid var(--line); padding: 6.5rem 7vw; }
.section-heading { display: grid; grid-template-columns: .8fr 1.2fr; margin-bottom: 4rem; }
.section-heading h2 { grid-column: 2; margin: 0 0 1rem; }
.section-heading > p:last-child { grid-column: 2; line-height: 1.6; max-width: 27rem; }
.product-grid { display: grid; gap: clamp(1rem, 2.5vw, 2.5rem); grid-template-columns: repeat(3, 1fr); }
.product-card { position: relative; }
.product-card--shift { margin-top: 5rem; }
.product-card__image { align-items: flex-end; display: flex; font-family: var(--serif); font-size: 6rem; justify-content: flex-end; min-height: 25rem; overflow: hidden; padding: 1rem; transition: transform 250ms ease; }
.product-card:hover .product-card__image { transform: translateY(-.5rem); }
.product-card__image--clay { background: var(--clay); }
.product-card__image--blue { background: var(--blue); }
.product-card__image--lime { background: var(--lime); }
.product-card__meta { border-bottom: 1px solid var(--line); padding: 1.1rem 0 1.3rem; }
.product-card__meta h3 { font-size: 1rem; margin-bottom: .35rem; }
.product-card__meta p { color: #53616d; font-size: .86rem; margin: 0; }
.save-button { background: var(--paper); border: 1px solid var(--ink); border-radius: 1.2rem; font-size: .7rem; font-weight: 800; padding: .45rem .75rem; position: absolute; right: .8rem; top: .8rem; }
.save-button:hover, .save-button[aria-pressed="true"] { background: var(--ink); color: var(--paper); }
.manifesto { background: var(--acid); display: grid; gap: 2rem; grid-template-columns: .45fr 1fr; padding: 7rem 12vw; }
.manifesto__number { font-family: var(--serif); font-size: 2.2rem; }
.manifesto h2 { margin-bottom: 1.5rem; max-width: 42rem; }
.manifesto div > p { line-height: 1.65; max-width: 38rem; }
.manifesto__detail { border-top: 1px solid var(--ink); font-size: .78rem; margin-top: 2.5rem; padding-top: 1rem; }
.contact { display: grid; gap: 3rem; grid-template-columns: 1fr 1fr; padding: 7rem 7vw; }
.contact h2 { margin-bottom: 0; max-width: 34rem; }
.signup { align-self: end; }
.signup label { display: block; font-size: .73rem; font-weight: 800; letter-spacing: .09em; margin-bottom: .65rem; text-transform: uppercase; }
.signup__row { display: flex; }
.signup input { background: transparent; border: 0; border-bottom: 1px solid var(--ink); min-height: 3.2rem; min-width: 0; padding: 0 .65rem; width: 100%; }
.signup input:focus { outline: 2px solid var(--ink); outline-offset: 2px; }
.form-message { font-size: .86rem; min-height: 1.4rem; margin: .75rem 0 0; }
.site-footer { border-top: 1px solid var(--line); display: flex; font-size: .72rem; font-weight: 700; justify-content: space-between; letter-spacing: .06em; padding: 1.4rem 4.5vw; text-transform: uppercase; }
.info-panel { background: var(--ink); border: 0; color: var(--paper); max-width: 38rem; padding: 2.5rem; }
.info-panel::backdrop { background: rgba(27, 36, 48, .72); }
.info-panel h2 { letter-spacing: -.04em; }
.info-panel p { line-height: 1.6; }
.close-button { background: transparent; border: 0; color: inherit; float: right; font-size: 2rem; line-height: 1; }
[data-reveal] { opacity: 0; transform: translateY(1.5rem); transition: opacity 550ms ease, transform 550ms ease; }
[data-reveal].is-visible { opacity: 1; transform: translateY(0); }
@media (max-width: 760px) {
  .site-header { min-height: 4.6rem; }
  .menu-button { background: transparent; border: 0; display: block; font-size: .75rem; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .site-nav { background: var(--paper); border-bottom: 1px solid var(--line); display: none; left: 0; padding: 1rem 4.5vw 1.5rem; position: absolute; right: 0; top: 100%; z-index: 4; }
  .site-nav.is-open { display: grid; gap: .6rem; }
  .hero, .contact, .manifesto { grid-template-columns: 1fr; }
  .hero { min-height: auto; padding: 4.5rem 7vw; }
  .hero__art { min-height: 20rem; }
  .section-heading { display: block; }
  .section-heading .eyebrow { margin-bottom: 2rem; }
  .product-grid { grid-template-columns: 1fr; }
  .product-card--shift { margin-top: 0; }
  .product-card__image { min-height: 18rem; }
  .manifesto { padding: 4.5rem 7vw; }
  .contact { padding: 4.5rem 7vw; }
  .site-footer { align-items: flex-start; flex-direction: column; gap: .6rem; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
  [data-reveal] { opacity: 1; transform: none; }
}`;
}

function script(): string {
  return `const menuButton = document.querySelector('[data-menu-button]');
const menu = document.querySelector('[data-menu]');
const panel = document.querySelector('[data-info-panel]');
const panelOpener = document.querySelector('[data-open-panel]');
const panelCloser = document.querySelector('[data-close-panel]');
const form = document.querySelector('[data-signup]');
const formMessage = document.querySelector('[data-form-message]');

menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!open));
  menu?.classList.toggle('is-open', !open);
});

menu?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuButton?.setAttribute('aria-expanded', 'false');
    menu?.classList.remove('is-open');
  });
});

panelOpener?.addEventListener('click', () => panel?.showModal());
panelCloser?.addEventListener('click', () => panel?.close());
panel?.addEventListener('click', (event) => {
  if (event.target === panel) panel.close();
});

document.querySelectorAll('[data-save]').forEach((button) => {
  button.addEventListener('click', () => {
    const saved = button.getAttribute('aria-pressed') === 'true';
    button.setAttribute('aria-pressed', String(!saved));
    button.firstChild.textContent = saved ? 'Save ' : 'Saved ';
    const symbol = button.querySelector('span');
    if (symbol) symbol.textContent = saved ? '+' : '✓';
  });
});

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const email = form.querySelector('input[type="email"]');
  if (!(email instanceof HTMLInputElement) || !email.validity.valid) {
    if (email instanceof HTMLInputElement) email.focus();
    if (formMessage) formMessage.textContent = 'Enter a valid email to continue.';
    return;
  }
  if (formMessage) formMessage.textContent = 'You are on the local preview list.';
  form.reset();
});

const reveal = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.15 });
  reveal.forEach((element) => observer.observe(element));
} else {
  reveal.forEach((element) => element.classList.add('is-visible'));
}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
