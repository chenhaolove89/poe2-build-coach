import { createApp } from 'vue'
import App from './App.vue'
import TreeOverlay from './components/TreeOverlay.vue'
import CampaignOverlay from './components/CampaignOverlay.vue'
import './style.css'

/**
 * Overlay windows live at `index.html?overlay=…` and render one component each:
 * the tree reference over a transparent body (the game shows through), and the
 * campaign checklist as a small solid card. Both share localStorage with the
 * main window, which is how they see the build and the campaign progress.
 */
const overlayView = new URLSearchParams(location.search).get('overlay')
const isTreeOverlay = overlayView === 'tree'
const isCampaignOverlay = overlayView === 'campaign'
if (isTreeOverlay) document.body.classList.add('overlay-window')
if (isCampaignOverlay) document.body.classList.add('campaign-overlay-window')

const root = isTreeOverlay ? TreeOverlay : isCampaignOverlay ? CampaignOverlay : App
const app = createApp(root)

// Surface fatal errors on-screen instead of a silent black canvas.
app.config.errorHandler = (err, _instance, info) => {
  console.error(err, info)
  let box = document.getElementById('fatal-error')
  if (!box) {
    box = document.createElement('pre')
    box.id = 'fatal-error'
    box.style.cssText =
      'position:fixed;inset:auto 12px 12px 12px;max-height:45vh;overflow:auto;z-index:99;' +
      'background:#2a1414;color:#ffb4b4;border:1px solid #e06c6c;border-radius:8px;padding:10px;font-size:12px;white-space:pre-wrap;'
    document.body.appendChild(box)
  }
  box.textContent = `[${info}] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
}

app.mount('#app')
