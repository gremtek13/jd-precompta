"""Répète les bordures de commentaire d'une Edge Function avant de la transcrire dans l'outil de déploiement.

    python3 supabase/essais/bordures.py <source>                     # ce qu'il faut écrire, bordure par bordure
    python3 supabase/essais/bordures.py <source> <repetition.json>   # ce qui a été écrit, décodé et compté

Les longues suites de `─` sont les seules lignes qu'une transcription manque, et une transcription refaite recopie les
fautes de la précédente au lieu de recompter (HISTORIQUE.md, « LES BORDURES SE RECOPIENT »). D'où la répétition : la
session écrit chaque bordure, dans l'ordre du fichier, dans une liste JSON de chaînes, sous une forme qui se compte à
l'œil et ne laisse rien à recopier — par cinq, quatre échappements `\\u2500` et un trait littéral, un double trait tous
les vingt-cinq —, et ce script la décode comme l'outil le fera, puis compare chaque ligne à la source : son libellé et
sa longueur. Il rend 0 quand toutes sont justes. Il ne prouve rien du déploiement lui-même : seul l'aller-retour
(`allerretour.py`) le fait.
"""
import json
import re
import sys

BORDURE = re.compile(r'^// ── (.*?) (─+)$')


def bordures(texte: str) -> list[tuple[int, str, int]]:
    return [(numero, m.group(1), len(m.group(2)))
            for numero, ligne in enumerate(texte.split('\n'), 1)
            if (m := BORDURE.match(ligne))]


def forme(longueur: int) -> str:
    blocs, reste = divmod(longueur, 25)
    groupes, traits = divmod(reste, 5)
    return f'{blocs} bloc(s) de 25, {groupes} groupe(s) de 5, {traits} trait(s)'


def main() -> int:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    attendues = bordures(open(sys.argv[1], encoding='utf8').read())
    if len(sys.argv) == 2:
        for numero, libelle, longueur in attendues:
            print(f'{numero:5}  {libelle[:40]:40}  {longueur:3}  {forme(longueur)}')
        print(f'{len(attendues)} bordure(s)')
        return 0

    ecrites = json.loads(open(sys.argv[2], encoding='utf8').read())
    fautes = 0
    if len(ecrites) != len(attendues):
        print(f'{len(ecrites)} ligne(s) écrite(s) pour {len(attendues)} bordure(s) dans la source')
        fautes += 1
    for (numero, libelle, longueur), ecrite in zip(attendues, ecrites):
        m = BORDURE.match(ecrite)
        lue = (m.group(1), len(m.group(2))) if m else (None, 0)
        juste = lue == (libelle, longueur)
        fautes += 0 if juste else 1
        print(f'{numero:5}  {libelle[:40]:40}  attendu {longueur:3}  écrit {lue[1]:3}'
              f'{"" if juste else "  <-- FAUX" + ("" if lue[0] == libelle else " (libellé)")}')
    print('RÉPÉTITION JUSTE' if fautes == 0 else f'{fautes} faute(s) : récrire ces lignes, puis répéter')
    return 1 if fautes else 0


if __name__ == '__main__':
    sys.exit(main())
