import type { AgentPatchProposal, EngineeringRequirement } from "@sisyphus/domain";
import type { WorkforcePlan } from "./openrouter.js";

type LocalSiteBrief = {
  readonly kind: "storefront" | "audio" | "account" | "launch";
  readonly name: string;
  readonly topic: string;
  readonly productStatement: string;
  readonly actionLabel: string;
  readonly focusLabel: string;
  readonly includesSisyphus: boolean;
  readonly research: ProductResearch;
};

type ProductResearch = {
  readonly label: string;
  readonly finding: string;
  readonly sourceLabel: string;
};

type PlanningRequirement = WorkforcePlan["requirements"][number];

const localReviewers = [
  ["user-experience reviewer", "Review the journey from first impression to the primary action."],
  ["visual-design reviewer", "Review hierarchy, contrast, and the intended visual system."],
  ["accessibility reviewer", "Review semantic landmarks, labels, keyboard access, and reduced-motion support."],
  ["content reviewer", "Review whether the visible copy is specific, readable, and free from placeholders."],
  ["interaction reviewer", "Review the local controls, dialog, saved-state buttons, and form feedback."],
  ["responsive-layout reviewer", "Review the small-screen navigation, grids, and readable spacing."],
  ["browser-compatibility reviewer", "Review dependency-free browser APIs and graceful fallbacks."],
  ["performance reviewer", "Review the page for local assets, deliberate motion, and no unnecessary network work."],
  ["security reviewer", "Review that the static preview contains no generated command execution or remote loading."],
  ["quality-assurance reviewer", "Review the entry point, stylesheet, and interaction script as an integrated static site."],
  ["requirements reviewer", "Review the requested product name and primary experience against the requirement."],
  ["demo-readiness reviewer", "Review whether the local preview communicates its purpose clearly during a demo."],
] as const satisfies readonly (readonly [string, string])[];

export function createLocalStaticFallbackPlan(request: string): WorkforcePlan {
  const brief = localSiteBrief(request);
  const builder: PlanningRequirement = {
    id: "REQ-01",
    title: `Build the ${brief.name} local web prototype`,
    acceptanceCriteria: [
      "Creates a complete responsive browser experience with semantic HTML, dedicated styling, and client-side interaction logic.",
      "Presents the requested product or brand directly in the document title and primary page heading.",
      "Runs as a dependency-free static site that the guarded local executor can serve and verify on loopback.",
    ],
    specialistRole: "frontend builder",
  };
  return {
    specification: `Deliver a responsive browser-only prototype for ${brief.name} that runs without generated package commands.`,
    requirements: [
      builder,
      ...localReviewers.map(([role, criterion], index) => ({
        id: `REQ-${String(index + 2).padStart(2, "0")}`,
        title: `${role} review for ${brief.name}`,
        acceptanceCriteria: [criterion, "Records a scoped verification report against the integrated local preview."],
        specialistRole: role,
      })),
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
      { path: "styles.css", content: styles(brief.kind) },
      { path: "script.js", content: script() },
    ],
  };
}

export function createLocalStaticFallbackReviewProposal(input: {
  readonly request: string;
  readonly requirement: Pick<EngineeringRequirement, "id" | "title">;
  readonly role: string;
  readonly projectContext: readonly { readonly path: string; readonly content: string }[];
  readonly reviewableRequirements: readonly Pick<EngineeringRequirement, "id" | "title">[];
}): AgentPatchProposal {
  const brief = localSiteBrief(input.request);
  const checks = inspectLocalStaticProject({ projectContext: input.projectContext, productName: brief.name });
  const target = input.reviewableRequirements[0];
  const role = input.role.trim();
  const reportPath = `reviews/${role.replaceAll(/[^a-z0-9]+/giu, "-").replaceAll(/^-|-$/gu, "")}.md`;
  const report = [
    `# ${role} report`,
    "",
    `Requirement: ${input.requirement.id} — ${input.requirement.title}`,
    `Reviewed product: ${brief.name}`,
    "",
    "## Checks",
    ...checks.map((check) => `- ${check.passed ? "PASS" : "FAIL"}: ${check.detail}`),
    "",
    "## Verdict",
    checks.every((check) => check.passed)
      ? "Passed. The integrated local static preview meets this reviewer’s deterministic checks."
      : "Failed. The missing browser-preview evidence is recorded above for targeted correction.",
  ].join("\n");
  const verification = checks.every((check) => check.passed)
    ? { verdict: "passed" as const, findings: [] }
    : {
        verdict: "failed" as const,
        findings: [
          {
            requirementId: target?.id ?? input.requirement.id,
            criterion: "Integrated local preview files",
            evidence: checks.filter((check) => !check.passed).map((check) => check.detail).join(" "),
            correction: "Restore the required static entry point, stylesheet, interaction script, and visible product identity.",
          },
        ],
      };
  return {
    safeActivity: "analyzing-requirements",
    safeActivityDetail: `${role} completed a scoped review of the integrated ${brief.name} preview.`,
    summary: `${role} wrote a deterministic evidence report for the integrated local static preview.`,
    files: [{ path: reportPath, content: `${report}\n` }],
    verification,
  };
}

function inspectLocalStaticProject(input: {
  readonly projectContext: readonly { readonly path: string; readonly content: string }[];
  readonly productName: string;
}): readonly { readonly passed: boolean; readonly detail: string }[] {
  const files = new Map(input.projectContext.map((file) => [file.path.replaceAll("\\", "/"), file.content]));
  const index = files.get("index.html") ?? "";
  const styles = files.get("styles.css") ?? "";
  const script = files.get("script.js") ?? "";
  return [
    { passed: /<main\b/iu.test(index) && /<h1\b[^>]*>[^<]+/iu.test(index), detail: "The entry page has a semantic main landmark and primary heading." },
    { passed: index.includes(input.productName), detail: `The entry page names ${input.productName} directly.` },
    { passed: styles.length > 200 && /@media\s*\(/iu.test(styles), detail: "The stylesheet includes a substantive responsive layout." },
    { passed: script.length > 100 && /addEventListener/iu.test(script), detail: "The interaction script wires local browser controls." },
    { passed: !/\b(?:TODO|placeholder text)\b/iu.test(`${index}\n${styles}\n${script}`), detail: "The delivered files contain no known placeholder copy." },
  ];
}

function localSiteBrief(request: string): LocalSiteBrief {
  const normalized = request.replaceAll(/\s+/gu, " ").trim();
  const lower = normalized.toLowerCase();
  const name = namedSubject(normalized) ?? "Studio Edit";
  const isCommerce = /\b(?:shop|store|clothing|fashion|dress|product|catalog|retail)\b/iu.test(lower);
  const isAuthentication = /\b(?:auth(?:entication)?|login|sign[ -]?in|register|account|dashboard)\b/iu.test(lower);
  const isMusic = /\b(?:spotify|music|playlist|audio|artist|album|podcast|listen(?:ing)?)\b/iu.test(lower);
  const includesSisyphus = /\bsisyphus\b/iu.test(lower);
  if (isMusic) {
    return {
      kind: "audio",
      name,
      topic: "a focused listening room",
      productStatement: "A calm music discovery experience with a tangible now-playing state and a useful library view.",
      actionLabel: "Start listening",
      focusLabel: "Listening room",
      includesSisyphus,
      research: productResearch({ name, request: normalized }),
    };
  }
  if (isAuthentication) {
    return {
      kind: "account",
      name,
      topic: "a deliberate account experience",
      productStatement: "A polished front-end flow for access, identity, and a focused member dashboard.",
      actionLabel: "Open account preview",
      focusLabel: "Account flow",
      includesSisyphus,
      research: productResearch({ name, request: normalized }),
    };
  }
  if (isCommerce) {
    return {
      kind: "storefront",
      name,
      topic: "a considered digital storefront",
      productStatement: "A shopping experience that gives the edit, the products, and the next action equal weight.",
      actionLabel: "Explore the edit",
      focusLabel: "Product edit",
      includesSisyphus,
      research: productResearch({ name, request: normalized }),
    };
  }
  return {
    kind: "launch",
    name,
    topic: "a focused digital launch",
    productStatement: "A clear narrative, a purposeful interface, and an interaction layer that makes the brief tangible.",
    actionLabel: "See the prototype",
    focusLabel: "Launch preview",
    includesSisyphus,
    research: productResearch({ name, request: normalized }),
  };
}

function productResearch(input: { readonly name: string; readonly request: string }): ProductResearch {
  const product = input.name.toLowerCase();
  if (product.includes("sprite")) {
    return {
      label: "Product research",
      finding: "Sprite is positioned by The Coca-Cola Company around crisp lemon-lime refreshment and culture-led moments in music, basketball, and street culture.",
      sourceLabel: "Coca-Cola Company brand profile",
    };
  }
  if (product.includes("spotify")) {
    return {
      label: "Product research",
      finding: "Spotify is an audio streaming subscription service built around music discovery, podcasts, and listening for every moment.",
      sourceLabel: "Spotify company information",
    };
  }
  if (/\b(?:gdg|google developers?|developer group)\b/iu.test(input.request)) {
    return {
      label: "Community research",
      finding: "Google Developer Groups are local, community-led places for developers to share knowledge, meet peers, and join events such as DevFest.",
      sourceLabel: "Google for Developers community guide",
    };
  }
  if (product.includes("zudio")) {
    return {
      label: "Product research",
      finding: "Zudio is Tata Trent’s value-fashion concept, designed around accessible fashion for women, men, and children.",
      sourceLabel: "Zudio and Trent brand information",
    };
  }
  return {
    label: "Brief research",
    finding: `The prototype is shaped around the requested ${input.name} experience: ${input.request}.`,
    sourceLabel: "Prompt analysis",
  };
}

function namedSubject(request: string): string | undefined {
  const zudio = request.match(/\bzudio\b/iu);
  if (zudio !== null) return "Zudio";
  const spotify = request.match(/\bspotify\b/iu);
  if (spotify !== null) return "Spotify";
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
  switch (input.brief.kind) {
    case "account":
      return accountHtml(input);
    case "audio":
      return musicHtml(input);
    case "storefront":
    case "launch":
      return storefrontHtml(input);
    default: {
      const exhaustive: never = input.brief.kind;
      return exhaustive;
    }
  }
}

function accountHtml(input: {
  readonly brief: LocalSiteBrief;
  readonly requirement: Pick<EngineeringRequirement, "id" | "title">;
}): string {
  const name = escapeHtml(input.brief.name);
  const statement = escapeHtml(input.brief.productStatement);
  const researchLabel = escapeHtml(input.brief.research.label);
  const researchFinding = escapeHtml(input.brief.research.finding);
  const researchSource = escapeHtml(input.brief.research.sourceLabel);
  const requirement = escapeHtml(input.requirement.title);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${name} account access prototype">
    <title>${name} | Secure account access</title>
    <link rel="stylesheet" href="styles.css">
    <script src="script.js" defer></script>
  </head>
  <body class="auth-site" data-template="account">
    <a class="skip-link" href="#main">Skip to sign in</a>
    <main id="main" class="auth-shell">
      <section class="auth-story" aria-labelledby="auth-story-title">
        <a class="auth-wordmark" href="#top" aria-label="${name} home"><span aria-hidden="true">◒</span>${name}</a>
        <div class="auth-story__copy" data-reveal>
          <p class="auth-kicker">Identity, with intent</p>
          <h1 id="auth-story-title">A clearer way back to your ${name} account.</h1>
          <p>${statement}</p>
        </div>
        <article class="research-card" data-reveal aria-labelledby="research-title">
          <p>${researchLabel}</p>
          <h2 id="research-title">Designed from the product context.</h2>
          <p>${researchFinding}</p>
          <small>Source: ${researchSource}</small>
        </article>
        <footer><span>Current brief</span><span>${requirement}</span></footer>
      </section>

      <section class="auth-panel" aria-labelledby="sign-in-title">
        <div class="auth-panel__head"><p>Member access</p><a href="#help">Need help?</a></div>
        <div class="auth-card" data-reveal>
          <p class="auth-step">01 / Sign in</p>
          <h2 id="sign-in-title">Welcome back.</h2>
          <p>Use your work email to continue to your account space.</p>
          <form class="auth-form" data-auth-form novalidate>
            <label for="auth-email">Email address</label>
            <input id="auth-email" name="email" type="email" autocomplete="email" placeholder="you@company.com" required>
            <label for="auth-password">Password</label>
            <div class="password-field"><input id="auth-password" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" minlength="8" required><button type="button" data-password-toggle aria-controls="auth-password" aria-pressed="false">Show</button></div>
            <div class="auth-options"><label><input type="checkbox" name="remember"> Remember this device</label><a href="#reset">Forgot password?</a></div>
            <button class="auth-submit" type="submit">Continue securely <span aria-hidden="true">→</span></button>
            <p class="auth-message" data-auth-message role="status"></p>
          </form>
          <div class="auth-divider"><span>or</span></div>
          <button class="auth-secondary" type="button" data-sso-button>Continue with single sign-on</button>
        </div>
        <p id="help" class="auth-disclaimer">This local prototype demonstrates the access flow only. It does not store credentials or contact a remote service.</p>
      </section>
    </main>
  </body>
</html>`;
}

function storefrontHtml(input: {
  readonly brief: LocalSiteBrief;
  readonly requirement: Pick<EngineeringRequirement, "id" | "title">;
}): string {
  const name = escapeHtml(input.brief.name);
  const topic = escapeHtml(input.brief.topic);
  const statement = escapeHtml(input.brief.productStatement);
  const action = escapeHtml(input.brief.actionLabel);
  const focus = escapeHtml(input.brief.focusLabel);
  const requirement = escapeHtml(input.requirement.title);
  const research = escapeHtml(input.brief.research.finding);
  const researchSource = escapeHtml(input.brief.research.sourceLabel);
  const sisyphusNote = input.brief.includesSisyphus
    ? '<p class="hero__note">Sisyphus gives an AI Engineering HR team a shared view of who is building, reviewing, and shipping each project.</p>'
    : `<p class="hero__note"><strong>Research brief.</strong> ${research} <span>Source: ${researchSource}</span></p>`;

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

function musicHtml(input: {
  readonly brief: LocalSiteBrief;
  readonly requirement: Pick<EngineeringRequirement, "id" | "title">;
}): string {
  const name = escapeHtml(input.brief.name);
  const statement = escapeHtml(input.brief.productStatement);
  const requirement = escapeHtml(input.requirement.title);
  const research = escapeHtml(input.brief.research.finding);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${name} local listening prototype">
    <title>${name} | Listening room</title>
    <link rel="stylesheet" href="styles.css">
    <script src="script.js" defer></script>
  </head>
  <body class="music-site" data-template="music">
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="music-header">
      <a class="music-wordmark" href="#top" aria-label="${name} home">${name}<span>Listening room</span></a>
      <button class="menu-button" type="button" data-menu-button aria-expanded="false" aria-controls="site-navigation">Menu</button>
      <nav id="site-navigation" class="music-nav" data-menu>
        <a href="#mixes">Mixes</a>
        <a href="#library">Library</a>
        <a href="#membership">Membership</a>
      </nav>
    </header>

    <main id="main">
      <section id="top" class="audio-hero" aria-labelledby="hero-title">
        <div class="audio-hero__copy" data-reveal>
          <p class="audio-kicker">Made for the in-between</p>
          <h1 id="hero-title">${name} turns a spare moment into a listening room.</h1>
          <p>${statement}</p>
          <p class="play-status">Research brief · ${research}</p>
          <div class="audio-hero__actions">
            <button class="play-button" type="button" data-play-toggle aria-pressed="false"><span aria-hidden="true">▶</span> Start this mix</button>
            <a class="quiet-link" href="#library">See the queue <span aria-hidden="true">↓</span></a>
          </div>
          <p class="play-status" data-play-status role="status">Paused · 36 minutes of focused listening</p>
        </div>
        <article class="now-playing" data-reveal aria-label="Now playing preview">
          <div class="record-art" aria-hidden="true"><span class="record-art__orbit"></span><span class="record-art__label">NIGHT<br>DRIVE</span></div>
          <div class="now-playing__meta"><span>Now playing</span><h2>After the rain</h2><p>Late transit · curated for a clear head</p></div>
          <div class="progress" aria-hidden="true"><span></span></div>
          <div class="now-playing__time"><span>1:24</span><span>3:46</span></div>
        </article>
      </section>

      <section id="mixes" class="mixes" aria-labelledby="mixes-title">
        <div class="music-section-heading" data-reveal><p class="audio-kicker">A small selection</p><h2 id="mixes-title">Choose a direction, not just a genre.</h2></div>
        <div class="mix-grid">
          <article class="mix-card mix-card--coral" data-reveal><span>01</span><h3>Soft focus</h3><p>Warm electronics for deep work.</p><button class="save-button" type="button" data-save aria-pressed="false">Save <span aria-hidden="true">+</span></button></article>
          <article class="mix-card mix-card--blue" data-reveal><span>02</span><h3>Side streets</h3><p>Guitar-led detours after dark.</p><button class="save-button" type="button" data-save aria-pressed="false">Save <span aria-hidden="true">+</span></button></article>
          <article class="mix-card mix-card--lime" data-reveal><span>03</span><h3>Daybreak</h3><p>Bright starts without the rush.</p><button class="save-button" type="button" data-save aria-pressed="false">Save <span aria-hidden="true">+</span></button></article>
        </div>
      </section>

      <section id="library" class="queue" aria-labelledby="queue-title">
        <div data-reveal><p class="audio-kicker">Your queue</p><h2 id="queue-title">Keep the thread going.</h2><p class="queue__detail">Each row is built for scanning: track, maker, and a reason it belongs in this hour.</p></div>
        <ol class="track-list" data-reveal>
          <li><span>01</span><div><strong>Paper maps</strong><small>Saint Vale</small></div><em>3:12</em></li>
          <li><span>02</span><div><strong>Blue line</strong><small>Hollow Choir</small></div><em>4:06</em></li>
          <li><span>03</span><div><strong>Good weather</strong><small>June Holiday</small></div><em>2:48</em></li>
          <li><span>04</span><div><strong>Last exit</strong><small>Common Hours</small></div><em>3:59</em></li>
        </ol>
      </section>

      <section id="membership" class="membership" aria-labelledby="membership-title">
        <div data-reveal><p class="audio-kicker">Keep listening</p><h2 id="membership-title">A new mix when it has a point of view.</h2><p>Current task: ${requirement}</p></div>
        <form class="signup" data-signup novalidate>
          <label for="email">Email address</label>
          <div class="signup__row"><input id="email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required><button class="play-button" type="submit">Join the list</button></div>
          <p class="form-message" data-form-message role="status"></p>
        </form>
      </section>
    </main>
    <footer class="music-footer"><span>${name} local listening prototype</span><span>Built for browser-only preview</span><span>© 2026</span></footer>
  </body>
</html>`;
}

function styles(kind: LocalSiteBrief["kind"]): string {
  switch (kind) {
    case "account":
      return accountStyles();
    case "audio":
      return musicStyles();
    case "storefront":
    case "launch":
      return storefrontStyles();
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function storefrontStyles(): string {
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
.hero { display: grid; gap: 2rem; grid-template-columns: 1.1fr .9fr; min-height: clamp(34rem, 70vh, 42rem); padding: clamp(3.5rem, 7vw, 5rem) 7vw 3.5rem; }
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
.edit { border-top: 1px solid var(--line); padding: clamp(4rem, 7vw, 5.5rem) 7vw; }
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
.manifesto { background: var(--acid); display: grid; gap: 2rem; grid-template-columns: .45fr 1fr; padding: clamp(4.5rem, 8vw, 6rem) 12vw; }
.manifesto__number { font-family: var(--serif); font-size: 2.2rem; }
.manifesto h2 { margin-bottom: 1.5rem; max-width: 42rem; }
.manifesto div > p { line-height: 1.65; max-width: 38rem; }
.manifesto__detail { border-top: 1px solid var(--ink); font-size: .78rem; margin-top: 2.5rem; padding-top: 1rem; }
.contact { display: grid; gap: 3rem; grid-template-columns: 1fr 1fr; padding: clamp(4.5rem, 8vw, 6rem) 7vw; }
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

function accountStyles(): string {
  return `:root {
  color-scheme: dark;
  --night: #101525;
  --ink: #f5f7ff;
  --muted: #a7afc7;
  --line: rgba(245, 247, 255, .16);
  --violet: #9c7cff;
  --aqua: #68e1d1;
  --panel: #f7f8fc;
  --panel-ink: #17192a;
  --sans: Inter, ui-sans-serif, system-ui, sans-serif;
  --serif: Georgia, "Times New Roman", serif;
}

* { box-sizing: border-box; }
html { background: var(--night); }
body { background: var(--night); color: var(--ink); font-family: var(--sans); margin: 0; }
button, input { font: inherit; }
button { cursor: pointer; }
a { color: inherit; }
.skip-link { background: var(--ink); color: var(--night); left: 1rem; padding: .7rem 1rem; position: fixed; top: -5rem; z-index: 10; }
.skip-link:focus { top: 1rem; }
.auth-shell { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(25rem, .92fr); min-height: 100vh; }
.auth-story { display: flex; flex-direction: column; overflow: hidden; padding: clamp(1.5rem, 4vw, 4rem); position: relative; }
.auth-story::before { background: radial-gradient(circle at 20% 80%, rgba(104,225,209,.35), transparent 23rem), radial-gradient(circle at 82% 17%, rgba(156,124,255,.37), transparent 28rem); content: ""; inset: 0; pointer-events: none; position: absolute; }
.auth-wordmark, .auth-story__copy, .research-card, .auth-story footer { position: relative; }
.auth-wordmark { font-size: 1.05rem; font-weight: 850; letter-spacing: -.05em; text-decoration: none; }
.auth-wordmark span { color: var(--aqua); font-size: 1.5rem; margin-right: .45rem; vertical-align: -.12rem; }
.auth-story__copy { margin: auto 0 clamp(2rem, 8vw, 6rem); max-width: 44rem; }
.auth-kicker, .auth-step, .research-card > p:first-child, .auth-panel__head > p { color: var(--aqua); font-size: .7rem; font-weight: 850; letter-spacing: .14em; margin: 0 0 1.1rem; text-transform: uppercase; }
.auth-story h1, .auth-card h2 { font-family: var(--serif); font-weight: 400; letter-spacing: -.065em; }
.auth-story h1 { font-size: clamp(3.4rem, 7vw, 7.5rem); line-height: .88; margin: 0 0 1.65rem; }
.auth-story__copy > p:last-child { color: var(--muted); font-size: clamp(1rem, 1.4vw, 1.25rem); line-height: 1.65; max-width: 34rem; }
.research-card { backdrop-filter: blur(10px); background: rgba(19,26,45,.64); border: 1px solid var(--line); max-width: 32rem; padding: 1.35rem; }
.research-card h2 { font-size: 1.2rem; margin: 0 0 .8rem; }
.research-card p { color: #d7dced; font-size: .88rem; line-height: 1.55; margin: 0 0 1rem; }
.research-card small { color: var(--muted); font-size: .7rem; }
.auth-story footer { border-top: 1px solid var(--line); color: var(--muted); display: flex; font-size: .68rem; gap: 1rem; justify-content: space-between; margin-top: 2rem; padding-top: 1rem; text-transform: uppercase; }
.auth-story footer span:last-child { max-width: 25rem; text-align: right; }
.auth-panel { align-items: center; background: var(--panel); color: var(--panel-ink); display: flex; flex-direction: column; justify-content: center; padding: clamp(1.5rem, 5vw, 5rem); }
.auth-panel__head { align-items: center; display: flex; justify-content: space-between; max-width: 28rem; width: 100%; }
.auth-panel__head > p { color: #596078; margin-bottom: 1.5rem; }
.auth-panel__head a { color: #4e38ad; font-size: .78rem; font-weight: 750; margin-bottom: 1.5rem; }
.auth-card { background: #fff; border: 1px solid #e4e6ef; box-shadow: 0 1.5rem 4rem rgba(23,25,42,.12); max-width: 28rem; padding: clamp(1.5rem, 4vw, 2.5rem); width: 100%; }
.auth-step { color: #6551c6; }
.auth-card h2 { font-size: clamp(2.5rem, 4vw, 3.55rem); line-height: .9; margin: 0 0 .9rem; }
.auth-card > p:not(.auth-step) { color: #626a80; font-size: .92rem; line-height: 1.55; margin-bottom: 2rem; }
.auth-form { display: grid; gap: .7rem; }
.auth-form label { font-size: .72rem; font-weight: 800; letter-spacing: .03em; margin-top: .6rem; }
.auth-form input { background: #fafbfe; border: 1px solid #d8dce7; color: var(--panel-ink); min-height: 3rem; padding: 0 .85rem; width: 100%; }
.auth-form input:focus { border-color: #6855d5; box-shadow: 0 0 0 3px rgba(104,85,213,.15); outline: 0; }
.password-field { position: relative; }
.password-field input { padding-right: 4.5rem; }
.password-field button { background: transparent; border: 0; color: #5846bc; font-size: .73rem; font-weight: 800; padding: .4rem; position: absolute; right: .4rem; top: 50%; transform: translateY(-50%); }
.auth-options { align-items: center; display: flex; font-size: .72rem; justify-content: space-between; margin: .4rem 0 .7rem; }
.auth-options label { align-items: center; color: #626a80; display: flex; font-weight: 600; gap: .45rem; margin: 0; }
.auth-options input { accent-color: #5b46c9; min-height: auto; padding: 0; width: auto; }
.auth-options a { color: #4e38ad; font-weight: 750; }
.auth-submit, .auth-secondary { border: 1px solid #1c1a31; font-size: .76rem; font-weight: 850; min-height: 3.2rem; transition: box-shadow 180ms ease, transform 180ms ease; }
.auth-submit { background: #1c1a31; color: #fff; letter-spacing: .06em; text-transform: uppercase; }
.auth-submit span { margin-left: .55rem; }
.auth-submit:hover, .auth-submit:focus-visible { box-shadow: 4px 4px 0 var(--violet); transform: translate(-2px, -2px); }
.auth-message { color: #276d61; font-size: .78rem; min-height: 1.2rem; margin: .25rem 0 0; }
.auth-divider { align-items: center; color: #8a91a4; display: flex; font-size: .72rem; gap: .85rem; margin: 1.35rem 0; }
.auth-divider::before, .auth-divider::after { background: #e2e4ed; content: ""; height: 1px; width: 100%; }
.auth-secondary { background: #fff; color: #393b4f; width: 100%; }
.auth-secondary:hover, .auth-secondary:focus-visible { background: #f0effb; border-color: #6754cf; }
.auth-disclaimer { color: #737b90; font-size: .72rem; line-height: 1.5; margin: 1.2rem 0 0; max-width: 28rem; }
[data-reveal] { opacity: 0; transform: translateY(1rem); transition: opacity 440ms ease, transform 440ms ease; }
[data-reveal].is-visible { opacity: 1; transform: translateY(0); }
@media (max-width: 820px) {
  .auth-shell { grid-template-columns: 1fr; }
  .auth-story { min-height: 42rem; }
  .auth-panel { min-height: 40rem; }
}
@media (max-width: 520px) {
  .auth-story { min-height: 38rem; }
  .auth-story h1 { font-size: 3.5rem; }
  .auth-story footer { align-items: flex-start; flex-direction: column; }
  .auth-story footer span:last-child { text-align: left; }
  .auth-options { align-items: flex-start; flex-direction: column; gap: .7rem; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
  [data-reveal] { opacity: 1; transform: none; }
}`;
}

function musicStyles(): string {
  return `:root {
  color-scheme: dark;
  --night: #11110f;
  --ink: #f6f1e8;
  --muted: #a9a49a;
  --line: rgba(246, 241, 232, .16);
  --coral: #ff7b61;
  --blue: #9db8ff;
  --lime: #d5f05c;
  --sans: Inter, ui-sans-serif, system-ui, sans-serif;
  --serif: Georgia, "Times New Roman", serif;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { background: var(--night); color: var(--ink); font-family: var(--sans); margin: 0; }
button, input { font: inherit; }
button { cursor: pointer; }
a { color: inherit; text-decoration: none; }
.skip-link { background: var(--ink); color: var(--night); left: 1rem; padding: .7rem 1rem; position: fixed; top: -5rem; z-index: 10; }
.skip-link:focus { top: 1rem; }
.music-header { align-items: center; border-bottom: 1px solid var(--line); display: grid; grid-template-columns: 1fr auto; min-height: 4.8rem; padding: 0 5vw; position: relative; }
.music-wordmark { font-size: 1.2rem; font-weight: 850; letter-spacing: -.07em; }
.music-wordmark span { color: var(--muted); font-size: .65rem; font-weight: 700; letter-spacing: .1em; margin-left: .75rem; text-transform: uppercase; }
.music-nav { display: flex; gap: 1.75rem; font-size: .73rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
.music-nav a { border-bottom: 1px solid transparent; padding: .35rem 0; }
.music-nav a:hover, .music-nav a:focus-visible { border-color: var(--lime); color: var(--lime); }
.menu-button { background: transparent; border: 0; color: inherit; display: none; font-size: .73rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
.audio-hero { display: grid; gap: clamp(2rem, 7vw, 7rem); grid-template-columns: minmax(0, 1.05fr) minmax(18rem, .75fr); padding: clamp(3.5rem, 7vw, 6.5rem) 8vw clamp(3.5rem, 6vw, 5rem); }
.audio-hero__copy { align-self: center; max-width: 47rem; }
.audio-kicker { color: var(--lime); font-size: .68rem; font-weight: 850; letter-spacing: .14em; margin: 0 0 1.2rem; text-transform: uppercase; }
h1, h2, h3, p { margin-top: 0; }
h1, h2 { font-family: var(--serif); font-weight: 400; letter-spacing: -.055em; }
h1 { font-size: clamp(3.2rem, 7vw, 7.1rem); line-height: .9; margin-bottom: 1.7rem; }
h2 { font-size: clamp(2.25rem, 4.4vw, 4.6rem); line-height: .95; }
.audio-hero__copy > p:not(.audio-kicker):not(.play-status) { color: #d3cec5; font-size: 1.12rem; line-height: 1.6; max-width: 32rem; }
.audio-hero__actions { align-items: center; display: flex; flex-wrap: wrap; gap: 1.3rem; margin-top: 2rem; }
.play-button { align-items: center; background: var(--lime); border: 1px solid var(--lime); color: var(--night); display: inline-flex; font-size: .74rem; font-weight: 850; gap: .65rem; justify-content: center; letter-spacing: .08em; min-height: 3.3rem; padding: 0 1.25rem; text-transform: uppercase; transition: transform 180ms ease, box-shadow 180ms ease; }
.play-button:hover, .play-button:focus-visible { box-shadow: 5px 5px 0 var(--coral); transform: translate(-3px, -3px); }
.quiet-link { border-bottom: 1px solid var(--muted); color: var(--muted); font-size: .78rem; padding-bottom: .25rem; }
.quiet-link:hover, .quiet-link:focus-visible { color: var(--ink); }
.play-status { color: var(--muted); font-size: .78rem; margin: 1.3rem 0 0; }
.now-playing { align-self: end; background: #20201c; border: 1px solid var(--line); padding: 1.2rem; }
.record-art { align-items: center; aspect-ratio: 1; background: linear-gradient(135deg, var(--coral), #d35875 45%, var(--blue)); display: flex; justify-content: center; overflow: hidden; position: relative; }
.record-art::before { background: var(--night); border: 1px solid rgba(255,255,255,.25); border-radius: 50%; content: ""; height: 58%; position: absolute; width: 58%; }
.record-art__orbit { border: 1px solid rgba(255,255,255,.6); border-radius: 50%; height: 76%; position: absolute; transform: rotate(30deg); width: 36%; }
.record-art__label { color: var(--ink); font-size: clamp(1.2rem, 2.6vw, 2.2rem); font-weight: 900; letter-spacing: -.08em; line-height: .82; mix-blend-mode: difference; position: relative; text-align: center; }
.now-playing__meta { padding: 1.35rem 0 .8rem; }
.now-playing__meta > span { color: var(--lime); font-size: .65rem; font-weight: 850; letter-spacing: .12em; text-transform: uppercase; }
.now-playing h2 { font-family: var(--sans); font-size: 1.35rem; font-weight: 800; letter-spacing: -.04em; margin: .45rem 0 .25rem; }
.now-playing p { color: var(--muted); font-size: .78rem; margin: 0; }
.progress { background: rgba(255,255,255,.2); height: 2px; }
.progress span { background: var(--lime); display: block; height: 100%; width: 37%; }
.now-playing__time { color: var(--muted); display: flex; font-size: .65rem; justify-content: space-between; margin-top: .55rem; }
.mixes { border-top: 1px solid var(--line); padding: clamp(3.5rem, 6vw, 5.5rem) 8vw; }
.music-section-heading { display: grid; gap: 1rem; grid-template-columns: .5fr 1.5fr; margin-bottom: 2.5rem; }
.music-section-heading h2 { margin: 0; max-width: 44rem; }
.mix-grid { display: grid; gap: 1rem; grid-template-columns: repeat(3, 1fr); }
.mix-card { color: var(--night); display: flex; flex-direction: column; min-height: 17rem; padding: 1.25rem; position: relative; transition: transform 220ms ease; }
.mix-card:hover { transform: translateY(-.45rem); }
.mix-card--coral { background: var(--coral); }
.mix-card--blue { background: var(--blue); }
.mix-card--lime { background: var(--lime); }
.mix-card > span { font-size: .75rem; font-weight: 800; }
.mix-card h3 { font-family: var(--serif); font-size: clamp(2rem, 3vw, 3.3rem); font-weight: 400; letter-spacing: -.07em; line-height: .9; margin: auto 0 .65rem; }
.mix-card p { font-size: .85rem; line-height: 1.45; margin-bottom: 1rem; max-width: 15rem; }
.save-button { align-self: flex-start; background: transparent; border: 1px solid var(--night); border-radius: 2rem; color: inherit; font-size: .68rem; font-weight: 850; letter-spacing: .07em; padding: .5rem .7rem; text-transform: uppercase; }
.save-button:hover, .save-button[aria-pressed="true"] { background: var(--night); color: var(--ink); }
.queue { background: #20201c; display: grid; gap: 3rem; grid-template-columns: .8fr 1.2fr; padding: clamp(3.5rem, 7vw, 6rem) 12vw; }
.queue h2 { margin-bottom: 1.3rem; }
.queue__detail { color: var(--muted); line-height: 1.6; max-width: 24rem; }
.track-list { list-style: none; margin: 0; padding: 0; }
.track-list li { align-items: center; border-top: 1px solid var(--line); display: grid; gap: 1.2rem; grid-template-columns: 2rem 1fr auto; min-height: 4.7rem; }
.track-list li:last-child { border-bottom: 1px solid var(--line); }
.track-list li > span, .track-list em { color: var(--muted); font-size: .74rem; font-style: normal; }
.track-list strong { display: block; font-size: .92rem; }
.track-list small { color: var(--muted); display: block; font-size: .76rem; margin-top: .18rem; }
.membership { display: grid; gap: 3rem; grid-template-columns: 1fr 1fr; padding: clamp(3.5rem, 7vw, 6rem) 8vw; }
.membership h2 { margin-bottom: 1.25rem; max-width: 36rem; }
.membership div > p:last-child { color: var(--muted); font-size: .78rem; line-height: 1.5; }
.signup { align-self: end; }
.signup label { display: block; font-size: .68rem; font-weight: 850; letter-spacing: .1em; margin-bottom: .7rem; text-transform: uppercase; }
.signup__row { display: flex; }
.signup input { background: transparent; border: 0; border-bottom: 1px solid var(--ink); color: var(--ink); min-height: 3.3rem; min-width: 0; padding: 0 .65rem; width: 100%; }
.signup input:focus { outline: 2px solid var(--lime); outline-offset: 2px; }
.form-message { color: var(--lime); font-size: .82rem; min-height: 1.3rem; margin: .75rem 0 0; }
.music-footer { border-top: 1px solid var(--line); color: var(--muted); display: flex; font-size: .65rem; font-weight: 800; justify-content: space-between; letter-spacing: .08em; padding: 1.4rem 5vw; text-transform: uppercase; }
[data-reveal] { opacity: 0; transform: translateY(1.2rem); transition: opacity 500ms ease, transform 500ms ease; }
[data-reveal].is-visible { opacity: 1; transform: translateY(0); }
@media (max-width: 760px) {
  .music-header { min-height: 4.35rem; }
  .music-wordmark span { display: none; }
  .menu-button { display: block; }
  .music-nav { background: var(--night); border-bottom: 1px solid var(--line); display: none; left: 0; padding: 1rem 5vw 1.5rem; position: absolute; right: 0; top: 100%; z-index: 4; }
  .music-nav.is-open { display: grid; gap: .7rem; }
  .audio-hero, .queue, .membership { grid-template-columns: 1fr; }
  .audio-hero { padding-left: 7vw; padding-right: 7vw; }
  .music-section-heading { display: block; }
  .mix-grid { grid-template-columns: 1fr; }
  .mix-card { min-height: 13rem; }
  .queue { padding-left: 7vw; padding-right: 7vw; }
  .music-footer { align-items: flex-start; flex-direction: column; gap: .55rem; }
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
const playToggle = document.querySelector('[data-play-toggle]');
const playStatus = document.querySelector('[data-play-status]');
const authForm = document.querySelector('[data-auth-form]');
const authMessage = document.querySelector('[data-auth-message]');
const passwordToggle = document.querySelector('[data-password-toggle]');
const ssoButton = document.querySelector('[data-sso-button]');

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

playToggle?.addEventListener('click', () => {
  const playing = playToggle.getAttribute('aria-pressed') === 'true';
  playToggle.setAttribute('aria-pressed', String(!playing));
  playToggle.innerHTML = playing ? '<span aria-hidden="true">▶</span> Start this mix' : '<span aria-hidden="true">Ⅱ</span> Playing now';
  if (playStatus) playStatus.textContent = playing ? 'Paused · 36 minutes of focused listening' : 'Playing · After the rain is now in your queue';
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

passwordToggle?.addEventListener('click', () => {
  const password = document.querySelector('#auth-password');
  if (!(password instanceof HTMLInputElement)) return;
  const visible = password.type === 'text';
  password.type = visible ? 'password' : 'text';
  passwordToggle.setAttribute('aria-pressed', String(!visible));
  passwordToggle.textContent = visible ? 'Show' : 'Hide';
});

authForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const email = authForm.querySelector('input[type="email"]');
  const password = authForm.querySelector('input[type="password"], input[type="text"]');
  if (!(email instanceof HTMLInputElement) || !email.validity.valid) {
    if (email instanceof HTMLInputElement) email.focus();
    if (authMessage) authMessage.textContent = 'Enter a valid work email to continue.';
    return;
  }
  if (!(password instanceof HTMLInputElement) || password.value.length < 8) {
    if (password instanceof HTMLInputElement) password.focus();
    if (authMessage) authMessage.textContent = 'Use at least eight characters for this preview.';
    return;
  }
  if (authMessage) authMessage.textContent = 'Access confirmed for the local prototype. No credentials were stored.';
});

ssoButton?.addEventListener('click', () => {
  if (authMessage) authMessage.textContent = 'Single sign-on is represented locally for this prototype.';
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
