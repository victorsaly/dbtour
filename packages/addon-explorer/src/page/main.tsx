// The page's entry: the model is inlined in the HTML by src/index.ts, so nothing is fetched.
import { createRoot } from 'react-dom/client';
import type { Model } from 'dbtour/model';
import { App } from './App.tsx';
import '@xyflow/react/dist/style.css';
import './fonts.css';
import './styles.css';

const model = JSON.parse(document.getElementById('dbtour-model')?.textContent ?? '{}') as Model;
createRoot(document.getElementById('app')!).render(<App model={model} />);
