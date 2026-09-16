import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// `supabase/functions/extract-piece/index.ts` est auto-porté (déployé à part, il ne peut rien
// importer de src/lib). `dateDepuisTexteBrut` y décide de la date d'une pièce quand Textract n'a pas
// étiqueté de champ INVOICE_RECEIPT_DATE — et une pièce sans date n'entre dans aucun pack. Ce test
// lit la *vraie* source déployée et exécute sa copie, comme le garde-fou de `parseAmount`.
//
// Volontairement fragile : renommer ou reformater ces fonctions le casse bruyamment.
function extraireDeLEdgeFunction() {
  const source = readFileSync(new URL('../../supabase/functions/extract-piece/index.ts', import.meta.url), 'utf8')

  const morceaux: string[] = []
  // `new Function` évalue du JavaScript : toute annotation de type, y compris sur une fonction
  // interne, doit être retirée explicitement. Listées une par une plutôt que par une expression
  // générique — une regex qui « enlève les types » finirait par manger du vrai code.
  const prendre = (entete: string, signatureJs: string, internes: [string, string][] = []) => {
    const debut = source.indexOf(entete)
    expect(debut, `\`${entete}\` introuvable dans l'Edge Function — le garde-fou doit être remis à jour`).toBeGreaterThan(-1)
    const fin = source.indexOf('\n}\n', debut)
    expect(fin, `fin de \`${entete}\` introuvable`).toBeGreaterThan(debut)
    let corps = source.slice(debut, fin + 2).replace(entete, signatureJs)
    for (const [de, vers] of internes) {
      expect(corps.includes(de), `\`${de}\` introuvable dans \`${entete}\``).toBe(true)
      corps = corps.replace(de, vers)
    }
    morceaux.push(corps)
  }

  // Les constantes se recopient telles quelles : ce sont elles qui décident quels libellés comptent.
  for (const nom of ['const MOIS_PAR_NOM', 'const LIBELLE_DATE_FACTURE', 'const LIBELLE_AUTRE_DATE',
                     'const DATE_ISO_REGEX', 'const DATE_NUMERIQUE_REGEX', 'const DATE_TEXTUELLE_REGEX']) {
    const debut = source.indexOf(nom)
    expect(debut, `\`${nom}\` introuvable`).toBeGreaterThan(-1)
    const fin = nom === 'const MOIS_PAR_NOM' ? source.indexOf('\n}\n', debut) + 2 : source.indexOf('\n', debut) + 1
    morceaux.push(source.slice(debut, fin).replace(/: Record<string, number>/, ''))
  }

  prendre('function toIsoDate(year: number, month: number, day: number): string | null {',
          'function toIsoDate(year, month, day) {')
  prendre('function sansAccents(s: string): string {', 'function sansAccents(s) {')
  prendre('function datesDeLaLigne(ligne: string, anneeReference: number): string[] {',
          'function datesDeLaLigne(ligne, anneeReference) {',
          [['const trouvees: string[] = []', 'const trouvees = []'],
           ['(a: number, m: number, j: number) =>', '(a, m, j) =>']])
  prendre('function dateDepuisTexteBrut(lignes: string[], anneeReference: number): { date: string | null; candidates: string[] } {',
          'function dateDepuisTexteBrut(lignes, anneeReference) {')

  return new Function(`${morceaux.join('\n')}; return dateDepuisTexteBrut`)() as (
    lignes: string[], anneeReference: number,
  ) => { date: string | null; candidates: string[] }
}

const dateDepuisTexteBrut = extraireDeLEdgeFunction()
const lire = (lignes: string[]) => dateDepuisTexteBrut(lignes, 2026)

describe('extract-piece / dateDepuisTexteBrut (copie déployée)', () => {
  it('lit une date annoncée par son libellé, au format français', () => {
    // Le défaut corrigé : Textract n'étiquette INVOICE_RECEIPT_DATE que de façon irrégulière (4 fois
    // sur 22 chez un fournisseur réel), alors que la date est bien dans le texte OCR.
    expect(lire(['TRANSMEDICAL', 'Facture n° 51310', 'Date : 31/01/2023', 'Total TTC 192,00 €']).date)
      .toBe('2023-01-31')
  })

  it('accepte les variantes d’écriture de la date de facture', () => {
    for (const ligne of [
      'Date de facture : 15/03/2023', 'Date de facturation 15.03.2023', "Date d'émission : 15-03-2023",
      'Facture du 15/03/2023', 'Facturée le 15/03/2023', 'Émise le 15/03/2023',
    ]) {
      expect(lire(['ACME', ligne, 'Total 100,00']).date, ligne).toBe('2023-03-15')
    }
  })

  it('lit une date écrite en toutes lettres, accentuée ou non', () => {
    expect(lire(['Date : 8 février 2023']).date).toBe('2023-02-08')
    expect(lire(['Date : 8 fevrier 2023']).date).toBe('2023-02-08')
    expect(lire(['Date : 1er août 2023']).date).toBe('2023-08-01')
  })

  it('lit le format JJ/MM et jamais MM/JJ', () => {
    // Le piège inverse de celui déjà corrigé dans parseDate : lire à l'américaine daterait du
    // 1er décembre une facture du 12 janvier, dans le mauvais exercice, sans que rien ne le signale.
    expect(lire(['Date : 12/01/2023']).date).toBe('2023-01-12')
  })

  it('préfère la date de facture à l’échéance quand les deux figurent', () => {
    // C'est le cas qui compte : dater la pièce du jour où elle doit être payée la range dans le mois
    // suivant — et pour une facture de décembre, dans l'exercice suivant.
    const r = lire(['Date de facture : 31/12/2023', 'Échéance : 31/01/2024', 'Total 192,00'])
    expect(r.date).toBe('2023-12-31')
  })

  it('ignore une échéance seule plutôt que de la prendre pour la date de la pièce', () => {
    const r = lire(['TRANSMEDICAL', 'À payer avant le 28/02/2023', 'Total 192,00'])
    expect(r.date).toBeNull()
  })

  it('lit la date sous son en-tête quand la mise en page est un tableau', () => {
    // Sur une facture en colonnes, l'en-tête « Date » et sa valeur ne survivent pas sur la même ligne
    // OCR — même piège que la ventilation TVA des tickets de caisse. Le document porte ici DEUX dates,
    // sinon la règle « une seule date distincte » suffirait et ce test ne prouverait rien : c'est
    // exactement ce qu'une mutation a révélé, la première version passait sans exercer cette règle.
    expect(lire(['N° Facture', 'Date', 'Échéance', '51310', '31/01/2023', '28/02/2023']).date)
      .toBe('2023-01-31')
  })

  it('ne va pas chercher une date trop loin après le libellé', () => {
    // Au-delà de quelques lignes, la date rencontrée n'a plus de rapport avec l'en-tête : on
    // retomberait à choisir au hasard, en le présentant comme une lecture.
    const loin = ['Date', 'a', 'b', 'c', 'd', 'e', 'f', '31/01/2023', '28/02/2023']
    expect(lire(loin).date).toBeNull()
  })

  it('retient la date unique d’un document qui n’annonce aucun libellé', () => {
    // Beaucoup de factures simples n'écrivent pas « Date » : si le document n'en porte qu'une, elle
    // ne peut guère être autre chose que la sienne.
    expect(lire(['TRANSMEDICAL SARL', 'Marseille, le 31/01/2023', 'Prestation janvier', '192,00 €']).date)
      .toBe('2023-01-31')
  })

  it('refuse de trancher entre plusieurs dates sans libellé, et dit ce qu’il a vu', () => {
    // Remplir au hasard produirait une pièce datée avec assurance dans le mauvais mois. Le manque est
    // désormais visible (feuille « Pièces sans date », message à l'écran) : il vaut mieux que le faux.
    const r = lire(['ACME', '05/01/2023', 'Prestation du mois', '28/02/2023', 'Total 100,00'])
    expect(r.date).toBeNull()
    expect(r.candidates).toEqual(['2023-01-05', '2023-02-28'])
  })

  it('ne prend pas un numéro ou une référence pour une date', () => {
    // Une année aberrante trahit un faux positif : numéro de commande, référence produit, code.
    expect(lire(['Réf. 12/34/56', 'Commande 01/02/1998']).date).toBeNull()
    expect(lire(['Bon 15/08/2199']).date).toBeNull()
  })

  it('écarte une date impossible plutôt que de la corriger en silence', () => {
    expect(lire(['Date : 31/02/2023', 'Date : 45/13/2023']).date).toBeNull()
  })

  it('ne rend rien sur un document sans aucune date', () => {
    const r = lire(['TRANSMEDICAL', 'Prestation mensuelle', 'Total TTC 192,00 €'])
    expect(r.date).toBeNull()
    expect(r.candidates).toEqual([])
  })

  it('accepte une année sur deux chiffres', () => {
    expect(lire(['Date : 31/01/23']).date).toBe('2023-01-31')
  })
})

describe('extract-piece / toIsoDate (copie déployée)', () => {
  // Vérifié à travers le repli, qui est le seul point d'entrée exporté par le garde-fou.
  it('accepte le 29 février d’une année bissextile et refuse celui des autres', () => {
    expect(lire(['Date : 29/02/2024']).date).toBe('2024-02-29')
    expect(lire(['Date : 29/02/2023']).date).toBeNull()
  })

  it('refuse un 31 dans un mois de 30 jours', () => {
    // `2023-04-31` n'existe pas : Postgres refuse la ligne, et le dépôt échoue sur une erreur
    // incompréhensible plutôt que de simplement laisser la date vide.
    expect(lire(['Date : 31/04/2023']).date).toBeNull()
    expect(lire(['Date : 30/04/2023']).date).toBe('2023-04-30')
  })
})

describe('extract-piece / branchement du repli', () => {
  // Garde-fou structurel : les tests ci-dessus exercent `dateDepuisTexteBrut` isolément, ils ne
  // voient pas si le résultat est réellement utilisé. Une mutation l'a montré — débrancher le repli
  // les laissait tous passer. Vérifier le câblage par le texte est grossier, mais c'est ce qui reste
  // quand la fonction englobante ne peut pas être exécutée hors de Deno.
  const source = readFileSync(new URL('../../supabase/functions/extract-piece/index.ts', import.meta.url), 'utf8')

  it('appelle le repli quand Textract n’a pas étiqueté de date', () => {
    expect(source).toContain('let datePiece = parseDate(date?.text)')
    expect(source).toContain('if (!datePiece) {')
    expect(source).toContain('const repli = dateDepuisTexteBrut(lignes, new Date().getUTCFullYear())')
    expect(source).toContain('if (repli.date) datePiece = repli.date')
  })

  it('renvoie la date issue du repli, et le diagnostic quand il n’a rien pu conclure', () => {
    expect(source).toContain('date_piece: datePiece,')
    expect(source).toContain('...(datesDiag ? { _diag_dates: datesDiag } : {}),')
  })
})
