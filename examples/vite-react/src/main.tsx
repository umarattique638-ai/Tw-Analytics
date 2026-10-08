import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { TailwatchProvider, useTailwatch } from '@tailwatch/react';

function Signup() {
  const tw = useTailwatch();
  return <button onClick={() => tw.track('signup', { plan: 'pro' })}>Sign up</button>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TailwatchProvider siteKey={import.meta.env.VITE_TW_KEY} api={import.meta.env.VITE_TW_API} allowLocal={import.meta.env.VITE_TW_ALLOW_LOCAL === '1'}>
      <BrowserRouter>
        <nav>
          <Link to="/">Home</Link> <Link to="/about">About</Link> <Link to="/blog/hello">Blog</Link>
        </nav>
        <Routes>
          <Route path="/" element={<h1>Home</h1>} />
          <Route path="/about" element={<h1>About</h1>} />
          <Route path="/blog/:slug" element={<><h1>Post</h1><Signup /></>} />
        </Routes>
      </BrowserRouter>
    </TailwatchProvider>
  </StrictMode>,
);
