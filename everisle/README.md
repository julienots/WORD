# Everisle

Jeu mobile 3D (paysage) de construction, survie, exploration et gestion de village insulaire, pensé pour le duo.

## Version 0.2
- **Duo en ligne** (menu 💬 Duo) : un joueur héberge son île et donne un code à 5 caractères, l'autre le rejoint depuis son téléphone. Île, ressources, bâtiments, villageois, territoires et niveau partagés ; chacun garde son personnage, son niveau et sa vie. Sans duo, Lyra joue en IA.
- **Villageois et métiers** : bûcheron, mineur, cueilleur, constructeur, fermier, menuisier, marchand, pêcheur, chasseur nocturne. Ils travaillent seuls, rapportent leurs récoltes au dépôt, gagnent des étoiles d'expérience, ont un trait de caractère, mangent chaque matin et rentrent chez eux la nuit.
- **Chaînes de production** : bûcheron → bois → menuisier (atelier) → planches → maisons améliorées ; fermier → nourriture ; marchand → pièces.
- **Maisons complètes prêtes à poser** : chaumière rustique, maison nordique, maison à colombages, villa tropicale, manoir élégant, tour enchantée (1 à 4 habitants chacune).
- **Bâtiments** : cabane → maison → demeure (chaque niveau change l'apparence et accueille un habitant de plus), ferme, atelier, marché (achat/vente), feu de camp, palissade, mur de pierre, tour de guet (tire la nuit), lampadaires, parterres fleuris, bancs, dalles de route. Construction réalisée par les constructeurs, étape par étape ; démolition remboursée à 50 %.
- **Exploration** : la Prairie de l'Est (île niv. 14) et les Collines de cristal (niv. 16) se débloquent avec le niveau de l'île.
- **Chasse, pêche, récolte** : cerfs (viande et cuir), pêche à la rivière, baies, arbres, pierre, fer, cristaux.
- **Nuits dangereuses** : ombres nocturnes, et tous les 4 jours une Lune rouge avec un colosse d'ombre (boss).
- Niveau de l'île et niveau du joueur, 12 objectifs, sauvegarde automatique.

## Développement
```bash
npm install
npm run dev          # navigateur
npm run android:sync # copie le jeu dans le projet Android
```
Le duo utilise WebRTC via le service public PeerJS. Pour tester en local : `?peerhost=127.0.0.1&peerport=9000` avec un serveur `peer`.
L'APK est construit par GitHub Actions (`.github/workflows/everisle.yml`) et publié en release `everisle-v0.2.N`.
