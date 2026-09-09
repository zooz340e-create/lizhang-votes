import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import VoteMatchApp from './VoteMatchApp.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VoteMatchApp />
  </StrictMode>,
);
