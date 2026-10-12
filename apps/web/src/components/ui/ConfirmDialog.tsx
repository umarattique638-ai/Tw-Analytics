import type { ReactNode } from 'react';
import Button from './Button';
import Modal from './Modal';

type Props = {
  title: string;
  message: ReactNode;
  /** The words on the button that does it, e.g. "Delete" or "Shorten retention". */
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

/** "Are you sure?" for an action that cannot be undone. Cancel gets the focus, so Enter never deletes by accident. */
export default function ConfirmDialog({ title, message, confirmLabel, busyLabel, busy, danger = true, onCancel, onConfirm }: Props) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      locked={busy}
      footer={
        <>
          <Button variant="secondary" size="sm" className="h-10 px-4" onClick={onCancel} disabled={busy} data-autofocus>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} size="sm" className="h-10 px-4" onClick={onConfirm} loading={busy}>
            {busy ? (busyLabel ?? `${confirmLabel}…`) : confirmLabel}
          </Button>
        </>
      }
    >
      {message}
    </Modal>
  );
}
