import logo from '../../assets/lg1.png';

export default function Logo({ light = false, className = '' }: { light?: boolean; className?: string }) {
  return (
    <span
      className={`inline-flex items-center overflow-hidden ${
        light ? '' : 'rounded-xl bg-slate-950 px-2.5 py-1 ring-1 ring-slate-800'
      } ${className}`}
    >
      <img src={logo} alt="TailWatch" className="h-12 w-auto mix-blend-screen" draggable={false} />
    </span>
  );
}