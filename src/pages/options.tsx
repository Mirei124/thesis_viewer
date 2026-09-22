import { createRoot } from 'react-dom/client';

import { AppShell } from '../components/AppShell';
import '../styles.css';

createRoot(document.getElementById('root')!).render(<AppShell page="options" />);
