/**
 * Outbound WhatsApp message bodies, built and bounded.
 *
 * Grounded in the 1Automations panel's own Postman collection. Its messaging
 * endpoint is Cloud-API-compatible — byte-identical payloads and the same
 * `Authorization: Bearer <access token>` — and differs from Meta only in the
 * path, `/api/meta/<version>/<phone_number_id>/messages`. A channel's
 * `apiBaseUrl` already carries that prefix, so nothing here is panel-specific.
 *
 * Pure on purpose: these shapes are fiddly, every field has a length limit, and
 * WhatsApp rejects the *whole* message when one is exceeded — a 21-character
 * button title means the customer receives nothing at all. Being able to build
 * a payload without a deployment is what makes that testable.
 */

// --- Limits, from the Cloud API reference ---------------------------------
// Exceeding any of these is a 400, not a truncation, so they are clamped here
// rather than hoped about. A model writing button labels will overshoot.
const CAP = {
  text: 4096,
  caption: 1024,
  header: 60,
  body: 1024,
  footer: 60,
  buttonTitle: 20,
  buttonId: 256,
  listButton: 20,
  rowTitle: 24,
  rowDescription: 72,
  sectionTitle: 24,
  buttons: 3,
  rows: 10,
  sections: 10,
} as const;

/** Hard clamp. No ellipsis: these are labels, and "Confirm or…" reads worse. */
const clamp = (value: string, max: number): string =>
  value.trim().slice(0, max);

export type MediaRef = { link: string } | { id: string };

export type HeaderSpec =
  | { type: "text"; text: string }
  | { type: "image"; media: MediaRef }
  | { type: "video"; media: MediaRef }
  | { type: "document"; media: MediaRef; filename?: string };

export type ReplyButton = { id: string; title: string };
export type ListRow = { id: string; title: string; description?: string };
export type ListSection = { title: string; rows: ListRow[] };

export type ContactCard = {
  formattedName: string;
  firstName?: string;
  lastName?: string;
  middleName?: string;
  prefix?: string;
  suffix?: string;
  /** YYYY-MM-DD. */
  birthday?: string;
  phones?: Array<{ phone: string; type?: string; waId?: string }>;
  emails?: Array<{ email: string; type?: string }>;
  org?: { company?: string; department?: string; title?: string };
  urls?: Array<{ url: string; type?: string }>;
  addresses?: Array<{
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    countryCode?: string;
    type?: string;
  }>;
};

/** One card of a carousel template: an image and the variables its buttons take. */
export type CarouselCard = {
  imageLink: string;
  /** Body variables for this card, in order. */
  bodyVariables?: string[];
  /** Variable for the card's URL button suffix, when the template has one. */
  urlVariable?: string;
  /** Payload for the card's quick-reply button, when the template has one. */
  quickReplyPayload?: string;
};

export type Outbound =
  | { kind: "text"; body: string; previewUrl?: boolean }
  | {
      kind: "media";
      media: "image" | "video" | "audio" | "document";
      source: MediaRef;
      caption?: string;
      filename?: string;
    }
  | {
      kind: "location";
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    }
  | { kind: "contacts"; contacts: ContactCard[] }
  | { kind: "reaction"; messageId: string; emoji: string }
  | {
      kind: "buttons";
      body: string;
      buttons: ReplyButton[];
      header?: HeaderSpec;
      footer?: string;
    }
  | {
      kind: "list";
      body: string;
      buttonText: string;
      sections: ListSection[];
      header?: HeaderSpec;
      footer?: string;
    }
  | {
      kind: "cta_url";
      body: string;
      displayText: string;
      url: string;
      header?: HeaderSpec;
      footer?: string;
    }
  | {
      kind: "flow";
      body: string;
      flowId: string;
      flowToken: string;
      flowCta: string;
      screen?: string;
      mode?: "draft" | "published";
      header?: HeaderSpec;
      footer?: string;
    }
  | { kind: "request_location"; body: string }
  | { kind: "request_address"; body: string; country: string }
  | {
      kind: "product";
      body: string;
      catalogId: string;
      productRetailerId: string;
      footer?: string;
    }
  | {
      kind: "product_list";
      body: string;
      catalogId: string;
      sections: Array<{ title: string; productRetailerIds: string[] }>;
      header?: HeaderSpec;
      footer?: string;
    }
  | {
      kind: "catalog";
      body: string;
      thumbnailProductRetailerId?: string;
      footer?: string;
    }
  | {
      kind: "carousel";
      /** An approved carousel template. Carousels cannot be composed ad hoc. */
      templateName: string;
      languageCode: string;
      bodyVariables?: string[];
      cards: CarouselCard[];
    };

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function headerJson(header: HeaderSpec | undefined): Json | undefined {
  if (!header) return undefined;
  if (header.type === "text") {
    return { type: "text", text: clamp(header.text, CAP.header) };
  }
  if (header.type === "document") {
    return {
      type: "document",
      document: {
        ...header.media,
        ...(header.filename ? { filename: header.filename } : {}),
      },
    };
  }
  return { type: header.type, [header.type]: header.media };
}

function interactive(
  type: string,
  parts: {
    body: string;
    action: Json;
    header?: HeaderSpec;
    footer?: string;
  }
): Json {
  const header = headerJson(parts.header);
  return {
    type: "interactive",
    interactive: {
      type,
      ...(header ? { header } : {}),
      body: { text: clamp(parts.body, CAP.body) },
      ...(parts.footer?.trim()
        ? { footer: { text: clamp(parts.footer, CAP.footer) } }
        : {}),
      action: parts.action,
    },
  };
}

function contactJson(card: ContactCard): Json {
  return {
    name: {
      formatted_name: card.formattedName,
      ...(card.firstName ? { first_name: card.firstName } : {}),
      ...(card.lastName ? { last_name: card.lastName } : {}),
      ...(card.middleName ? { middle_name: card.middleName } : {}),
      ...(card.prefix ? { prefix: card.prefix } : {}),
      ...(card.suffix ? { suffix: card.suffix } : {}),
    },
    ...(card.birthday ? { birthday: card.birthday } : {}),
    ...(card.phones?.length
      ? {
          phones: card.phones.map((p) => ({
            phone: p.phone,
            ...(p.type ? { type: p.type } : {}),
            ...(p.waId ? { wa_id: p.waId } : {}),
          })),
        }
      : {}),
    ...(card.emails?.length
      ? {
          emails: card.emails.map((e) => ({
            email: e.email,
            ...(e.type ? { type: e.type } : {}),
          })),
        }
      : {}),
    ...(card.org ? { org: card.org } : {}),
    ...(card.urls?.length ? { urls: card.urls } : {}),
    ...(card.addresses?.length
      ? {
          addresses: card.addresses.map((a) => ({
            ...(a.street ? { street: a.street } : {}),
            ...(a.city ? { city: a.city } : {}),
            ...(a.state ? { state: a.state } : {}),
            ...(a.zip ? { zip: a.zip } : {}),
            ...(a.country ? { country: a.country } : {}),
            ...(a.countryCode ? { country_code: a.countryCode } : {}),
            ...(a.type ? { type: a.type } : {}),
          })),
        }
      : {}),
  };
}

/**
 * A carousel is a *template* message, and the only one here that is.
 *
 * WhatsApp has no ad-hoc carousel: the cards, their button types and the
 * position of every variable are fixed when the template is approved in Meta,
 * and a send only fills the blanks in. So this takes a template name and per
 * card supplies the image and the variable values, in the component shape the
 * collection's "Carousel Template" request uses.
 */
function carouselJson(message: Extract<Outbound, { kind: "carousel" }>): Json {
  return {
    type: "template",
    template: {
      name: message.templateName,
      language: { policy: "deterministic", code: message.languageCode },
      components: [
        ...(message.bodyVariables?.length
          ? [
              {
                type: "body",
                parameters: message.bodyVariables.map((text) => ({
                  type: "text",
                  text,
                })),
              },
            ]
          : []),
        {
          type: "carousel",
          cards: message.cards.map((card, index) => ({
            card_index: index,
            components: [
              {
                type: "header",
                parameters: [{ type: "image", image: { link: card.imageLink } }],
              },
              ...(card.bodyVariables?.length
                ? [
                    {
                      type: "body",
                      parameters: card.bodyVariables.map((text) => ({
                        type: "text",
                        text,
                      })),
                    },
                  ]
                : []),
              // index is the button's position within the card, so a template
              // with both a quick reply and a URL button numbers them 0 and 1.
              ...(card.quickReplyPayload
                ? [
                    {
                      type: "button",
                      sub_type: "quick_reply",
                      index: 0,
                      parameters: [
                        { type: "payload", payload: card.quickReplyPayload },
                      ],
                    },
                  ]
                : []),
              ...(card.urlVariable
                ? [
                    {
                      type: "button",
                      sub_type: "url",
                      index: card.quickReplyPayload ? 1 : 0,
                      parameters: [{ type: "text", text: card.urlVariable }],
                    },
                  ]
                : []),
            ],
          })),
        },
      ],
    },
  };
}

/** The `type`-and-payload half of the request body, without the envelope. */
function payloadFor(message: Outbound): Json {
  switch (message.kind) {
    case "text":
      return {
        type: "text",
        text: {
          body: clamp(message.body, CAP.text),
          preview_url: message.previewUrl ?? false,
        },
      };

    case "media":
      return {
        type: message.media,
        [message.media]: {
          ...message.source,
          // Audio carries neither a caption nor a filename.
          ...(message.caption && message.media !== "audio"
            ? { caption: clamp(message.caption, CAP.caption) }
            : {}),
          ...(message.filename && message.media === "document"
            ? { filename: message.filename }
            : {}),
        },
      };

    case "location":
      return {
        type: "location",
        location: {
          // Strings, as the collection sends them.
          latitude: String(message.latitude),
          longitude: String(message.longitude),
          ...(message.name ? { name: message.name } : {}),
          ...(message.address ? { address: message.address } : {}),
        },
      };

    case "contacts":
      return { type: "contacts", contacts: message.contacts.map(contactJson) };

    case "reaction":
      return {
        type: "reaction",
        reaction: { message_id: message.messageId, emoji: message.emoji },
      };

    case "buttons":
      return interactive("button", {
        body: message.body,
        header: message.header,
        footer: message.footer,
        action: {
          buttons: message.buttons.slice(0, CAP.buttons).map((button) => ({
            type: "reply",
            reply: {
              id: clamp(button.id, CAP.buttonId),
              title: clamp(button.title, CAP.buttonTitle),
            },
          })),
        },
      });

    case "list": {
      // Ten rows across all sections, not ten per section — the cap is on the
      // total, and overshooting it fails the send rather than trimming the list.
      let remaining = CAP.rows;
      const sections = [];
      for (const section of message.sections.slice(0, CAP.sections)) {
        if (remaining <= 0) break;
        const rows = section.rows.slice(0, remaining);
        remaining -= rows.length;
        sections.push({
          title: clamp(section.title, CAP.sectionTitle),
          rows: rows.map((row) => ({
            id: clamp(row.id, CAP.buttonId),
            title: clamp(row.title, CAP.rowTitle),
            ...(row.description
              ? { description: clamp(row.description, CAP.rowDescription) }
              : {}),
          })),
        });
      }
      return interactive("list", {
        body: message.body,
        header: message.header,
        footer: message.footer,
        action: {
          button: clamp(message.buttonText, CAP.listButton),
          sections,
        },
      });
    }

    case "cta_url":
      return interactive("cta_url", {
        body: message.body,
        header: message.header,
        footer: message.footer,
        action: {
          name: "cta_url",
          parameters: {
            display_text: clamp(message.displayText, CAP.buttonTitle),
            url: message.url,
          },
        },
      });

    case "flow":
      return interactive("flow", {
        body: message.body,
        header: message.header,
        footer: message.footer,
        action: {
          name: "flow",
          parameters: {
            flow_message_version: "3",
            flow_token: message.flowToken,
            flow_id: message.flowId,
            flow_cta: clamp(message.flowCta, CAP.buttonTitle),
            flow_action: "navigate",
            mode: message.mode ?? "published",
            ...(message.screen
              ? { flow_action_payload: { screen: message.screen } }
              : {}),
          },
        },
      });

    case "request_location":
      return interactive("location_request_message", {
        body: message.body,
        action: { name: "send_location" },
      });

    case "request_address":
      return interactive("address_message", {
        body: message.body,
        action: {
          name: "address_message",
          parameters: { country: message.country },
        },
      });

    case "product":
      return interactive("product", {
        body: message.body,
        footer: message.footer,
        action: {
          catalog_id: message.catalogId,
          product_retailer_id: message.productRetailerId,
        },
      });

    case "product_list":
      return interactive("product_list", {
        body: message.body,
        header: message.header ?? { type: "text", text: "Catalogue" },
        footer: message.footer,
        action: {
          catalog_id: message.catalogId,
          sections: message.sections.map((section) => ({
            title: clamp(section.title, CAP.sectionTitle),
            product_items: section.productRetailerIds.map((id) => ({
              product_retailer_id: id,
            })),
          })),
        },
      });

    case "catalog":
      return interactive("catalog_message", {
        body: message.body,
        footer: message.footer,
        action: {
          name: "catalog_message",
          ...(message.thumbnailProductRetailerId
            ? {
                parameters: {
                  thumbnail_product_retailer_id:
                    message.thumbnailProductRetailerId,
                },
              }
            : {}),
        },
      });

    case "carousel":
      return carouselJson(message);
  }
}

/**
 * The complete request body. `replyTo` threads the message under one the
 * customer sent, which is what makes a reply read as an answer rather than as
 * a new topic.
 */
export function buildMessage(
  to: string,
  message: Outbound,
  replyTo?: string
): Json {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    ...(replyTo ? { context: { message_id: replyTo } } : {}),
    ...payloadFor(message),
  };
}

/** Long text has to be split; WhatsApp caps a body at 4096. */
export const MAX_TEXT_BODY = CAP.text;

/**
 * One line describing what the customer was shown.
 *
 * Used three ways, which is why it lives beside the builders rather than in any
 * one of them: as the conversation's last-message preview, as the line the
 * transcript shows under the rendered message, and as the text replayed to the
 * model next turn — without which it forgets it has already put a menu on
 * screen and offers the same one again.
 */
export function summarise(message: Outbound): string {
  switch (message.kind) {
    case "text":
      return message.body;
    case "media":
      return message.caption?.trim()
        ? `[${message.media}] ${message.caption}`
        : `[sent a ${message.media}]`;
    case "location":
      return `[shared a location${message.name ? `: ${message.name}` : ""}]`;
    case "contacts":
      return `[shared a contact card: ${message.contacts
        .map((c) => c.formattedName)
        .join(", ")}]`;
    case "reaction":
      return `[reacted ${message.emoji}]`;
    case "buttons":
      return `${message.body} [buttons: ${message.buttons
        .map((b) => b.title)
        .join(" | ")}]`;
    case "list":
      return `${message.body} [list "${message.buttonText}": ${message.sections
        .flatMap((s) => s.rows.map((r) => r.title))
        .join(" | ")}]`;
    case "cta_url":
      return `${message.body} [link button "${message.displayText}"]`;
    case "flow":
      return `${message.body} [form: ${message.flowCta}]`;
    case "request_location":
      return `${message.body} [asked for their location]`;
    case "request_address":
      return `${message.body} [asked for their delivery address]`;
    case "product":
      return `${message.body} [one catalogue product]`;
    case "product_list":
      return `${message.body} [catalogue: ${message.sections.length} section(s)]`;
    case "catalog":
      return `${message.body} [catalogue]`;
    case "carousel":
      return `[carousel: ${message.cards.length} cards]`;
  }
}
