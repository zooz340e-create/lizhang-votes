import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import EastApp from './EastApp.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EastApp />
  </StrictMode>,
);
