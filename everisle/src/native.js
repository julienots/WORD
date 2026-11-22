// Intégration native Android/iOS (Capacitor) : plein écran, paysage, sauvegarde à la mise en arrière-plan.
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import { App } from '@capacitor/app';

export async function initNative() {
  if (!Capacitor.isNativePlatform()) return;
  try { await StatusBar.setOverlaysWebView({ overlay: true }); await StatusBar.hide(); } catch (e) { /* plateforme sans barre d'état */ }
  App.addListener('pause', () => window.dispatchEvent(new Event('pagehide')));
  App.addListener('backButton', () => { const m = document.getElementById('modal'); if (m && !m.classList.contains('hidden')) m.classList.add('hidden'); });
}
