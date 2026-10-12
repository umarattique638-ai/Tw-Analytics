import Notice from './Notice';

/** A message from the API, shown above the submit button. */
export default function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Notice tone="error">{message}</Notice>;
}
