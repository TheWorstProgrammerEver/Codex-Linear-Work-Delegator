import { readFileSync } from "node:fs";

export type TemplateModel = Record<string, string | number | boolean | null | undefined>;

export function renderTemplateFile(fileUrl: URL, model: TemplateModel = {}): string {
  return renderTemplate(readFileSync(fileUrl, "utf8"), model);
}

export function renderTemplate(template: string, model: TemplateModel): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    if (!(key in model)) throw new Error(`Missing template value: ${key}`);
    return String(model[key] ?? "");
  });
}
