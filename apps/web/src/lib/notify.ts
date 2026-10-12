import { toast } from 'sonner';

type Action = { label: string; onClick: () => void };
type Options = { description?: string; action?: Action };

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * The one way to tell the user how an action went ("Report deleted.", "Could not save."): a toast in the
 * corner that goes away by itself. Problems the user must fix in a form stay next to the form instead.
 */
export const notify = {
  success: (text: string, o: Options = {}) => toast.success(text, { description: o.description, action: o.action }),
  info: (text: string, o: Options = {}) => toast.info(text, { description: o.description, action: o.action }),
  warning: (text: string, o: Options = {}) => toast.warning(text, { description: o.description, action: o.action, duration: 10_000 }),
  /** Errors stay a little longer. `e` can be the caught error: its message is shown, or the fallback. */
  error: (e: unknown, fallback = 'Something went wrong. Try again.') => toast.error(typeof e === 'string' ? e : errorMessage(e, fallback), { duration: 8_000 }),
};
