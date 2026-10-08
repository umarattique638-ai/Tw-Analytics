import { useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { inputCls, muted } from './styles';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  labelRight?: ReactNode;
};

export default function Field({ label, hint, labelRight, type = 'text', className = '', id, ...rest }: Props) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [show, setShow] = useState(false);
  const isPassword = type === 'password';

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={inputId} className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</label>
        {labelRight}
      </div>
      <div className="relative">
        <input
          id={inputId}
          type={isPassword && show ? 'text' : type}
          className={`${inputCls} ${isPassword ? 'pr-11' : ''} aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus:ring-red-500/15 ${className}`}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-slate-400 transition hover:text-slate-700 focus-visible:text-teal-700 focus-visible:outline-none dark:hover:text-slate-200 dark:focus-visible:text-teal-400"
          >
            {show ? <EyeOff className="size-[18px]" strokeWidth={2} /> : <Eye className="size-[18px]" strokeWidth={2} />}
          </button>
        )}
      </div>
      {hint && <small className={`text-[13px] ${muted}`}>{hint}</small>}
    </div>
  );
}