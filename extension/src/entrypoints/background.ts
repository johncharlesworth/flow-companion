import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';

// The panel is enabled on every tab; the toolbar icon simply opens it.
// Nothing else lives here (manifest row).
export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});
