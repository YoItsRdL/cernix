import { createRoot } from 'react-dom/client'
import { Distiller } from '@/components/Distiller'
import { AppToaster } from '@/components/ui/app-toaster'
import { installMockApi } from './mock-api'

// AppToaster lives in App, not Distiller, so it has to be mounted
// alongside. Without it toast actions have nowhere to render and the
// undo-from-toast assertions silently find nothing.
installMockApi()
createRoot(document.getElementById('root')!).render(
  <>
    <Distiller />
    <AppToaster />
  </>,
)
