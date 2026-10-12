import { Toaster as Sonner } from 'sonner';

/** Where toasts appear: bottom right (full width on phones), light or dark like the system. */
export default function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      theme="system"
      closeButton
      visibleToasts={4}
      duration={5_000}
      toastOptions={{ className: 'tw-toast' }}
      containerAriaLabel="Notifications"
    />
  );
}
