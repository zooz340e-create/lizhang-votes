import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import PlanApp from './PlanApp.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlanApp />
  </StrictMode>,
);
