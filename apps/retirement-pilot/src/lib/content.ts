/**
 * Cedar Hollow Senior Living — site content.
 *
 * This is a PILOT / DEMO site. The community ("Cedar Hollow"), its location,
 * and contact details are fictional. Structure and sample copy are adapted from
 * a public senior-living community page and rewritten for a made-up brand.
 */

export const community = {
  name: "Cedar Hollow Senior Living",
  shortName: "Cedar Hollow",
  tagline: "Assisted living in the heart of Pinehurst Valley",
  location: "Pinehurst Valley, OR",
  address: {
    line1: "412 Hollow Creek Road",
    city: "Pinehurst Valley",
    state: "OR",
    zip: "97401",
  },
  phone: "(555) 014-2356",
  phoneHref: "tel:+15550142356",
  email: "hello@cedarhollowliving.example",
  startingPrice: "$2,799",
  award: {
    title: "Best Senior Living 2025",
    source: "Pinehurst Valley Reader's Choice",
  },
} as const;

export const hero = {
  eyebrow: "Assisted living & respite care",
  heading: "A warm, supportive home in Pinehurst Valley",
  subheading:
    "Tucked beside the cedar groves of Pinehurst Valley, Cedar Hollow offers a friendly, supportive community where older adults can enjoy their best years — with just the right amount of help, always close at hand.",
  primaryCta: { label: "Schedule a tour", href: "/contact" },
  secondaryCta: { label: "Explore floor plans", href: "/floor-plans" },
} as const;

export const about = {
  eyebrow: "Welcome home",
  heading: "Independence and support, together under one roof",
  body: [
    "Cedar Hollow gives seniors a safe, homelike setting where independence and support come together. Residents enjoy thoughtfully designed apartments, tailored services, and engaging activities that nurture well-being and connection.",
    "With a dedicated, caring team and beautiful natural surroundings, you'll feel right at home from the very first day.",
  ],
  highlights: [
    "Conveniently located off Route 5 with easy access to Highway 99",
    "Serving Pinehurst Valley and the surrounding communities",
    "Small dogs and cats are warmly welcome",
  ],
} as const;

export const careTypes = [
  {
    slug: "assisted-living",
    name: "Assisted Living",
    image: "/images/assisted-living.jpg",
    blurb:
      "Daily support with personal care, dining, and activities — while you keep the independence you value most.",
    points: [
      "Help with bathing, dressing, and daily routines",
      "Medication management and on-site staff around the clock",
      "Three chef-prepared meals a day, plus snacks",
    ],
  },
  {
    slug: "respite-care",
    name: "Respite Care",
    image: "/images/respite-care.jpg",
    blurb:
      "Short-term stays with full access to every service and amenity. Ideal for recovery after a hospital stay, or a relaxed trial visit.",
    points: [
      "Fully furnished, move-in-ready apartments",
      "Same care and dining as our long-term residents",
      "Flexible stays — a few days to a few months",
    ],
  },
] as const;

export const amenities = {
  included: {
    heading: "Included in your monthly rent",
    items: [
      "Three daily meals plus snacks",
      "Activities and social programs",
      "Weekly housekeeping and laundry",
      "Maintenance and 24-hour security",
      "24-hour on-site staff support",
    ],
  },
  onSite: {
    heading: "On-site amenities",
    items: [
      "Covered patio and outdoor walking path",
      "Courtyard with bird sanctuary and garden seating",
      "Expansive library with a wide range of books",
      "Full-service beauty salon",
      "Cozy lounge with fireplace and piano",
    ],
  },
} as const;

export const activities = {
  eyebrow: "Life enrichment",
  heading: "Always something to look forward to",
  body: "From quiet mornings in the garden to lively evenings with friends, our calendar is built around the things that bring residents joy.",
  image: "/images/lifestyle-gardening.jpg",
  groups: [
    {
      title: "Social & creative",
      items: [
        "Bingo, trivia, and cards club",
        "Arts, crafts, and gardening",
        "Intergenerational programs",
      ],
    },
    {
      title: "Celebrations & outings",
      items: [
        "Cooking classes and wine tastings",
        "Themed parties and happy hours",
        "Live entertainment and day trips",
      ],
    },
    {
      title: "Wellness & faith",
      items: [
        "Stretching, yoga, and fitness classes",
        "Bible study and devotionals",
        "Faith-based services",
      ],
    },
  ],
} as const;

export const floorplans = {
  eyebrow: "Floor plans",
  heading: "Apartments that feel like home",
  startingNote: "Assisted living starts at $2,799 / month",
  plans: [
    {
      name: "Studio",
      sqft: "291 sq. ft.",
      image: "/images/floorplan-studio.jpg",
      description: "A cozy, efficient layout that's easy to make your own.",
    },
    {
      name: "Large Studio",
      sqft: "321 sq. ft.",
      image: "/images/floorplan-large-studio.jpg",
      description: "A little extra room to stretch out, host, and relax.",
    },
    {
      name: "Two Bedroom",
      sqft: "496 sq. ft.",
      image: "/images/floorplan-two-bedroom.jpg",
      description: "Room for a partner, a guest, or a home office and hobbies.",
    },
  ],
} as const;

export const testimonials = [
  {
    quote:
      "The team treats my mother like family. For the first time in years, I'm not worried about her every day.",
    name: "Diane R.",
    relation: "Daughter of a resident",
  },
  {
    quote:
      "I came for respite after surgery and ended up staying. The food, the people, the garden — it just feels like home.",
    name: "Walter P.",
    relation: "Resident",
  },
  {
    quote:
      "There's always something going on. My dad has more of a social life now than I do!",
    name: "Marcus T.",
    relation: "Son of a resident",
  },
] as const;

export const nav = [
  { label: "About", href: "/about" },
  { label: "Care", href: "/care" },
  { label: "Amenities", href: "/amenities" },
  { label: "Life", href: "/life" },
  { label: "Floor Plans", href: "/floor-plans" },
  { label: "Contact", href: "/contact" },
] as const;

/**
 * Intro copy for each inner page's header banner (PageHero). Keeping it here
 * keeps page components focused on layout.
 */
export const pages = {
  about: {
    eyebrow: "Welcome home",
    heading: "A warm place to call home in Pinehurst Valley",
    lead: "For more than fifteen years, Cedar Hollow has given older adults a setting where independence and support come together — close to family, surrounded by cedar groves.",
  },
  care: {
    eyebrow: "Services & care",
    heading: "The right level of support, exactly when it's needed",
    lead: "Whether you're planning ahead or need care today, our team helps you find the option that fits — and adjusts as your needs change.",
  },
  amenities: {
    eyebrow: "Amenities",
    heading: "Everything you need, thoughtfully included",
    lead: "From chef-prepared meals to a courtyard bird sanctuary, the details that make daily life easier and more enjoyable are already taken care of.",
  },
  life: {
    eyebrow: "Life enrichment",
    heading: "Always something to look forward to",
    lead: "From quiet mornings in the garden to lively evenings with friends, our calendar is built around the things that bring residents joy.",
  },
  floorplans: {
    eyebrow: "Floor plans",
    heading: "Apartments that feel like home",
    lead: "Thoughtfully designed studios and suites you can make your own — with all the support of assisted living just outside your door.",
  },
  contact: {
    eyebrow: "Schedule a visit",
    heading: "Come see Cedar Hollow for yourself",
    lead: "Tell us a little about what you're looking for and we'll set up a visit that works for you.",
  },
} as const;
