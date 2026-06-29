#!/usr/bin/env node
/**
 * Seed the `content_clients.brand_spec` presentation layer for the Whispering
 * Willows of Mount Vernon hub so `/clients/whispering-willows` renders at the
 * caliber of the bundled reference demo (examples/whispering-willows-demo).
 *
 * This is ADDITIVE + IDEMPOTENT: it sets the `brand_spec` JSON on the existing
 * client row (currently NULL) and can be re-run to update it. It does NOT touch
 * any content_pieces, and nulling it back out cleanly reverts to the neutral
 * fallback render. Images referenced here are committed at
 * apps/seo/public/hub/whispering-willows/.
 *
 * Usage (from apps/seo/, with DATABASE_URL set):
 *   node scripts/seed-whispering-willows-brand.mjs
 *
 * NOTE: this is the interim, hand-authored presentation seed. The same
 * `brand_spec.hub` shape is what the strategy/authoring agent is intended to
 * populate automatically (from the approved ContentStrategy + brand assets).
 */

import pg from "pg";

const { Client } = pg;
const IMG = (f) => `/hub/whispering-willows/${f}`;

const brandSpec = {
  name: "Whispering Willows of Mount Vernon",
  logo: { url: IMG("ww-logo.png"), alt: "Whispering Willows", treatment: "light" },
  palette: {
    brand: "#3d5446",
    brandDark: "#2f4339",
    accent: "#c08a4e",
    ink: "#2b2924",
    bg: "#faf7f1",
    surface: "#ffffff",
  },
  typography: {
    headingFamily: "'Fraunces', Georgia, 'Times New Roman', serif",
    bodyFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  tagline: "Memory Care · Mount Vernon, WA",
  nap: {
    legalName: "Whispering Willows Memory Care",
    phone: "(360) 208-7555",
    streetAddress: "2311 E Division St",
    locality: "Mount Vernon",
    region: "WA",
    postalCode: "98274",
    country: "US",
    url: "https://www.whisperingwillows.com",
  },
  hub: {
    eyebrow: "A family resource library",
    heroHeadline: "Clear answers for the hardest decision you'll make for someone you love.",
    heroLede:
      "Memory care guidance for families across Skagit County — Mount Vernon, Burlington, Sedro-Woolley, and Anacortes — written to be understood, grounded in trusted sources, and never alarmist.",
    heroImage: IMG("daughter-elder-hug.jpg"),
    heroStat: {
      value: "7.2M",
      label: "Americans 65+ are living with Alzheimer's — and most are cared for by family first.",
    },
    primaryCtaLabel: "Read the guides",
    nav: [
      { label: "What is memory care", slug: "what-is-memory-care-understanding-specialized-dementia-support" },
      { label: "Compare care", slug: "memory-care-vs-assisted-living-which-does-your-loved-one-need" },
      { label: "Paying", slug: "how-much-does-memory-care-cost-in-washington-state" },
      { label: "Signs it's time", slug: "10-signs-it-s-time-for-memory-care-a-family-guide" },
    ],
    stepsEyebrow: "How to use this library",
    stepsHeadline: "Guides that meet your family at every stage",
    stepsLede:
      "From the first worried question to the day you tour a community — start wherever you are in the journey.",
    steps: [
      { k: "01 · Awareness", title: "“Is something wrong?”", body: "Telling the difference between normal aging and the early signs of dementia." },
      { k: "02 · Consideration", title: "“How do we pay for this?”", body: "What a monthly fee includes and the ways families pay — private funds, VA benefits, and Medicaid." },
      { k: "03 · Decision", title: "“Is this the right home?”", body: "Touring and comparing communities with confidence — the questions that matter most." },
    ],
    libraryEyebrow: "The resource library",
    libraryHeadline: "The Skagit County memory-care hub",
    libraryLede:
      "Each is a finished, publish-ready guide — question-style headings, sources you can check, and a named reviewer.",
    qualityEyebrow: "Why these guides are built to be trusted",
    qualityHeadline: "Quality is the strategy",
    qualityLede:
      "Search is shifting from ranking links to being quoted inside AI answers. These pages are engineered for both — and held to a standard that protects a memory-care brand.",
    qualityPillars: [
      { k: "Source-grounded", title: "No invented statistics", body: "Every figure traces to a named authority — the Alzheimer's Association, the National Institute on Aging — and is cited on the page." },
      { k: "Built for AI answers", title: "Self-contained, structured", body: "Clear headings, comparison tables, and FAQ schema let answer engines lift a clean, quotable passage — with your name on it." },
      { k: "E-E-A-T ready", title: "A named, accountable byline", body: "Health content needs a credentialed human behind it. Each page carries a reviewer byline — the trust signal your blog is missing today." },
    ],
    ctaHeadline: "See if Whispering Willows is the right home",
    ctaBody:
      "Tour our Mount Vernon memory care community, meet the team, and ask every question on your list. There's no pressure — just clear answers.",
    footerBlurb:
      "Specialized memory and dementia care in the heart of the Skagit Valley. Where care feels like home.",
    footerLicense:
      "Deficiency-free 2025 Washington State DSHS annual inspection · License #2726",
    imagePool: [
      IMG("comfort-elder.jpg"),
      IMG("stretching-support.jpg"),
      IMG("groceries-care.jpg"),
      IMG("mobility-assist.jpg"),
      IMG("activity-smile.jpg"),
      IMG("caregiver-tea.jpg"),
      IMG("embrace-elder.jpg"),
      IMG("elder-hug-warm.jpg"),
      IMG("hero-care.jpg"),
    ],
    cardImages: {
      "memory-care-in-mount-vernon-wa-a-complete-guide-for-families": IMG("hero-care.jpg"),
      "what-is-memory-care-understanding-specialized-dementia-support": IMG("comfort-elder.jpg"),
      "memory-care-vs-assisted-living-which-does-your-loved-one-need": IMG("stretching-support.jpg"),
      "how-much-does-memory-care-cost-in-washington-state": IMG("groceries-care.jpg"),
      "10-signs-it-s-time-for-memory-care-a-family-guide": IMG("mobility-assist.jpg"),
      "dementia-wandering-and-safety-how-memory-care-keeps-loved-ones-secure": IMG("activity-smile.jpg"),
      "how-to-choose-a-memory-care-facility-12-questions-to-ask-on-a-tour": IMG("caregiver-tea.jpg"),
      "family-visits-in-memory-care-what-to-expect-and-how-to-stay-connected": IMG("embrace-elder.jpg"),
    },
  },
};

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(
    `UPDATE content_clients SET brand_spec = $1::jsonb WHERE blog_slug = 'whispering-willows' RETURNING id, name, blog_slug`,
    [JSON.stringify(brandSpec)],
  );
  console.log(`Updated ${res.rowCount} row(s):`);
  for (const r of res.rows) console.log(`  ${r.blog_slug} → ${r.name} (${r.id})`);
  await client.end();
}

main().catch((err) => {
  console.error("Seed failed:", err?.message ?? err);
  process.exit(1);
});
