import { describe, expect, it } from 'vitest'
import {
  analyserAppariements,
  libelleExploitable,
  motsIdentifiants,
  tiersConfirmeParBanque,
} from './appariementBanque'
import type { LigneBancaire, Piece } from './types'

const piece = (o: Partial<Piece>): Piece =>
  ({
    id: 'p1', type_piece: 'achat', statut: 'a_valider', tiers: 'Transmedical',
    date_piece: '2025-06-01', montant_ttc: 38.4, montant_ht: 32, montant_tva: 6.4,
    ...o,
  }) as Piece

const ligne = (o: Partial<LigneBancaire>): LigneBancaire =>
  ({
    id: 'l1', statut: 'non_rapprochee', date: '2025-06-05', montant: -38.4,
    libelle: 'PRLV SEPA TRANSMEDICAL', libelle_brut: null,
    ...o,
  }) as LigneBancaire

describe('libelleExploitable', () => {
  it('retombe sur la ligne brute quand le libellé est le générique de l’import', () => {
    // Sur le premier relevé réel, 250 lignes sur 385 avaient ce générique parce que la colonne
    // « Libellé » choisie au mapping était vide — le vrai texte de la banque était dans la ligne
    // brute. Sans ce repli, les deux tiers du relevé ne peuvent confirmer aucun fournisseur.
    expect(libelleExploitable({
      libelle: 'Mouvement bancaire',
      libelle_brut: '05/06/2025 | -38,4 | Virement |  | PRLV SEPA TRANSMEDICAL |  |  | ',
    })).toContain('TRANSMEDICAL')
  })

  it('préfère le libellé quand il dit quelque chose', () => {
    expect(libelleExploitable({ libelle: 'PRLV SEPA MACSF', libelle_brut: 'autre chose' })).toBe('PRLV SEPA MACSF')
  })

  it('rend une chaîne vide quand rien n’est exploitable', () => {
    expect(libelleExploitable({ libelle: 'Mouvement bancaire', libelle_brut: null })).toBe('')
  })
})

describe('motsIdentifiants', () => {
  it('écarte les mots trop courts pour identifier quoi que ce soit', () => {
    expect(motsIdentifiants('SA BIO SAS')).toEqual([])
  })

  it('écarte les mots que tout le monde partage', () => {
    // « Cabinet Martin » et « Cabinet Dupont » se confirmeraient l'un l'autre sur « cabinet ».
    expect(motsIdentifiants('Cabinet Martin')).toEqual(['martin'])
    expect(motsIdentifiants('Societe Generale France')).toEqual(['generale'])
  })

  it('ignore accents, casse et ponctuation', () => {
    expect(motsIdentifiants('PRÉVOYANCE Santé-du-Sud')).toEqual(['prevoyance', 'sante'])
  })
})

describe('tiersConfirmeParBanque', () => {
  it('confirme malgré le bruit que l’OCR colle autour du nom', () => {
    // Cas réel : un bout du slogan de la facture recopié dans le champ fournisseur.
    expect(tiersConfirmeParBanque('Transmedical\net soigner redevient', 'PRLV SEPA TRANSMEDICAL')).toBe(true)
  })

  it('refuse le cas qui a motivé ce critère', () => {
    // Pièce réelle à 198 € : bon montant, bonne date, un seul candidat — et un fournisseur lu
    // « DARNIS JEREMY », le nom du client lui-même, alors que la banque dit Transmedical. Les deux
    // premiers critères la validaient avec un fournisseur faux.
    expect(tiersConfirmeParBanque('DARNIS JEREMY', 'PRLV SEPA TRANSMEDICAL')).toBe(false)
  })

  it('ne confirme rien sans fournisseur lu sur la pièce', () => {
    expect(tiersConfirmeParBanque(null, 'PRLV SEPA TRANSMEDICAL')).toBe(false)
    expect(tiersConfirmeParBanque('  ', 'PRLV SEPA TRANSMEDICAL')).toBe(false)
  })

  it('ne confirme rien sans libellé bancaire', () => {
    expect(tiersConfirmeParBanque('Transmedical', '')).toBe(false)
  })

  it('confirme malgré un libellé bancaire tronqué', () => {
    expect(tiersConfirmeParBanque('MACSF Assurances', 'PRLV SEPA MACSF-ASSU-')).toBe(true)
    // Troncature en plein milieu d'un mot : les relevés coupent à longueur fixe. Exiger l'égalité
    // stricte ferait passer ce fournisseur, pourtant sans ambiguïté, à l'arbitrage manuel.
    expect(tiersConfirmeParBanque('SwissLife Prévoyance', 'PRLV SEPA SWISSLIFE PREVOYAN')).toBe(true)
    // Et dans l'autre sens : la pièce porte le nom court, la banque le nom complet.
    expect(tiersConfirmeParBanque('Swissl', 'PRLV SEPA SWISSLIFE')).toBe(true)
  })

  it('refuse un fournisseur dont le nom contient celui de la banque, sans être le même', () => {
    // Le sens de la recherche décide ici, et lui seul. On cherche le mot de la PIÈCE dans le libellé
    // de la BANQUE : « transmedical » n'est pas dans « medical service », donc refus.
    // Chercher dans l'autre sens trouverait « medical » À L'INTÉRIEUR de « transmedical » et
    // validerait un prélèvement d'un tout autre fournisseur, au centime et au jour près.
    expect(tiersConfirmeParBanque('Transmedical', 'PRLV SEPA MEDICAL SERVICE')).toBe(false)
    expect(tiersConfirmeParBanque('Medical Service', 'PRLV SEPA TRANSMEDICAL')).toBe(false)
  })

  it('ne se laisse pas confirmer par un mot générique commun aux deux', () => {
    expect(tiersConfirmeParBanque('Cabinet Dupont', 'PRLV SEPA CABINET MARTIN')).toBe(false)
  })
})

describe('analyserAppariements — ce qui est certain', () => {
  it('retient une pièce dont montant, date et fournisseur concordent', () => {
    const { certains, aArbitrer } = analyserAppariements([piece({})], [ligne({})])
    expect(certains).toHaveLength(1)
    expect(certains[0].ecartJours).toBe(4)
    expect(aArbitrer).toEqual([])
  })

  it('n’apparie rien hors de la tolérance de date', () => {
    const { certains, aArbitrer } = analyserAppariements([piece({})], [ligne({ date: '2025-06-20' })])
    expect(certains).toEqual([])
    expect(aArbitrer).toEqual([])
  })

  it('n’apparie rien sur un montant différent d’un centime', () => {
    const { certains, aArbitrer } = analyserAppariements([piece({})], [ligne({ montant: -38.42 })])
    expect(certains).toEqual([])
    expect(aArbitrer).toEqual([])
  })

  it('ignore un mouvement déjà rapproché', () => {
    const { certains } = analyserAppariements([piece({})], [ligne({ statut: 'rapprochee' })])
    expect(certains).toEqual([])
  })

  it('ignore une pièce sans montant ou sans date', () => {
    expect(analyserAppariements([piece({ montant_ttc: null })], [ligne({})]).certains).toEqual([])
    expect(analyserAppariements([piece({ date_piece: null })], [ligne({})]).certains).toEqual([])
  })
})

describe('analyserAppariements — ce qui part à l’arbitrage', () => {
  it('refuse quand deux mouvements peuvent convenir à la même pièce', () => {
    const a = analyserAppariements([piece({})], [ligne({ id: 'a' }), ligne({ id: 'b', date: '2025-06-03' })])
    expect(a.certains).toEqual([])
    expect(a.aArbitrer.map((p) => p.motif)).toEqual(['plusieurs mouvements possibles', 'plusieurs mouvements possibles'])
  })

  it('refuse quand deux pièces se disputent le même mouvement', () => {
    // Cas réel : la même facture déposée deux fois, même date et même montant.
    const a = analyserAppariements([piece({ id: 'p1' }), piece({ id: 'p2' })], [ligne({})])
    expect(a.certains).toEqual([])
    expect(a.aArbitrer.every((p) => p.motif === 'plusieurs pièces possibles')).toBe(true)
  })

  it('refuse un fournisseur que la banque ne confirme pas', () => {
    const a = analyserAppariements([piece({ tiers: 'DARNIS JEREMY' })], [ligne({})])
    expect(a.certains).toEqual([])
    expect(a.aArbitrer[0].motif).toBe('fournisseur non confirmé par le libellé bancaire')
  })

  it('refuse une pièce sans fournisseur lu', () => {
    const a = analyserAppariements([piece({ tiers: null })], [ligne({})])
    expect(a.aArbitrer[0].motif).toBe('aucun fournisseur lu sur la pièce')
  })

  it('refuse un achat rapproché d’un encaissement', () => {
    // Même montant, même date, bon fournisseur — mais l'argent est entré alors que la pièce est un
    // achat. C'est un remboursement, pas le paiement de cette facture.
    const a = analyserAppariements([piece({})], [ligne({ montant: 38.4 })])
    expect(a.certains).toEqual([])
    expect(a.aArbitrer[0].motif).toBe('sens contraire au type de pièce')
  })

  it('attend un encaissement pour une vente', () => {
    const vente = piece({ type_piece: 'vente', tiers: 'Transmedical' })
    expect(analyserAppariements([vente], [ligne({ montant: 38.4 })]).certains).toHaveLength(1)
    expect(analyserAppariements([vente], [ligne({ montant: -38.4 })]).aArbitrer[0].motif)
      .toBe('sens contraire au type de pièce')
  })

  it('attend un encaissement pour un avoir sur achat', () => {
    // Un avoir fournisseur est une pièce d'achat à montant négatif : l'argent revient sur le compte.
    const avoir = piece({ montant_ttc: -38.4 })
    expect(analyserAppariements([avoir], [ligne({ montant: 38.4 })]).certains).toHaveLength(1)
  })
})

describe('analyserAppariements — ordre de présentation', () => {
  it('met le plus sûr en premier, puis le plus gros montant', () => {
    const a = analyserAppariements(
      [
        piece({ id: 'loin', date_piece: '2025-06-01', montant_ttc: 38.4 }),
        piece({ id: 'pres', date_piece: '2025-06-04', montant_ttc: 100 }),
        piece({ id: 'gros', date_piece: '2025-06-04', montant_ttc: 900 }),
      ],
      [
        ligne({ id: 'a', montant: -38.4 }),
        ligne({ id: 'b', montant: -100 }),
        ligne({ id: 'c', montant: -900 }),
      ],
    )
    expect(a.certains.map((p) => p.piece.id)).toEqual(['gros', 'pres', 'loin'])
  })
})

describe('le scénario réel qui a servi de référence', () => {
  it('sépare 10 certains, 1 fournisseur faux et 2 doublons', () => {
    // Reconstitution du premier jeu réel : des mensualités Transmedical, une pièce dont l'OCR a lu le
    // nom du client en fournisseur, et une facture déposée deux fois.
    const mois = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']
    const pieces = mois.map((m) => piece({
      id: `ok-${m}`, date_piece: `2025-${m}-01`, montant_ttc: 38.4, tiers: 'Transmedical',
    }))
    const lignes = mois.map((m) => ligne({
      id: `l-${m}`, date: `2025-${m}-05`, montant: -38.4, libelle: 'PRLV SEPA TRANSMEDICAL',
    }))

    pieces.push(piece({ id: 'faux-tiers', date_piece: '2025-11-30', montant_ttc: 198, tiers: 'DARNIS JEREMY' }))
    lignes.push(ligne({ id: 'l-198', date: '2025-12-05', montant: -198, libelle: 'PRLV SEPA TRANSMEDICAL' }))

    pieces.push(piece({ id: 'doublon-a', date_piece: '2025-12-01', montant_ttc: 55, tiers: 'Transmedical' }))
    pieces.push(piece({ id: 'doublon-b', date_piece: '2025-12-01', montant_ttc: 55, tiers: 'Transmedical' }))
    lignes.push(ligne({ id: 'l-55', date: '2025-12-05', montant: -55, libelle: 'PRLV SEPA TRANSMEDICAL' }))

    const { certains, aArbitrer } = analyserAppariements(pieces, lignes)
    expect(certains).toHaveLength(10)
    expect(certains.map((c) => c.piece.id).sort()).toEqual(mois.map((m) => `ok-${m}`).sort())

    const motifs = aArbitrer.map((p) => p.motif).sort()
    expect(motifs).toEqual([
      'fournisseur non confirmé par le libellé bancaire',
      'plusieurs pièces possibles',
      'plusieurs pièces possibles',
    ])
  })
})

describe('appariement d’une pièce en devise étrangère', () => {
  // Facture OpenAI d'août 2025 : 24,00 USD, convertie provisoirement 20,60 € au taux BCE. Le débit
  // réel n'est jamais égal à ce montant — la banque applique son propre cours et ses frais.
  const enUsd = (o: Partial<Piece> = {}) => piece({
    id: 'openai', tiers: 'OpenAI, LLC', date_piece: '2025-08-09',
    montant_ttc: 20.60, montant_ht: 17.17, montant_tva: 3.43,
    devise: 'USD', montant_devise: 24, taux_change: 1.1648, ...o,
  })

  it('apparie un débit proche, que l’égalité au centime rejetterait', () => {
    const debit = ligne({ date: '2025-08-12', montant: -20.68, libelle: 'CB59OPENAI          09/08/25' })
    const { certains } = analyserAppariements([enUsd()], [debit])
    expect(certains).toHaveLength(1)
    expect(certains[0].ligne.montant).toBe(-20.68)
  })

  it('n’apparie pas un mouvement hors de la borne de vraisemblance', () => {
    // Même fournisseur, même semaine, mais 34 € pour une facture de 24 USD : ce n'est pas un écart
    // de change, c'est un autre mouvement.
    const debit = ligne({ date: '2025-08-12', montant: -34.00, libelle: 'CB59OPENAI          09/08/25' })
    const { certains, aArbitrer } = analyserAppariements([enUsd()], [debit])
    expect(certains).toEqual([])
    expect(aArbitrer).toEqual([])
  })

  it('écarte le prélèvement MACSF réel, que le montant et la date laissaient passer', () => {
    // Le cas qui justifie de garder TROIS signaux. Relevé réel du dossier : un prélèvement
    // d'assurance de 19,72 € le 14/08, soit 4,3 % sous la conversion provisoire — dans la borne — et
    // cinq jours après la facture — dans la tolérance. Seul le libellé l'écarte. Sans lui, une
    // prime d'assurance devenait le montant d'une facture OpenAI.
    const macsf = ligne({ date: '2025-08-14', montant: -19.72, libelle: 'PRLV SEPA MACSF-ASSU-' })
    const { certains, aArbitrer } = analyserAppariements([enUsd()], [macsf])
    expect(certains).toEqual([])
    expect(aArbitrer).toHaveLength(1)
    expect(aArbitrer[0].motif).toBe('fournisseur non confirmé par le libellé bancaire')
  })

  it('ne forme aucune paire pour une pièce en devise non convertie', () => {
    // Sans conversion provisoire, il n'y a pas d'ancre : aucun montant ne peut être jugé plausible.
    // La pièce se rapproche à la main, ce qui est le bon niveau d'attention pour une pièce dont on
    // ignore encore ce qu'elle vaut.
    const sansAncre = enUsd({ montant_ttc: null, montant_ht: null, montant_tva: null, taux_change: null })
    const debit = ligne({ date: '2025-08-12', montant: -20.68, libelle: 'CB59OPENAI          09/08/25' })
    const { certains, aArbitrer } = analyserAppariements([sansAncre], [debit])
    expect(certains).toEqual([])
    expect(aArbitrer).toEqual([])
  })

  it('garde la règle stricte pour une pièce dont la devise n’est pas renseignée', () => {
    // Le défaut trouvé par les tests existants : `devise` absente valait « étrangère », et toutes
    // les pièces gagnaient cinq pour cent de tolérance sans que personne l'ait demandé.
    const sansDevise = piece({ montant_ttc: 38.4 })
    delete (sansDevise as { devise?: string }).devise
    const { certains, aArbitrer } = analyserAppariements([sansDevise], [ligne({ montant: -38.42 })])
    expect(certains).toEqual([])
    expect(aArbitrer).toEqual([])
  })
})

describe('préfixe de terminal carte collé au commerçant', () => {
  // Formats réels des trois dossiers : la banque colle « CB » + deux chiffres au nom, sans séparateur.
  it('retrouve le commerçant sous le préfixe', () => {
    expect(tiersConfirmeParBanque('Anthropic', 'CB30ANTHROPIC* C     15/06/26')).toBe(true)
    expect(tiersConfirmeParBanque('CONVERGENCE', 'CB30CONVERGENCE      08/02/26')).toBe(true)
    expect(tiersConfirmeParBanque('Flamaco', 'CB59FLAMACO          20/02/25')).toBe(true)
    expect(tiersConfirmeParBanque('OpenAI, LLC', 'CB59OPENAI          09/08/25')).toBe(true)
  })

  it('n’abaisse pas le plancher de cinq caractères en nettoyant', () => {
    // « CB30cote de boeu » ne doit pas faire de « cote » un mot identifiant : c'est trop court pour
    // distinguer qui que ce soit, préfixe retiré ou non.
    expect(tiersConfirmeParBanque('Cote', 'CB30cote de boeu     03/02/26')).toBe(false)
  })

  it('ne confond toujours pas deux fournisseurs dont l’un contient l’autre', () => {
    // La garantie que le nettoyage ne rouvre pas la porte que ce module a fermée : le préfixe est
    // retiré mot à mot, on ne cherche jamais une sous-chaîne dans le libellé entier.
    expect(tiersConfirmeParBanque('Transmedical', 'CB30MEDICAL SERVICE  01/03/26')).toBe(false)
    expect(tiersConfirmeParBanque('Medical', 'CB30TRANSMEDICAL     01/03/26')).toBe(false)
  })

  it('laisse intact un libellé sans préfixe', () => {
    expect(tiersConfirmeParBanque('Transmedical', 'PRLV SEPA TRANSMEDICAL')).toBe(true)
    expect(tiersConfirmeParBanque('OpenAI, LLC', 'PRLV SEPA MACSF-ASSU-')).toBe(false)
  })
})
