import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/*
      `reducedMotion="user"` makes every Framer animation in the app
      follow the system setting, in one place. The alternative is
      calling useReducedMotion() in each animated component and
      branching, which is what lib/motion.ts documented and what none
      of them actually did, so the setting was ignored everywhere.

      Framer drops transform and layout animation under this and leaves
      opacity alone, which is the right split: movement is what causes
      trouble, and a crossfade still says something appeared.

      CSS transitions are handled separately, by the reduced-motion
      block in tokens.css. Both halves are needed: this one does not
      reach a `transition-colors` class.
    */}
    <MotionConfig reducedMotion="user">
      <ErrorBoundary>
          <App />
      </ErrorBoundary>
    </MotionConfig>
  </React.StrictMode>,
)
