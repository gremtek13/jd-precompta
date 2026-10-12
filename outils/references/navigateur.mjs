// Le Chromium préinstallé de l'environnement, quelle que soit sa révision — la recherche du banc (outils/captures/vitrine.mjs),
// remplaçable par la variable CHROMIUM. Le navigateur ne reçoit jamais le mandataire de l'environnement : les scripts de ce
// dossier se lancent sous `env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy` (README.md).
import { existsSync, readdirSync } from 'node:fs'

const RACINE_NAVIGATEURS = '/opt/pw-browsers'
const revision = existsSync(RACINE_NAVIGATEURS)
  ? readdirSync(RACINE_NAVIGATEURS).filter((d) => /^chromium-\d+$/.test(d)).sort().pop()
  : undefined
export const executable = process.env.CHROMIUM ?? (revision ? `${RACINE_NAVIGATEURS}/${revision}/chrome-linux/chrome` : undefined)
