# Projet n°9 : taxi-drone eVTOL et moteur synchrone

## Présenter
Ouvrir `presentation/index.html` dans Chrome ou Edge (double-clic). Fonctionne **hors ligne**.

| Touche | Action |
|---|---|
| → / Espace / PageDown | diapo suivante (compatible télécommande) |
| ← / PageUp | diapo précédente |
| F | plein écran |
| N | afficher les notes de l'orateur |

Diapos interactives : 5 (drone 3D, glisser pour tourner), 7 (curseurs du cahier des charges),
13 (bouton ▶ : mission simulée), 14 (bouton : panne moteur). Les graphiques Plotly réagissent au survol.

**À faire avant de présenter :** remplacer `[Nom Prénom 1]…` dans `presentation/index.html` (diapo 1).

## Régénérer la simulation
```
python simulation/simulation_evtol.py
```
Produit les figures PNG dans `figures/` (pour le rapport) et `presentation/data/sim.js` (données de la présentation).
Tous les paramètres (masse, rotors, moteur, batterie) sont en tête du script.

## Contenu
- `simulation/simulation_evtol.py` : modèle du rotor (Froude/Glauert), modèle d-q du MSAP avec défluxage,
  pertes Joule/fer/méca, batterie, thermique, simulation temporelle de la mission et de la panne moteur.
- `figures/` : 7 courbes (comparaison MCC/MAS/MS, rotor, enveloppe couple-vitesse, carte de rendement,
  mission, panne, bilan de puissance).
- `presentation/` : présentation web (Three.js + Plotly, fournis dans `lib/`).

## Chiffres clés (VX-8 : 950 kg, 8 rotors Ø 2 m)
- Stationnaire : 1 165 N/rotor, 1 463 tr/min, 130 N·m, 19,9 kW, η moteur 95,5 %, f = 341 Hz
- Poussée max (×2) : 2 069 tr/min, 260 N·m, 56 kW → moteur choisi : 280 N·m / 60 kW crête, 28 pôles
- Mission 20 km : 35 kWh consommés, 42 % de batterie restante, bobinage 68 °C max
