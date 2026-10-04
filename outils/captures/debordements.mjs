// Ce qui DÉBORDE du panneau central, onglet par onglet — la vérification à rejouer quand un écran
// change ou quand le panneau de droite gagne un contenu. Ouvert, ce panneau rétrécit le panneau central
// (moins de 700 pixels de contenu à 1 440) : une rangée de boutons ou de champs qui ne passe pas à la
// ligne déborde alors, et son dernier élément disparaît sous le volet sans que rien ne casse ailleurs.
//
//   npx vite --config outils/captures/vite.config.ts        # sert l'application (voir vitrine.mjs)
//   node outils/captures/debordements.mjs [largeur] [sans]  # « sans » : panneau de droite fermé
//
// Un élément compte s'il dépasse le bord droit du panneau central SANS être dans un conteneur qui
// défile (un tableau dans .table-scroll a le droit d'être plus large que l'écran : il défile). Seul le
// plus haut élément en faute est cité, ses descendants débordant forcément avec lui.
import { chromium } from 'playwright-core'
import { existsSync, readdirSync } from 'node:fs'

const ONGLETS = [
  'checklist', 'documents', 'pieces', 'factures', 'banque', 'ecritures', 'statistiques', 'tva', 'immobilisations',
  'cotisations', 'cloture', 'estimation', 'financement', 'supplements', 'packs', 'informations', 'virements', 'acces',
]
// Les onglets qu'un dossier tenu en ENGAGEMENT (d8) rend autrement : le réglage du modèle et le
// brouillon en 401/411, la Clôture sans 2035, les factures sans règlement de la Checklist et de Banque,
// le chiffre d'affaires facturé de l'Estimation.
const ONGLETS_ENGAGEMENT = ['ecritures', 'cloture', 'checklist', 'banque', 'estimation']
const VISITES = [
  // L'onglet TVA sur le seul dossier assujetti tenu en trésorerie : sur le cabinet infirmier, exonéré,
  // il ne montrerait qu'un message, et la vérification ne verrait jamais la déclaration elle-même.
  ...ONGLETS.map((onglet) => ({ dossier: onglet === 'tva' ? 'd7' : 'd1', onglet, nom: onglet })),
  ...ONGLETS_ENGAGEMENT.map((onglet) => ({ dossier: 'd8', onglet, nom: `engagement/${onglet}` })),
  // La connexion bancaire, une récupération faite : l'aperçu de ce qui entrerait — son tableau, son
  // libellé long, ses boutons — n'apparaît qu'après un clic, donc aucune visite ordinaire ne le voit.
  {
    dossier: 'd1', onglet: 'banque', nom: 'banque/récupération',
    apres: (page) => page.getByRole('button', { name: 'Récupérer les mouvements' }).click(),
  },
  // Et un dossier sans banque, la liste des banques ouverte : le choix de la banque et de l'espace.
  {
    dossier: 'd2', onglet: 'banque', nom: 'banque/connecter',
    apres: (page) => page.getByRole('button', { name: 'Connecter une banque' }).click(),
  },
  // Le relevé entier : les pastilles d'un mouvement rapproché, affecté, ventilé ou réglé en groupe ne
  // paraissent pas sous « Non rapprochés », le filtre par défaut.
  {
    dossier: 'd1', onglet: 'banque', nom: 'banque/tous',
    apres: (page) => page.getByRole('button', { name: 'Tous', exact: true }).click(),
  },
  // Le dossier assujetti : ses recettes du relevé, taxées ou sans taux — la pastille « TVA à choisir », le
  // taux d'une recette affectée —, leurs écritures au 445710, et le point de la Checklist qui les compte.
  {
    dossier: 'd7', onglet: 'banque', nom: 'assujetti/banque',
    apres: (page) => page.getByRole('button', { name: 'Tous', exact: true }).click(),
  },
  { dossier: 'd7', onglet: 'ecritures', nom: 'assujetti/ecritures' },
  { dossier: 'd7', onglet: 'checklist', nom: 'assujetti/checklist' },
  // Sa Clôture : la concordance de la 2035 avec les écritures, dont le bien sans nature est l'écart.
  { dossier: 'd7', onglet: 'cloture', nom: 'assujetti/cloture' },
  // Le registre des immobilisations déplié : le tableau d'amortissement d'un bien, le formulaire qui le
  // modifie et celui d'une nature n'apparaissent qu'après un clic. Puis un bien sans nature et plusieurs
  // candidates (dossier assujetti), et une dotation d'un exercice fini qui manque (engagement).
  {
    dossier: 'd1', onglet: 'immobilisations', nom: 'immobilisations/tableau',
    apres: (page) => page.getByRole('button', { name: 'Tableau', exact: true }).first().click(),
  },
  {
    dossier: 'd1', onglet: 'immobilisations', nom: 'immobilisations/modifier',
    apres: (page) => page.getByRole('button', { name: 'Modifier', exact: true }).first().click(),
  },
  {
    dossier: 'd1', onglet: 'immobilisations', nom: 'immobilisations/nature',
    apres: (page) => page.getByRole('button', { name: '+ Nature', exact: true }).first().click(),
  },
  { dossier: 'd7', onglet: 'immobilisations', nom: 'assujetti/immobilisations' },
  { dossier: 'd8', onglet: 'immobilisations', nom: 'engagement/immobilisations' },
]
const largeur = Number(process.argv[2] ?? 1440)
const avecPanneau = process.argv[3] !== 'sans'

const RACINE_NAVIGATEURS = '/opt/pw-browsers'
const revision = existsSync(RACINE_NAVIGATEURS)
  ? readdirSync(RACINE_NAVIGATEURS).filter((d) => /^chromium-\d+$/.test(d)).sort().pop()
  : undefined
const executable = process.env.CHROMIUM ?? (revision ? `${RACINE_NAVIGATEURS}/${revision}/chrome-linux/chrome` : undefined)

const BASE = 'http://127.0.0.1:5199/'
const navigateur = await chromium.launch({ executablePath: executable })
const contexte = await navigateur.newContext({ viewport: { width: largeur, height: 900 } })
// Aucune requête hors du serveur local (voir le piège du mandataire dans vitrine.mjs).
await contexte.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()))
const page = await contexte.newPage()
let total = 0
for (const { dossier, onglet, nom, apres } of VISITES) {
  await page.goto(`${BASE}#/dossiers/${dossier}/${onglet}`)
  await page.waitForTimeout(900)
  const bouton = page.getByRole('button', { name: 'Assistant', exact: true })
  if (avecPanneau && (await bouton.getAttribute('aria-pressed')) !== 'true') await bouton.click()
  await page.waitForTimeout(300)
  if (apres) {
    await apres(page)
    await page.waitForTimeout(300)
  }
  const fautes = await page.evaluate(() => {
    const main = document.querySelector('.main').getBoundingClientRect()
    const defile = (e) => {
      for (let p = e.parentElement; p && !p.classList.contains('main'); p = p.parentElement) {
        if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(p).overflowX)) return true
      }
      return false
    }
    const trouvees = []
    for (const e of document.querySelectorAll('.main-contenu *')) {
      const r = e.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || r.right <= main.right - 1 || defile(e)) continue
      if (trouvees.some((t) => t.el.contains(e))) continue
      trouvees.push({ el: e, texte: `${Math.round(r.right - main.right)} px — <${e.tagName.toLowerCase()}> ${(e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60)}` })
    }
    return trouvees.map((t) => t.texte)
  })
  total += fautes.length
  console.log(`${nom} : ${fautes.length ? '\n   ' + fautes.join('\n   ') : 'rien ne déborde'}`)
}
await navigateur.close()
console.log(`\n${total} débordement(s) à ${largeur} px, panneau de droite ${avecPanneau ? 'ouvert' : 'fermé'}.`)
process.exitCode = total > 0 ? 1 : 0
