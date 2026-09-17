/**
 * A starter catalogue, and the swatch images that go with it.
 *
 * Two problems this solves. The first is the empty page: a company opening the
 * catalogue step has to invent the shape of a catalogue entry before it can
 * write one, and "name, description, price" does not tell anyone that the spec
 * questions are what turn a chat into an order. The second is variants — the
 * platform has no variant table, and the right way to say "we do it in black
 * and blue" is a `select` requirement field plus one image per option. Nobody
 * derives that from an empty form.
 *
 * So the samples are written to be read, not just clicked: between them they
 * cover a priced product, a product priced per unit, a product with no price at
 * all, a flat-fee service and a quote-only service, and every requirement type
 * the engine supports — text, number, select, boolean and date.
 *
 * Every sample loads into the form for editing rather than saving straight to
 * the catalogue. They are examples of a shape, not of your prices.
 */

export type RequirementType = "text" | "number" | "select" | "boolean" | "date";

export type RequirementDraft = {
  key: string;
  label: string;
  type: RequirementType;
  required: boolean;
  options?: string[];
  example?: string;
};

export type VariantOption = {
  name: string;
  /** Drawn into the option's placeholder image. */
  hex: string;
};

export type VariantGroup = {
  /** "Colour", "Metal", "Finish" — becomes the select question's label. */
  label: string;
  options: VariantOption[];
};

export type Sample = {
  /** Presentation and defaults only — see `kindOf` in the catalogue step. */
  kind: "product" | "service";
  name: string;
  category: string;
  description: string;
  /** Omitted where the point of the sample is that an agent must not quote. */
  price?: number;
  unit?: string;
  tags: string[];
  variants?: VariantGroup;
  requirements: RequirementDraft[];
  notes?: string;
  /** Why this one is in the list, shown on its card. */
  demonstrates: string;
};

export type SamplePack = {
  id: string;
  label: string;
  blurb: string;
  items: Sample[];
};

// ---------------------------------------------------------------- the images

/** Perceived brightness, so the label on a swatch stays readable. */
function isLight(hex: string): boolean {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Rec. 601 luma. Good enough to pick black or white text.
  return (r * 299 + g * 587 + b * 114) / 1000 > 140;
}

const escapeXml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * A placeholder image for one variant, as an SVG data URI.
 *
 * Deliberately not a stock photograph. An image here is stored as
 * `externalUrl` and travels into real data — an agent will send it to a
 * customer — so a hotlinked photo of somebody else's product is a broken link
 * and a wrong picture waiting to happen. A labelled swatch in the actual colour
 * is honest about being a placeholder, weighs about half a kilobyte, needs no
 * host, and still answers "have you got it in blue?" with something to look at
 * until a real photograph replaces it.
 */
export function swatchImage(hex: string, option: string, product: string): string {
  const ink = isLight(hex) ? "#1a1a1a" : "#ffffff";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
<defs><radialGradient id="g" cx="32%" cy="26%" r="78%">
<stop offset="0" stop-color="#ffffff" stop-opacity="${isLight(hex) ? 0.55 : 0.22}"/>
<stop offset="1" stop-color="#000000" stop-opacity="0.18"/>
</radialGradient></defs>
<rect width="640" height="480" fill="${hex}"/>
<rect width="640" height="480" fill="url(#g)"/>
<rect x="28" y="28" width="584" height="424" rx="18" fill="none" stroke="${ink}" stroke-opacity="0.22" stroke-width="2"/>
<text x="56" y="86" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="24" fill="${ink}" fill-opacity="0.72">${escapeXml(product)}</text>
<text x="56" y="404" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="58" font-weight="600" fill="${ink}">${escapeXml(option)}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\n/g, ""))}`;
}

/**
 * Reads the colour back out of a swatch this module generated.
 *
 * The hex is not stored anywhere else — putting `Black:#1a1a1a` in the
 * product's attributes would round-trip more simply but those attributes are
 * handed to the model, and a hex code in the prompt is noise an agent may well
 * repeat at a customer. The swatch itself is the record, so editing a product
 * parses it back. Anything that is not one of ours — an uploaded photograph, a
 * remote URL — returns null and is left alone.
 */
export function hexFromSwatch(url: string): string | null {
  if (!url.startsWith("data:image/svg+xml")) return null;
  const decoded = (() => {
    try {
      return decodeURIComponent(url.slice(url.indexOf(",") + 1));
    } catch {
      return "";
    }
  })();
  const match = decoded.match(
    /<rect width="640" height="480" fill="(#[0-9a-fA-F]{3,8})"/
  );
  return match?.[1] ?? null;
}

/** Whether an image is a generated swatch rather than a real picture. */
export const isSwatch = (url: string) => hexFromSwatch(url) !== null;

/** A tiny flat swatch, for the colour dot beside a variant name in the editor. */
export function swatchDot(hex: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" rx="12" fill="${hex}"/></svg>`
  )}`;
}

/** Colours offered when someone adds a variant option of their own. */
export const VARIANT_PALETTE: VariantOption[] = [
  { name: "Black", hex: "#1a1a1a" },
  { name: "Blue", hex: "#1d4ed8" },
  { name: "Navy", hex: "#1e293b" },
  { name: "White", hex: "#f4f4f5" },
  { name: "Silver", hex: "#c3c8cf" },
  { name: "Gold", hex: "#c9a227" },
  { name: "Rose gold", hex: "#e0a899" },
  { name: "Green", hex: "#15803d" },
  { name: "Red", hex: "#b91c1c" },
  { name: "Natural", hex: "#d9cbb3" },
];

// ----------------------------------------------------------------- the packs

export const SAMPLE_PACKS: SamplePack[] = [
  {
    id: "jewellery",
    label: "Jewellery",
    blurb: "Metal variants, ring sizing, and a consultation that must not be priced.",
    items: [
      {
        kind: "product",
        name: "Solitaire engagement ring",
        category: "Rings",
        description:
          "A single brilliant-cut stone on a plain band, made to order in your choice of metal. Set in our own workshop and hallmarked before it leaves us.",
        price: 68000,
        tags: ["bridal", "made to order"],
        demonstrates: "Colour variants, a required size and an optional engraving",
        variants: {
          label: "Metal",
          options: [
            { name: "Yellow gold", hex: "#c9a227" },
            { name: "White gold", hex: "#d8dade" },
            { name: "Rose gold", hex: "#e0a899" },
            { name: "Platinum", hex: "#b9bec6" },
          ],
        },
        requirements: [
          {
            key: "ring_size",
            label: "Ring size",
            type: "number",
            required: true,
            example: "14",
          },
          {
            key: "centre_stone",
            label: "Centre stone weight",
            type: "text",
            required: true,
            example: "0.50 carat",
          },
          {
            key: "engraving",
            label: "Engraving inside the band",
            type: "text",
            required: false,
            example: "A & R · 12.11.26",
          },
          {
            key: "needed_by",
            label: "Needed by",
            type: "date",
            required: false,
            example: "2026-11-12",
          },
        ],
        notes:
          "Sizing beyond 22 adds two weeks. Never promise a date inside three weeks without checking the workshop.",
      },
      {
        kind: "product",
        name: "22kt gold chain",
        category: "Chains",
        description:
          "Classic rope chain in 22kt gold, sold by weight at the day's rate plus making charges. Every piece is hallmarked.",
        price: 7400,
        unit: "per gram",
        tags: ["gold", "by weight"],
        demonstrates: "A price with a unit, so the agent quotes “per gram”",
        variants: {
          label: "Length",
          options: [
            { name: "16 inch", hex: "#c9a227" },
            { name: "18 inch", hex: "#cfa93a" },
            { name: "20 inch", hex: "#d4b04c" },
            { name: "24 inch", hex: "#dab85e" },
          ],
        },
        requirements: [
          {
            key: "length",
            label: "Length",
            type: "select",
            required: true,
            options: ["16 inch", "18 inch", "20 inch", "24 inch"],
          },
          {
            key: "weight",
            label: "Approximate weight wanted",
            type: "number",
            required: true,
            example: "12 grams",
          },
          {
            key: "hallmark",
            label: "Hallmarking certificate needed",
            type: "boolean",
            required: false,
          },
        ],
      },
      {
        kind: "service",
        name: "Cleaning and polishing",
        category: "Services",
        description:
          "Ultrasonic clean, polish and rhodium touch-up where needed. Same-day on most pieces, collected from the counter.",
        price: 500,
        unit: "per piece",
        tags: ["service", "walk-in"],
        demonstrates: "A flat-fee service with a simple count",
        requirements: [
          {
            key: "item_type",
            label: "What needs cleaning",
            type: "text",
            required: true,
            example: "Two rings and a chain",
          },
          {
            key: "pieces",
            label: "Number of pieces",
            type: "number",
            required: true,
            example: "3",
          },
        ],
      },
      {
        kind: "service",
        name: "Bespoke design consultation",
        category: "Services",
        description:
          "An hour with a designer to work up a piece from scratch — sketches, stone options and a written quote afterwards.",
        tags: ["service", "by appointment"],
        demonstrates:
          "No price at all, so the agent has to take the enquiry instead of quoting",
        requirements: [
          {
            key: "occasion",
            label: "Occasion",
            type: "text",
            required: true,
            example: "Engagement",
          },
          {
            key: "budget",
            label: "Budget range",
            type: "select",
            required: true,
            options: [
              "Under 50,000",
              "50,000 – 1,00,000",
              "1,00,000 – 3,00,000",
              "Above 3,00,000",
            ],
          },
          {
            key: "appointment",
            label: "Preferred date",
            type: "date",
            required: false,
          },
        ],
        notes:
          "Quote only after the designer has seen the brief. There is no list price for bespoke work.",
      },
    ],
  },
  {
    id: "signage",
    label: "Print and signage",
    blurb: "Made-to-measure pricing, a yes/no option and an on-site service.",
    items: [
      {
        kind: "product",
        name: "Illuminated fascia sign",
        category: "Shopfront signage",
        description:
          "Aluminium tray with an acrylic face and LED illumination, made to your shopfront width and installed by us.",
        price: 450,
        unit: "per linear metre",
        tags: ["exterior", "made to measure"],
        demonstrates: "Colour variants plus a yes/no specification",
        variants: {
          label: "Tray colour",
          options: [
            { name: "Black", hex: "#1a1a1a" },
            { name: "Blue", hex: "#1d4ed8" },
            { name: "White", hex: "#f4f4f5" },
            { name: "Silver", hex: "#c3c8cf" },
          ],
        },
        requirements: [
          {
            key: "width_m",
            label: "Shopfront width in metres",
            type: "number",
            required: true,
            example: "3.2",
          },
          {
            key: "tray_colour",
            label: "Tray colour",
            type: "select",
            required: true,
            options: ["Black", "Blue", "White", "Silver"],
          },
          {
            key: "illuminated",
            label: "Illuminated",
            type: "boolean",
            required: true,
          },
          {
            key: "fitting_height",
            label: "Height above pavement",
            type: "text",
            required: false,
            example: "About 3.5 metres",
          },
        ],
        notes:
          "Anything above 4 metres needs a scaffold tower, which is quoted separately.",
      },
      {
        kind: "product",
        name: "Cut vinyl lettering",
        category: "Window graphics",
        description:
          "Weeded and taped cut vinyl for windows and vehicles, supplied ready to apply or fitted by us.",
        price: 28,
        unit: "per square metre",
        tags: ["interior", "exterior"],
        demonstrates: "A finish variant on a low-value, high-volume line",
        variants: {
          label: "Finish",
          options: [
            { name: "Matt black", hex: "#1a1a1a" },
            { name: "Gloss white", hex: "#f4f4f5" },
            { name: "Blue", hex: "#1d4ed8" },
            { name: "Frosted", hex: "#dfe6ea" },
          ],
        },
        requirements: [
          {
            key: "finish",
            label: "Finish",
            type: "select",
            required: true,
            options: ["Matt black", "Gloss white", "Blue", "Frosted"],
          },
          {
            key: "artwork",
            label: "Artwork supplied",
            type: "boolean",
            required: true,
          },
          {
            key: "text",
            label: "Wording",
            type: "text",
            required: true,
            example: "Open 9–6 · Closed Sunday",
          },
        ],
      },
      {
        kind: "service",
        name: "Site survey and installation",
        category: "Services",
        description:
          "We measure on site, check the fixing and fit the finished sign. Covers travel within 30 miles.",
        price: 180,
        unit: "per visit",
        tags: ["service", "on site"],
        demonstrates: "A per-visit service with a date the agent must collect",
        requirements: [
          {
            key: "postcode",
            label: "Site postcode",
            type: "text",
            required: true,
            example: "LS7 2BB",
          },
          {
            key: "access",
            label: "Access from the pavement",
            type: "select",
            required: true,
            options: ["Clear", "Parking restrictions", "Scaffold needed"],
          },
          {
            key: "preferred_date",
            label: "Preferred date",
            type: "date",
            required: true,
          },
        ],
      },
      {
        kind: "service",
        name: "Artwork setup and proofing",
        category: "Services",
        description:
          "Redrawing a logo to print quality, laying out the sign and sending a proof to sign off before anything is made.",
        tags: ["service", "studio"],
        demonstrates: "A studio service quoted on the brief, never off a list",
        requirements: [
          {
            key: "file_type",
            label: "What you can send us",
            type: "select",
            required: true,
            options: ["Vector (AI, EPS, PDF)", "A photo or JPEG", "Nothing yet"],
          },
          {
            key: "brief",
            label: "What it needs to say",
            type: "text",
            required: true,
            example: "Shop name and phone number, matching our van livery",
          },
        ],
        notes: "Vector artwork is usually free to set up; a redraw is charged by the hour.",
      },
    ],
  },
  {
    id: "apparel",
    label: "Apparel and merch",
    blurb: "Colour and size together — the case where one product has two variant questions.",
    items: [
      {
        kind: "product",
        name: "Embroidered polo shirt",
        category: "Workwear",
        description:
          "Mid-weight piqué polo with your logo embroidered on the left chest. Machine washable at 40 degrees.",
        price: 18,
        unit: "each",
        tags: ["workwear", "embroidered"],
        demonstrates:
          "Two variant questions on one product — colour as swatches, size as a list",
        variants: {
          label: "Colour",
          options: [
            { name: "Black", hex: "#1a1a1a" },
            { name: "Navy", hex: "#1e293b" },
            { name: "White", hex: "#f4f4f5" },
            { name: "Red", hex: "#b91c1c" },
          ],
        },
        requirements: [
          {
            key: "colour",
            label: "Colour",
            type: "select",
            required: true,
            options: ["Black", "Navy", "White", "Red"],
          },
          {
            key: "sizes",
            label: "Sizes and quantities",
            type: "text",
            required: true,
            example: "4 × M, 6 × L, 2 × XL",
          },
          {
            key: "logo_position",
            label: "Logo position",
            type: "select",
            required: true,
            options: ["Left chest", "Right chest", "Back", "Sleeve"],
          },
          {
            key: "quantity",
            label: "Total quantity",
            type: "number",
            required: true,
            example: "12",
          },
        ],
        notes: "Under 10 pieces carries a small-run surcharge.",
      },
      {
        kind: "product",
        name: "Cotton tote bag",
        category: "Merchandise",
        description:
          "Heavyweight 10oz cotton tote, screen printed one colour on one side. Sold in tens.",
        price: 6.5,
        unit: "each",
        tags: ["merch", "printed"],
        demonstrates: "A simple colour variant with no other questions",
        variants: {
          label: "Colour",
          options: [
            { name: "Natural", hex: "#d9cbb3" },
            { name: "Black", hex: "#1a1a1a" },
            { name: "Blue", hex: "#1d4ed8" },
          ],
        },
        requirements: [
          {
            key: "colour",
            label: "Colour",
            type: "select",
            required: true,
            options: ["Natural", "Black", "Blue"],
          },
          {
            key: "quantity",
            label: "Quantity",
            type: "number",
            required: true,
            example: "50",
          },
        ],
      },
      {
        kind: "product",
        name: "Custom cut-and-sew run",
        category: "Manufacturing",
        description:
          "Made from your pattern in your chosen fabric, minimum 100 pieces per colourway. Every run is costed on the pattern.",
        tags: ["manufacturing", "minimum order"],
        demonstrates: "A product with no price, so the agent takes the enquiry",
        requirements: [
          {
            key: "garment",
            label: "Garment",
            type: "text",
            required: true,
            example: "Oversized hoodie, 400gsm loopback",
          },
          {
            key: "quantity",
            label: "Quantity per colourway",
            type: "number",
            required: true,
            example: "150",
          },
          {
            key: "pattern",
            label: "Pattern ready",
            type: "boolean",
            required: true,
          },
        ],
      },
      {
        kind: "service",
        name: "Logo digitising",
        category: "Services",
        description:
          "Turning your logo into an embroidery file. A one-off charge — once it is done, every future order uses the same file.",
        price: 25,
        unit: "one-off",
        tags: ["service", "setup"],
        demonstrates: "A one-off setup fee that only ever gets charged once",
        requirements: [
          {
            key: "logo_supplied",
            label: "Logo file you can send",
            type: "select",
            required: true,
            options: ["Vector (AI, EPS, PDF)", "PNG or JPEG", "Nothing yet"],
          },
          {
            key: "stitch_colours",
            label: "Number of thread colours",
            type: "number",
            required: false,
            example: "3",
          },
        ],
      },
    ],
  },
];

/** Every sample, flattened — for the "surprise me" and the search box. */
export const ALL_SAMPLES: Sample[] = SAMPLE_PACKS.flatMap((pack) => pack.items);
