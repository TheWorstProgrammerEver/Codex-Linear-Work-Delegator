import { chmodSync } from "node:fs"

chmodSync(new URL("../dist/src/cli.js", import.meta.url), 0o755)
