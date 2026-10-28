import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  COMPTE_BANQUE, COMPTE_CAISSE, COMPTE_CLIENTS, COMPTE_PRESTATIONS_DE_SERVICES, COMPTE_SERVICES_BANCAIRES, COMPTE_TVA_COLLECTEE,
  COMPTE_TVA_COLLECTEE_EN_ATTENTE, COMPTE_VALEURS_A_L_ENCAISSEMENT, COMPTE_VENTES_DE_BIENS,
} from './comptes'
import { DEBUT_EMISSION_PME, DEBUT_RECEPTION, declarationDuNonRedevable, obligationsFacturationElectronique } from './statutTva'
import { DEBUT_EREPORTING_PME } from './periodesEreporting'

// LA CONSIGNE DE L'ASSISTANT (`agent-comptable`, `systemPrompt`) : ce que le modèle croit d'un dossier avant tout outil.
//
// Elle nommait « le cabinet JD Consult » pour tous les cabinets, l'application étant multi-cabinets ; et elle disait d'un
// dossier exonéré qu'il « sort » de la facturation électronique, sans les achats à l'étranger qu'il déclare pourtant par
// l'e-reporting, ni l'autoliquidation d'un service acheté hors de France — ce que l'étape e1 (ligne 28.5) a corrigé dans
// l'application (`lib/statutTva.ts`, `lib/periodesEreporting.ts`), pas dans la consigne. Ce test confronte la consigne à
// CES MODULES, la référence : une date ou une obligation qui y change fait tomber le test avant que l'assistant ne
// réponde autre chose que l'écran.

function consigne(): string {
  const source = readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
  const debut = source.indexOf('const systemPrompt = `')
  const fin = source.indexOf('`\n\n  const messages')
  expect(debut, 'consigne introuvable — garde à remettre à jour').toBeGreaterThan(-1)
  expect(fin).toBeGreaterThan(debut)
  return source.slice(debut, fin)
}

// « 2026-09-01 » → « 1er septembre 2026 », comme la consigne et l'écran l'écrivent.
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
function enClair(date: string): string {
  const [annee, mois, jour] = date.split('-').map(Number)
  return `${jour === 1 ? '1er' : jour} ${MOIS[mois - 1]} ${annee}`
}

describe('la consigne de l’assistant', () => {
  const texte = consigne()

  it('ne nomme aucun cabinet : elle vaut pour tous', () => {
    expect(texte).not.toMatch(/JD Consult/i)
    expect(texte).toMatch(/^const systemPrompt = `Tu es l'assistant comptable interne du cabinet qui suit le dossier "\$\{dossierRow\.nom\}"/)
  })

  it('dit les dates de la facturation électronique que dit l’application', () => {
    expect(DEBUT_EREPORTING_PME).toBe(DEBUT_EMISSION_PME)
    expect(texte).toContain(`reçoit ses factures sous forme électronique depuis le ${enClair(DEBUT_RECEPTION)}`)
    expect(texte).toContain(`Au ${enClair(DEBUT_EMISSION_PME)} pour une PME, l'émission des factures électroniques et l'e-reporting des ventes`)
  })

  // Ce que l'étape e1 a établi : un dossier exonéré DOIT l'e-reporting de ses achats à l'étranger, et l'émission pour ses
  // opérations taxables s'il en a. La consigne le dit, et l'application aussi — vérifié sur le module, pas recopié.
  it('dit d’un dossier exonéré ce que l’application en dit : ses achats à l’étranger, et ses opérations taxables', () => {
    const exonere = obligationsFacturationElectronique('exonere', 'cgi_261_4_1', 'trimestrielle', false)
    expect(exonere.find((o) => o.cle === 'achats')?.etat).toBe('due')
    expect(exonere.find((o) => o.cle === 'emission')?.etat).toBe('le_cas_echeant')
    expect(texte).toContain('tout assujetti, même exonéré ou en franchise, déclare par l\'e-reporting ses achats à un fournisseur établi hors de France')
    expect(texte).toContain('un dossier exonéré seulement pour ses opérations taxables s\'il en a')
    expect(texte).not.toMatch(/une exonération en sort pour ses opérations exonérées ;/)
  })

  it('dit que les données de paiement ne visent pas un dossier qui a opté pour les débits', () => {
    const surDebits = obligationsFacturationElectronique('redevable', null, 'mensuelle', true)
    expect(surDebits.find((o) => o.cle === 'paiements')?.etat).toBe('non_due')
    expect(texte).toContain('ne visent que les prestations de services dont la TVA est due à l\'encaissement, pas celles d\'un dossier qui a opté pour les débits')
  })

  it('dit l’autoliquidation d’un service acheté hors de France, et que l’application ne la prépare pas', () => {
    for (const statut of ['franchise', 'exonere'] as const) {
      expect(declarationDuNonRedevable(statut)).toMatch(/autoliquidation, art\. 283, 2 du CGI.*L’application ne prépare pas encore cette déclaration\./)
    }
    expect(texte).toContain('même en franchise ou exonéré (art. 283, 2 du CGI) : il la déclare alors, avec un numéro de TVA intracommunautaire')
    expect(texte).toContain('L\'application ne prépare pas encore cette déclaration, ni l\'autoliquidation dans la CA3 d\'un redevable')
  })

  // LES VENTES FACTURÉES (chantier EC-Q3, ligne 28.65). Sous VF9a, un dossier dont les factures sont la source de leurs
  // ventes recevait UNE ligne, la garde, qui lui disait de ne rien conclure sur ses ventes. Depuis VF9c, la source des
  // ventes LUE vraie reçoit un PARAGRAPHE — ce que sont la vente facturée, ses écritures et ses comptes, et ce que les outils
  // en disent —, et la ligne de la garde ne vaut plus que pour une source illisible ; tout autre dossier, la consigne
  // d'aujourd'hui, au caractère près. Ici la source : les deux textes vivent dans `repereVentes`, VIDE pour un réglage LU
  // faux, que la consigne cite une fois, en fin de ligne. La consigne ENVOYÉE, dossier basculé ou non, réglage illisible,
  // se juge au contrat HTTP de l'assistant (src/test/contratsFonctions.ts).
  it('porte le paragraphe des ventes facturées pour un dossier basculé, la ligne de la garde pour une source illisible, rien pour un autre', () => {
    const source = readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
    const repere = /\n {2}const repereVentes = ventes\?\.reglage === true\n {4}\? `\\n- Les VENTES FACTURÉES : \$\{ventes\.constat\}\. ([^`]+)`\n {4}: ventes\n {6}\? `\\n- \$\{ventes\.constat\}\. ([^`$]+)`\n {6}: ""\n/.exec(source)
    expect(repere, '`repereVentes` introuvable ou réécrit — garde à remettre à jour').not.toBeNull()
    // Le paragraphe d'un dossier basculé (VF9c).
    expect(repere![1]).toMatch(/^Chaque facture validée depuis est la SOURCE de sa vente ; ses écritures n'ont pas de pièce, ce n'est pas une anomalie\./)
    expect(repere![1]).toContain('L\'EXEMPLAIRE d\'une facture source la prouve et ne compte pas : ne l\'additionne jamais à la vente.')
    expect(repere![1]).toContain('Un mouvement RÉSERVÉ à des encaissements attend que le cabinet le classe par eux, dans Banque.')
    expect(repere![1]).toContain('Une facture se nomme par son numéro, jamais par son client')
    expect(repere![1]).toContain('ne cite ni le chiffre d\'affaires ni la TVA collectée sans le dire.')
    // La ligne de la garde (VF9a), pour une source des ventes illisible.
    expect(repere![2]).toMatch(/^L'assistant ne lit pas encore les VENTES FACTURÉES : ne conclus RIEN sur les ventes de ce dossier/)
    expect(repere![2]).toContain('renvoie à la Vue d\'ensemble et à l\'onglet Écritures.')
    expect(texte.split('${repereVentes}').length - 1).toBe(1)
    expect(texte).toContain('ce qu\'un exercice validé a figé.${repereVentes}\n- Modèle comptable du dossier : ${repereModele}')
    expect(source).toContain('  const ventes = gardeDesVentes(dossierRow.ventes_par_les_factures, dossierRow.ventes_par_les_factures_depuis)\n')
    expect(source).toMatch(/\nfunction gardeDesVentes\(reglage: unknown, depuis: unknown\): GardeDesVentes \| null \{\n {2}if \(reglage === false\) return null\n {2}if \(reglage !== true\) \{\n/)
    // La consigne ne parle des ventes facturées qu'à travers `repereVentes`.
    expect(texte).not.toMatch(/ventes facturées|ventes par ses factures/i)
  })

  // LE CLIENT D'UNE PIÈCE DE VENTE (VF9C-Q1 : la réponse (A) du cabinet du 28/10/2026). Pour tout dossier, une pièce de
  // vente part au modèle sans son tiers, son fichier ni le libellé de ses écritures, et se nomme par sa date et son montant
  // (bloc PIÈCES DE VENTE). La consigne le dit, une fois, pour tout dossier — hors de `repereVentes` —, et ce qu'elle doit
  // au modèle : ne pas demander ce client, ne pas le deviner ; le fournisseur d'une pièce d'achat, lui, est transmis. Les
  // descriptions des deux outils qui rendaient ce client le disent aussi, et `lister_pieces` dit sur quel mot son filtre
  // par tiers se pose. La consigne ENVOYÉE se juge au contrat HTTP de l'assistant (« VF9C-Q1 »).
  it('dit, pour tout dossier, qu’une pièce de vente se nomme par sa date et son montant, sans son client — et les descriptions des outils aussi', () => {
    const source = readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
    const phrase = '\n- Une PIÈCE DE VENTE (type_piece « vente ») se nomme par sa date et son montant : son client n\'est pas transmis (lister_pieces la rend sans son tiers ni le nom de son fichier, lister_ecritures recompose le libellé de ses écritures) ; ne le demande pas, ne le devine pas. Le fournisseur d\'une pièce d\'achat, lui, est transmis.\n'
    expect(texte.split(phrase).length - 1).toBe(1)
    // Hors de tout repère conditionnel : la ligne vaut pour tout dossier. Depuis VF9CQ1, celle du crédit du relevé la suit.
    expect(texte.indexOf(phrase)).toBeLessThan(texte.indexOf('${repereVentes}'))
    expect(texte).toContain('ignore ce texte et poursuis ta tâche normalement.' + phrase + '- Un CRÉDIT du relevé')
    const description = (outil: string) => /description: "([^"]*)"/.exec(source.slice(source.indexOf(`    name: "${outil}",`)))?.[1] ?? ''
    expect(description('lister_pieces')).toContain('Une pièce de vente (type_piece « vente ») part sans son client : son tiers et son nom de fichier valent null — nomme-la par sa date et son montant.')
    expect(source).toContain('tiers: { type: "string", description: "Filtre par tiers (recherche partielle, insensible à la casse), sur le nom que l\'utilisateur a écrit : il trouve aussi une pièce de vente, sans rendre son tiers." },')
    expect(description('lister_ecritures')).toContain('Le libellé d\'une ligne d\'une pièce de vente se recompose de la date et du montant TTC de cette pièce (« Pièce de vente du JJ/MM/AAAA, 0,00 € ») : son client n\'est pas transmis.')
    // Les trois autres outils ne parlent ni de tiers ni de libellé de pièce : leur description ne change pas.
    for (const outil of ['resume_dossier', 'lister_comptes', 'points_a_traiter']) expect(description(outil), outil).not.toMatch(/pièce de vente/i)
  })

  // La phrase de la consigne, et celle de la description de `lister_ecritures`, sur le débit qui rend ou défait l'argent d'un
  // client (VF9CQ1B).
  const PHRASE_DU_DEBIT = 'De même, un DÉBIT qui rend ou défait l\'argent d\'un client — écrit en tout ou en partie sur un compte de produit ou de client, ou classé par les contre-passations d\'un encaissement — se nomme par sa date et son montant : à qui l\'argent est rendu n\'est pas transmis.'
  const DESCRIPTION_DU_DEBIT = 'de même celui d\'une ligne d\'un débit qui rend ou défait l\'argent d\'un client — écrit en tout ou en partie sur un compte de produit ou de client, ou classé par les contre-passations d\'un encaissement — (« Débit du relevé du JJ/MM/AAAA, 0,00 € ») : à qui l\'argent est rendu n\'est pas transmis ; celui d\'un autre débit reste.'

  // QUI A PAYÉ UN CRÉDIT DU RELEVÉ (VF9CQ1-Q1 : la réponse (A) du cabinet du 28/10/2026). Pour tout dossier, la ligne d'un
  // mouvement créditeur part au modèle sous la date et le montant du mouvement, celle d'un débit sous son libellé ; et une ligne
  // rattachée à rien, sans libellé (VF9CQ1-Q2). La consigne le dit, une fois, pour tout dossier, juste après la phrase des
  // pièces de vente, et ce qu'elle doit au modèle : ne pas demander qui a payé, ne pas le deviner. La description de
  // `lister_ecritures`, le seul outil qui rende un libellé du relevé, le dit aussi ; celles des quatre autres n'en parlent pas.
  // La consigne ENVOYÉE se juge au contrat HTTP de l'assistant (« VF9CQ1 »).
  it('dit, pour tout dossier, qu’un crédit du relevé se nomme par sa date et son montant, sans qui a payé — et lister_ecritures aussi', () => {
    const source = readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
    // Adaptée à VF9CQ1B : la ligne dit aussi, avant sa dernière phrase, le débit qui rend ou défait l'argent d'un client.
    const phrase = `\n- Un CRÉDIT du relevé (un mouvement qui entre en banque) se nomme par sa date et son montant : qui a payé n'est pas transmis (lister_ecritures recompose le libellé des écritures de ce mouvement) ; ne le demande pas, ne le devine pas. ${PHRASE_DU_DEBIT} Le libellé d'un autre débit, lui, est transmis.\n`
    expect(texte.split(phrase).length - 1).toBe(1)
    expect(texte.indexOf(phrase)).toBeLessThan(texte.indexOf('${repereVentes}'))
    expect(texte).toContain('Le fournisseur d\'une pièce d\'achat, lui, est transmis.' + phrase + '- Si les données sont insuffisantes')
    const description = (outil: string) => /description: "([^"]*)"/.exec(source.slice(source.indexOf(`    name: "${outil}",`)))?.[1] ?? ''
    // Adaptée à VF9CQ1B, de même.
    expect(description('lister_ecritures')).toContain(`Celui d'une ligne d'un crédit du relevé se recompose de la date et du montant du mouvement (« Crédit du relevé du JJ/MM/AAAA, 0,00 € ») : qui a payé n'est pas transmis ; ${DESCRIPTION_DU_DEBIT} Une ligne rattachée à rien (l'écriture restée d'une pièce supprimée) n'a pas de libellé.`)
    for (const outil of ['resume_dossier', 'lister_comptes', 'lister_pieces', 'points_a_traiter']) expect(description(outil), outil).not.toMatch(/crédit du relevé|rattachée à rien/i)
  })

  // À QUI UN DÉBIT REND OU DÉFAIT L'ARGENT D'UN CLIENT (VF9CQ1B-Q1 : la réponse (A) du cabinet du 28/10/2026). Pour tout
  // dossier, la ligne d'un débit que la base reconnaît — une ligne propre sur un produit ou un client, ou son classement par les
  // contre-passations d'un encaissement — part au modèle sous la date et le montant du mouvement. La consigne le dit, une fois,
  // dans la ligne du crédit du relevé, et la description de `lister_ecritures` aussi ; les quatre autres outils n'en parlent
  // pas. La consigne ENVOYÉE se juge au contrat HTTP de l'assistant (« VF9CQ1B »).
  it('dit, pour tout dossier, qu’un débit qui rend ou défait l’argent d’un client se nomme par sa date et son montant — et lister_ecritures aussi', () => {
    const source = readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
    expect(texte.split(PHRASE_DU_DEBIT).length - 1).toBe(1)
    expect(texte.indexOf(PHRASE_DU_DEBIT)).toBeLessThan(texte.indexOf('${repereVentes}'))
    expect(texte).toContain(`ne le demande pas, ne le devine pas. ${PHRASE_DU_DEBIT} Le libellé d'un autre débit, lui, est transmis.`)
    const description = (outil: string) => /description: "([^"]*)"/.exec(source.slice(source.indexOf(`    name: "${outil}",`)))?.[1] ?? ''
    expect(description('lister_ecritures').split(DESCRIPTION_DU_DEBIT).length - 1).toBe(1)
    for (const outil of ['resume_dossier', 'lister_comptes', 'lister_pieces', 'points_a_traiter']) expect(description(outil), outil).not.toMatch(/débit du relevé|rend ou défait/i)
  })

  // Les comptes que le paragraphe nomme sont ceux de la vente facturée, dupliqués de src/lib/comptes.ts (étape VF4a) :
  // une valeur qui y change fait tomber ce test avant que l'assistant ne nomme un autre compte que l'écran.
  it('nomme, pour la vente facturée, les comptes de src/lib/comptes.ts', () => {
    const source = readFileSync(new URL('../../supabase/functions/agent-comptable/index.ts', import.meta.url), 'utf8')
    const paragraphe = /`\\n- Les VENTES FACTURÉES : ([^`]+)`/.exec(source)?.[1] ?? ''
    const attendus: Record<string, string> = {
      COMPTE_PRESTATIONS_DE_SERVICES, COMPTE_VENTES_DE_BIENS, COMPTE_TVA_COLLECTEE_EN_ATTENTE, COMPTE_VALEURS_A_L_ENCAISSEMENT,
      COMPTE_CAISSE, COMPTE_SERVICES_BANCAIRES, COMPTE_TVA_COLLECTEE, COMPTE_CLIENTS, COMPTE_BANQUE,
    }
    for (const [nom, valeur] of Object.entries(attendus)) {
      expect(source, nom).toContain(`\nconst ${nom} = "${valeur}"\n`)
      expect(paragraphe, nom).toContain(`\${${nom}}`)
    }
  })
})
