import { renderTemplateFile } from "../template.js"

export const printHelp = (): void =>
  console.log(renderTemplateFile(new URL("./help.txt", import.meta.url)))

export const printReviewHelp = (): void =>
  console.log(renderTemplateFile(new URL("./review-help.txt", import.meta.url)))
