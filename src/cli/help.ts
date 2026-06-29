import { renderTemplateFile } from "../template.js"

export const printHelp = (): void =>
  console.log(renderTemplateFile(new URL("./help.txt", import.meta.url)))
