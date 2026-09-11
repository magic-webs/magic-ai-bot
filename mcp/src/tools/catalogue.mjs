/**
 * The product catalogue an agent is allowed to talk about.
 */

import { z } from "zod";
import { kvArg, requirementFieldArg, workspaceArg } from "../args.mjs";
import { api, call } from "../convex.mjs";
import { findProduct } from "../lookup.mjs";
import { handler, ok, productBrief } from "../results.mjs";
import { resolveWorkspace } from "../workspaces.mjs";

/** @param {import("@modelcontextprotocol/sdk/server/mcp.js").McpServer} server */
export function register(server) {
  server.registerTool(
    "list_products",
    {
      title: "List products",
      description:
        "The catalogue. Agents refuse to discuss anything not listed here, and never quote a price a product does not carry.",
      inputSchema: {
        ...workspaceArg,
        search: z.string().optional(),
        category: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ workspace, search, category }) => {
      const found = await resolveWorkspace(workspace);
      const products = await call.query(api.products.listByWorkspace, {
        workspaceId: found._id,
        search,
        category,
      });
      return ok(products.map(productBrief));
    })
  );

  const productFields = {
    sku: z.string().optional(),
    category: z.string().optional().describe("Defaults to 'General'"),
    description: z.string().optional(),
    price: z
      .number()
      .optional()
      .describe(
        "Leave unset and agents are told never to quote — the team quotes manually."
      ),
    unit: z.string().optional().describe("What the price is per, e.g. 'per 1000'"),
    requirementFields: z
      .array(requirementFieldArg)
      .optional()
      .describe(
        "The spec questions an agent must collect before it can record an order for this product."
      ),
    attributes: z
      .array(kvArg)
      .optional()
      .describe("Extra facts an agent may state — lead time, minimum order"),
    imageUrls: z
      .array(z.string())
      .optional()
      .describe(
        "Image URLs, first is the catalogue thumbnail. Uploading files is the dashboard's job; this takes addresses."
      ),
    exampleSpec: z.string().optional(),
    notes: z.string().optional().describe("Internal — never shown to customers"),
    tags: z.array(z.string()).optional(),
  };

  const toImages = (imageUrls) =>
    imageUrls === undefined
      ? undefined
      : imageUrls
          .map((url) => url.trim())
          .filter(Boolean)
          .map((url) => ({ externalUrl: url }));

  server.registerTool(
    "create_product",
    {
      title: "Create product",
      description:
        "Add a product to the catalogue. Set requirementFields to the questions an agent must ask before it can take an order for it — that is what turns a chat into a complete enquiry.",
      inputSchema: {
        ...workspaceArg,
        name: z.string(),
        currency: z
          .string()
          .optional()
          .describe("Defaults to the workspace currency when a price is given"),
        ...productFields,
      },
    },
    handler(async ({ workspace, imageUrls, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const productId = await call.mutation(api.products.create, {
        workspaceId: found._id,
        currency: fields.price !== undefined ? fields.currency ?? found.currency : undefined,
        ...fields,
        images: toImages(imageUrls),
      });
      return ok({ productId, name: fields.name });
    })
  );

  server.registerTool(
    "update_product",
    {
      title: "Update product",
      description:
        "Change a product. Omitted fields are left alone; arrays replace the whole list.",
      inputSchema: {
        ...workspaceArg,
        product: z.string().describe("Product name, SKU, slug or id"),
        name: z.string().optional(),
        currency: z.string().optional(),
        status: z.enum(["active", "archived"]).optional(),
        ...productFields,
      },
    },
    handler(async ({ workspace, product, imageUrls, ...fields }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findProduct(found._id, product);
      await call.mutation(api.products.update, {
        productId: target._id,
        ...fields,
        images: toImages(imageUrls),
      });
      return ok(`Updated ${target.name}.`);
    })
  );

  server.registerTool(
    "delete_product",
    {
      title: "Delete product",
      description:
        "Permanently delete a product and its uploaded images. Archiving with update_product status:'archived' is usually better — it keeps the record and stops agents offering it.",
      inputSchema: {
        ...workspaceArg,
        product: z.string().describe("Product name, SKU, slug or id"),
      },
      annotations: { destructiveHint: true },
    },
    handler(async ({ workspace, product }) => {
      const found = await resolveWorkspace(workspace);
      const target = await findProduct(found._id, product);
      await call.mutation(api.products.remove, { productId: target._id });
      return ok(`Deleted ${target.name}.`);
    })
  );

  server.registerTool(
    "import_products",
    {
      title: "Import products",
      description:
        "Create or update many products at once, matched by name. A product already in the catalogue is updated rather than duplicated. Omitting imageUrls on an existing product keeps the images it already has.",
      inputSchema: {
        ...workspaceArg,
        products: z
          .array(
            z.object({
              name: z.string(),
              currency: z.string().optional(),
              ...productFields,
            })
          )
          .min(1),
      },
    },
    handler(async ({ workspace, products }) => {
      const found = await resolveWorkspace(workspace);
      const result = await call.mutation(api.products.bulkImport, {
        workspaceId: found._id,
        products: products.map(({ imageUrls, ...rest }) => ({
          ...rest,
          imageUrls: imageUrls?.map((url) => url.trim()).filter(Boolean),
        })),
      });
      return ok(result);
    })
  );

  server.registerTool(
    "draft_catalogue",
    {
      title: "Draft a starter catalogue",
      description:
        "Have the platform's own model draft a starter catalogue from the workspace's industry and description, including the spec questions for each product. Costs tokens against the workspace. Review with list_products afterwards — it is a starting point, not a price list.",
      inputSchema: {
        ...workspaceArg,
        brief: z
          .string()
          .optional()
          .describe("Extra steer, e.g. 'focus on large-format print'"),
      },
    },
    handler(async ({ workspace, brief }) => {
      const found = await resolveWorkspace(workspace);
      const result = await call.action(api.ai.draftCatalogue, {
        workspaceId: found._id,
        brief,
      });
      return ok(result);
    })
  );
}
