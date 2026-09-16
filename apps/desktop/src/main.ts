import { createApp } from 'vue'
import App from './App.vue'
import TreeOverlay from './components/TreeOverlay.vue'
import './style.css'

/**
 * The overlay is its own window at `index.html?overlay=tree`, so it renders only
 * the tree — with a transparent body, because the game has to show through it.
 */
const isOverlay = new URLSearchParams(location.search).get('overlay') === 'tree'
if (isOverlay) document.body.classList.add('overlay-window')

const app = createApp(isOverlay ? TreeOverlay : App)

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
