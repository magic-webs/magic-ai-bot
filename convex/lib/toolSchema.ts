// Turns the declarative tool definitions stored in the `tools` table into the
// JSON Schema the AI SDK hands to the model, and renders request templates
// from the arguments the model produced.

export type StoredToolParameter = {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
  enumValues?: string[];
};

export type JsonSchemaObject = {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: false;
};

export function parametersToJsonSchema(
  parameters: StoredToolParameter[]
): JsonSchemaObject {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const parameter of parameters) {
    const name = parameter.name.trim();
    if (!name) continue;

    const property: Record<string, unknown> = {
      type: parameter.type,
      description: parameter.description || name,
    };
    if (parameter.type === "string" && parameter.enumValues?.length) {
      property.enum = parameter.enumValues;
    }
    properties[name] = property;
    if (parameter.required) required.push(name);
  }

  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

// Replaces {{param}} / {{ param }} placeholders. Values are stringified;
// `encode` URL-encodes them for use in a URL path or query string.
export function renderTemplate(
  template: string,
  values: Record<string, unknown>,
  encode = false
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined || value === null) return "";
    const asString =
      typeof value === "object" ? JSON.stringify(value) : String(value);
    return encode ? encodeURIComponent(asString) : asString;
  });
}

// Any parameter not consumed by the URL or body template is appended as a
// query parameter, so a half-written template still passes the model's input on.
export function unusedParameterKeys(
  parameters: StoredToolParameter[],
  templates: Array<string | undefined>
): string[] {
  const joined = templates.filter(Boolean).join(" ");
  return parameters
    .map((p) => p.name.trim())
    .filter((name) => name && !joined.includes(`{{${name}}}`) && !joined.includes(`{{ ${name} }}`));
}
