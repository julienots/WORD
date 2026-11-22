# Everisle

Jeu mobile 3D (paysage) de construction, survie, exploration et gestion de village insulaire, pensé pour le duo.

## Contenu de la version 0.1
- Île 3D stylisée : forêt de pins, prairie fleurie, rivière animée, mine, rocher, dépôt de bois, chaumières.
- Rendu : ombres dynamiques, herbe animée par le vent (shader), bloom, profondeur de champ, étalonnage des couleurs, lucioles.
- Déplacement au joystick tactile (ou ZQSD/WASD), caméra qui suit, zoom au pincement ou à la molette.
- Récolte : couper les arbres (ils tombent puis repoussent), miner les rochers (pierre et fer), cueillir des baies.
- Construction par les villageois : on place un plan (cabane, palissade, feu de camp, tour de guet) ; Bram le constructeur vient bâtir étape par étape (fondations, murs, toit). Une cabane terminée attire un nouvel habitant.
- Amélioration de la mine en livrant de la pierre.
- Cycle jour/nuit : la nuit, des ombres sortent de la forêt et attaquent ; les habitants rentrent chez eux, les tours tirent, Lyra défend le village.
- Niveau de l'île avec XP et déblocages, objectifs, pièces, essences.
- Sauvegarde automatique sur l'appareil.

Dans cette version, Lyra (le joueur 2) est contrôlée par le jeu. Le duo en ligne sur deux téléphones est la prochaine étape.

## Développement
```bash
npm install
npm run dev          # navigateur
npm run android:sync # copie le jeu dans le projet Android
```
L'APK est construit par GitHub Actions (`.github/workflows/everisle.yml`) et publié en release `everisle-v0.1.N`.
