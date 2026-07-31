export interface BriefClaim {
  readonly text: string;
  readonly epistemicClass: 'observed-fact' | 'external-claim' | 'user-assertion' | 'model-inference' | 'simulation';
  readonly citations: readonly { label: string; href: string }[];
}

export interface HumanAuthorityBrief {
  readonly title: string;
  readonly claims: readonly BriefClaim[];
  readonly dissent: readonly string[];
  readonly assumptions: readonly string[];
  readonly limitations: readonly string[];
  readonly abstention?: { readonly reason: string; readonly unblockConditions: readonly string[] };
}

export function renderHumanAuthorityBrief(brief: HumanAuthorityBrief, csrfToken: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta name="color-scheme" content="light dark"><title>${escape(brief.title)}</title><link rel="stylesheet" href="/assets/app.css"></head>
<body><a class="skip" href="#main">Skip to decision brief</a><header><strong>Deliberation laboratory</strong><p>The platform has not made your decision.</p></header>
<main id="main" tabindex="-1"><h1>${escape(brief.title)}</h1><section aria-labelledby="claims"><h2 id="claims">Evidence and claims</h2>
${brief.claims.map((claim) => `<article><h3>${escape(label(claim.epistemicClass))}</h3><p>${escape(claim.text)}</p><details><summary>Inspect citations</summary><ul>${claim.citations.map((citation) => `<li><a href="${safeHref(citation.href)}">${escape(citation.label)}</a></li>`).join('')}</ul></details></article>`).join('')}</section>
${listSection('Dissent', brief.dissent)}${listSection('Assumptions', brief.assumptions)}${listSection('Limitations', brief.limitations)}
${brief.abstention === undefined
    ? `<form method="post" action="/decision-intent"><fieldset><legend>Human decision authority</legend><p>Confirming records your decision, not the platform ranking.</p><input type="hidden" name="csrf" value="${escape(csrfToken)}"><button type="submit">Review decision confirmation</button></fieldset></form>`
    : `<section role="status"><h2>Abstention</h2><p>${escape(brief.abstention.reason)}</p>${listSection('What could unblock this', brief.abstention.unblockConditions)}</section>`}
<p id="progress" role="status" aria-live="polite"></p></main></body></html>`;
}

const escape = (value: string): string => value.replace(/[&<>"']/g, (character) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
const safeHref = (href: string): string => /^https:\/\/[a-z0-9.-]+(?:\/|$)/i.test(href) ? escape(href) : '#invalid-citation';
const label = (value: BriefClaim['epistemicClass']): string => value.replace('-', ' ');
const listSection = (title: string, values: readonly string[]): string =>
  `<section><h2>${escape(title)}</h2><ul>${values.map((value) => `<li>${escape(value)}</li>`).join('')}</ul></section>`;
