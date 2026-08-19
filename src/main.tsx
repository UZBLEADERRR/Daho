import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerPwa } from './lib/pwa';
import './styles.css';

registerPwa();

const container = document.getElementById('root');
if (!container) throw new Error('#root topilmadi');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
