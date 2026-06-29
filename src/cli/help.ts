import { renderTemplateFile } from "../template.js";

export function printHelp(): void {
  console.log(renderTemplateFile(new URL("./help.txt", import.meta.url)));
}
