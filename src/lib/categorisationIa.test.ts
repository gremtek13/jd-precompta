import { describe, expect, it } from 'vitest'
import {
  REGLAGES_MODELE, natureCategorie, normaliserIndice, promptCategorisation, questionCategorisation, sensDePiece,
  verifierProposition, type CategoriePourIa,
} from './categorisationIa'
import { verifierCitations } from './extractionChamps'

// Les catégories du cabinet telles qu'elles sont en base (codes, libellés, postes et comptes relevés
// le 25/09/2026) — moins trois, pour que la liste reste lisible. DANS UN ORDRE QUI N'EST PAS
// ALPHABÉTIQUE : rangée par code, la liste rendrait le test d'ordre incapable de voir un tri ajouté.
const CATEGORIES: CategoriePourIa[] = [
  { code: 'honoraires', libelle: 'Honoraires', poste_2035: 'Honoraires ne constituant pas des rétrocessions', compte_comptable: '622600' },
  { code: 'achats_fournisseurs', libelle: 'Achats fournisseurs', poste_2035: 'Achats', compte_comptable: '606100' },
  { code: 'notes_frais', libelle: 'Notes de frais', poste_2035: 'Frais de réception, de représentation', compte_comptable: '625700' },
  { code: 'assurance', libelle: 'Assurance', poste_2035: "Primes d'assurance", compte_comptable: '616100' },
  { code: 'ventes_prestations', libelle: 'Ventes / prestations', poste_2035: 'Recettes', compte_comptable: '706000' },
  { code: 'gains_divers', libelle: "Gains divers (indemnités, remboursements d'assurance)", poste_2035: 'Gains divers', compte_comptable: '758000' },
  { code: 'autre', libelle: 'Autre', poste_2035: 'Divers', compte_comptable: '628000' },
]
const CODES = CATEGORIES.map((c) => c.code)

// Un texte reconstruit, jamais copié d'un document réel (voir CLAUDE.md) : seule compte la forme
// — des capitales, une espace insécable, un accent.
const TEXTE = [
  'BOULANGER MARSEILLE',
  'Ticket n° 4521 du 12/03/2026',
  'FOUR MICRO-ONDES 800W        199,99',
  'Péage A7 — Abonnement mensuel',
  'TOTAL TTC 199,99 €',
].join('\n')

const reponse = (objet: unknown) => JSON.stringify(objet)

describe('natureCategorie', () => {
  it('lit la nature au compte : classe 6 dépense, classe 7 recette', () => {
    expect(natureCategorie({ compte_comptable: '606100' })).toBe('dépense')
    expect(natureCategorie({ compte_comptable: '706000' })).toBe('recette')
    expect(natureCategorie({ compte_comptable: '758000' })).toBe('recette')
    expect(natureCategorie({ compte_comptable: ' 622600 ' })).toBe('dépense')
  })

  it('ne devine rien quand le compte ne dit rien', () => {
    expect(natureCategorie({ compte_comptable: null })).toBeNull()
    expect(natureCategorie({ compte_comptable: '' })).toBeNull()
    expect(natureCategorie({ compte_comptable: '401000' })).toBeNull()
  })
})

describe('promptCategorisation', () => {
  const prompt = promptCategorisation(CATEGORIES, null)

  it('liste chaque catégorie avec son code, son libellé, son poste 2035 et sa nature', () => {
    expect(prompt).toContain('- achats_fournisseurs — Achats fournisseurs — poste 2035 « Achats » — dépense')
    expect(prompt).toContain('- ventes_prestations — Ventes / prestations — poste 2035 « Recettes » — recette')
    for (const c of CATEGORIES) expect(prompt).toContain(`- ${c.code} — ${c.libelle}`)
  })

  it('garde l’ordre de la liste reçue — c’est l’appelant qui trie, par `ordre`', () => {
    const positions = CATEGORIES.map((c) => prompt.indexOf(`- ${c.code} —`))
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('n’invente ni poste ni nature pour une catégorie qui n’en porte pas', () => {
    const nue = promptCategorisation([{ code: 'divers_cabinet', libelle: 'Divers du cabinet', poste_2035: null, compte_comptable: null }], null)
    expect(nue).toContain('- divers_cabinet — Divers du cabinet\n')
  })

  it('demande de recopier, et dit que null est une bonne réponse', () => {
    expect(prompt).toContain("RECOPIÉS d'une seule ligne du texte")
    expect(prompt).toContain('null est une bonne réponse')
    expect(prompt).toContain('le CODE exact')
  })

  it('ne dépend que de la liste et du sens — ce qui permet au garde de duplication de le comparer', () => {
    expect(promptCategorisation(CATEGORIES, null)).toBe(prompt)
    expect(promptCategorisation(CATEGORIES.slice(1), null)).not.toBe(prompt)
  })

  it('dit le sens du point de vue du professionnel, et seulement quand il est connu', () => {
    const depense = promptCategorisation(CATEGORIES, 'dépense')
    expect(depense).toContain('Cette pièce est une DÉPENSE du professionnel')
    // Le mot qui a trompé la première mesure est nommé : un fournisseur facture des « prestations ».
    expect(depense).toContain('« prestations »')
    expect(promptCategorisation(CATEGORIES, 'recette')).toContain('Cette pièce est une RECETTE du professionnel')
    expect(prompt).not.toMatch(/Cette pièce est une/)
  })
})

describe('sensDePiece', () => {
  it('lit le sens sur le type, et ne devine pas celui d’une pièce « autre »', () => {
    expect(sensDePiece('vente')).toBe('recette')
    expect(sensDePiece('achat')).toBe('dépense')
    expect(sensDePiece('note_frais')).toBe('dépense')
    expect(sensDePiece('autre')).toBeNull()
    expect(sensDePiece(null)).toBeNull()
  })
})

describe('questionCategorisation', () => {
  const sansNature: CategoriePourIa = { code: 'divers_cabinet', libelle: 'Divers du cabinet', poste_2035: null, compte_comptable: null }
  const avecSansNature = [...CATEGORIES, sansNature]

  it('ne propose à une dépense que des catégories de dépense — et celles qui n’ont pas de nature', () => {
    const { prompt, codes } = questionCategorisation(avecSansNature, 'dépense')
    expect(codes).toEqual(['honoraires', 'achats_fournisseurs', 'notes_frais', 'assurance', 'autre', 'divers_cabinet'])
    // Filtrer la liste ne suffit pas : le modèle doit aussi savoir POURQUOI, sinon il force une dépense
    // sur un remboursement au lieu de rendre null.
    expect(prompt).toContain('Cette pièce est une DÉPENSE du professionnel')
    expect(prompt).not.toContain('ventes_prestations')
    expect(prompt).not.toContain('gains_divers')
  })

  it('ne propose à une recette que des catégories de recette', () => {
    const { prompt, codes } = questionCategorisation(avecSansNature, 'recette')
    expect(codes).toEqual(['ventes_prestations', 'gains_divers', 'divers_cabinet'])
    expect(prompt).toContain('Cette pièce est une RECETTE du professionnel')
  })

  it('propose tout quand le sens est inconnu', () => {
    const question = questionCategorisation(avecSansNature, null)
    expect(question.codes).toEqual(avecSansNature.map((c) => c.code))
    expect(question.prompt).toBe(promptCategorisation(avecSansNature, null))
  })

  it('rend un prompt et une liste de codes qui désignent la MÊME liste', () => {
    for (const sens of ['dépense', 'recette', null] as const) {
      const { prompt, codes } = questionCategorisation(avecSansNature, sens)
      for (const c of avecSansNature) {
        expect(prompt.includes(`- ${c.code} —`), `${c.code} (${sens})`).toBe(codes.includes(c.code))
      }
    }
  })

  it('fait rejeter une recette proposée pour une dépense, même justifiée par le document', () => {
    // Le cas mesuré : « Prestations » est bien imprimé sur la facture du fournisseur.
    const { codes } = questionCategorisation(CATEGORIES, 'dépense')
    const brut = reponse({ categorie: 'ventes_prestations', indice: 'Abonnement mensuel' })
    expect(verifierProposition(brut, codes, TEXTE).issue).toBe('code inconnu')
  })
})

describe('verifierProposition', () => {
  it('retient un code de la liste justifié par un extrait du document', () => {
    expect(verifierProposition(reponse({ categorie: 'achats_fournisseurs', indice: 'FOUR MICRO-ONDES' }), CODES, TEXTE))
      .toEqual({ code: 'achats_fournisseurs', indice: 'FOUR MICRO-ONDES', issue: 'retenue' })
  })

  it('lit l’objet même entouré d’un bloc de code ou d’une phrase', () => {
    const brut = 'Voici ma réponse :\n```json\n{"categorie": "notes_frais", "indice": "Ticket n° 4521"}\n```'
    expect(verifierProposition(brut, CODES, TEXTE).issue).toBe('retenue')
  })

  it('tient null, une chaîne vide ou une clé absente pour une abstention, pas pour une faute', () => {
    for (const objet of [{ categorie: null, indice: null }, { categorie: '  ' }, {}]) {
      expect(verifierProposition(reponse(objet), CODES, TEXTE)).toEqual({ code: null, indice: null, issue: 'abstention' })
    }
  })

  it('rejette un code hors de la liste, même proche', () => {
    expect(verifierProposition(reponse({ categorie: 'informatique', indice: 'FOUR MICRO-ONDES' }), CODES, TEXTE).issue)
      .toBe('code inconnu')
    // Le LIBELLÉ n'est pas le code : l'accepter reviendrait à deviner lequel l'opérateur voulait dire.
    expect(verifierProposition(reponse({ categorie: 'Notes de frais', indice: 'FOUR MICRO-ONDES' }), CODES, TEXTE).issue)
      .toBe('code inconnu')
  })

  it('tolère la casse du code, et rend TOUJOURS le code de la liste', () => {
    const verifiee = verifierProposition(reponse({ categorie: 'Honoraires', indice: 'Abonnement mensuel' }), CODES, TEXTE)
    expect(verifiee).toEqual({ code: 'honoraires', indice: 'Abonnement mensuel', issue: 'retenue' })
  })

  it('ne propose jamais un code sans un extrait qui porte au moins un mot', () => {
    for (const indice of [null, '', '   ', '€', '199,99', 'n°', 42]) {
      const verifiee = verifierProposition(reponse({ categorie: 'autre', indice }), CODES, TEXTE)
      expect(verifiee.issue, `indice ${JSON.stringify(indice)}`).toBe('indice manquant')
      expect(verifiee.code).toBeNull()
    }
  })

  it('rejette un extrait que le document ne porte pas', () => {
    // Reformulé par le modèle : plausible, et absent du document.
    expect(verifierProposition(reponse({ categorie: 'achats_fournisseurs', indice: 'Four à micro-ondes' }), CODES, TEXTE))
      .toEqual({ code: null, indice: 'Four à micro-ondes', issue: 'indice absent du texte' })
  })

  it('garde les accents : « PEAGE » n’est pas sur un document qui imprime « Péage »', () => {
    expect(verifierProposition(reponse({ categorie: 'autre', indice: 'PEAGE A7' }), CODES, TEXTE).issue).toBe('indice absent du texte')
    expect(verifierProposition(reponse({ categorie: 'autre', indice: 'PÉAGE A7' }), CODES, TEXTE).issue).toBe('retenue')
  })

  it('confond les blancs, espace insécable comprise — mais ne soude jamais deux mots', () => {
    expect(verifierProposition(reponse({ categorie: 'autre', indice: 'Abonnement mensuel' }), CODES, TEXTE).issue).toBe('retenue')
    expect(verifierProposition(reponse({ categorie: 'autre', indice: 'FOUR   MICRO-ONDES 800W' }), CODES, TEXTE).issue).toBe('retenue')
    expect(verifierProposition(reponse({ categorie: 'autre', indice: 'BOULANGERMARSEILLE' }), CODES, TEXTE).issue)
      .toBe('indice absent du texte')
  })

  it('rend « réponse illisible » sur tout ce qui n’est pas un objet JSON exploitable', () => {
    for (const brut of [undefined, null, '', 'Je ne sais pas.', '{ categorie: honoraires }', '[1, 2]', '{"categorie": 12, "indice": "FOUR"}']) {
      expect(verifierProposition(brut, CODES, TEXTE), `brut ${JSON.stringify(brut)}`)
        .toEqual({ code: null, indice: null, issue: 'réponse illisible' })
    }
  })
})

describe('normaliserIndice suit la règle de `verifierCitations` pour un tiers', () => {
  // Deux fonctions écrivent « cet extrait figure-t-il dans le texte ? ». Elles doivent répondre pareil,
  // sinon une citation serait retenue ici et rejetée là sur le même document — et l'une des deux
  // aurait dérivé en silence. Seule différence ASSUMÉE : l'extrait d'une catégorie doit porter un mot.
  const EXTRAITS = [
    'FOUR MICRO-ONDES', 'four micro-ondes', 'Four à micro-ondes', 'PEAGE A7', 'Péage A7',
    'Abonnement mensuel', 'Abonnement mensuel', 'BOULANGERMARSEILLE', 'TOTAL TTC 199,99 €', 'Ticket n° 4522',
  ]

  it('retient exactement les mêmes extraits', () => {
    for (const extrait of EXTRAITS) {
      const parCitation = verifierCitations({ tiers: extrait }, TEXTE).retenues.tiers !== undefined
      const parCategorie = verifierProposition(reponse({ categorie: 'autre', indice: extrait }), CODES, TEXTE).issue === 'retenue'
      expect(parCategorie, `divergence sur ${JSON.stringify(extrait)}`).toBe(parCitation)
    }
  })

  it('et la batterie distingue bien les deux issues — sinon elle ne prouverait rien', () => {
    const retenus = EXTRAITS.filter((e) => normaliserIndice(TEXTE).includes(normaliserIndice(e)))
    expect(retenus.length).toBeGreaterThan(0)
    expect(retenus.length).toBeLessThan(EXTRAITS.length)
  })
})

describe('REGLAGES_MODELE', () => {
  it('fixe la température à zéro : des factures identiques doivent recevoir la même proposition', () => {
    expect(REGLAGES_MODELE.temperature).toBe(0)
    // Une réponse n'est qu'un petit objet JSON ; un plafond bas borne le coût d'une réponse qui dérape.
    expect(REGLAGES_MODELE.max_tokens).toBeLessThanOrEqual(300)
  })
})
