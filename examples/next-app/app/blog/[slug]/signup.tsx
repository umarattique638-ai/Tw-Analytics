'use client';
import { useTailwatch } from '@tailwatch/next';

export function SignupButton() {
  const tw = useTailwatch();
  return <button onClick={() => tw.track('signup', { plan: 'pro' })}>Sign up</button>;
}
