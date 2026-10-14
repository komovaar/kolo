import { createRoot } from 'react-dom/client';

// Components move into this root one workflow at a time. The terminal keeps
// its independent lifecycle and DOM; streaming output never enters React state.
const container = document.getElementById('react-root');
if (!container) throw new Error('Missing Kolo interface root');
createRoot(container).render(null);
