import { toast as sonnerToast } from 'sonner'

// No Toaster re-export. The app mounts exactly one, in
// components/ui/app-toaster.tsx. A second live Toaster makes sonner
// render every toast twice, which is what this export made easy to do
// by accident.

// Thin wrapper so existing useToast() call sites keep working unchanged
export function useToast() {
  return (message: string, type: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    if (type === 'success') sonnerToast.success(message)
    else if (type === 'error') sonnerToast.error(message)
    else if (type === 'warning') sonnerToast.warning(message)
    else sonnerToast(message)
  }
}

