import Spinner from '../ui/Spinner';

/** Shown while a page's code downloads (each page is its own chunk). */
export default function PageLoading() {
  return (
    <div className="grid flex-1 place-items-center py-24 text-teal-600 dark:text-teal-400">
      <Spinner className="size-6" label="Loading" />
    </div>
  );
}
