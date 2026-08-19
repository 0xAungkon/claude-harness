import React from 'react';
import ReactDOM from 'react-dom/client';
import 'highlight.js/styles/github-dark.css';
import './index.css';
import App from './App';

const mount = document.getElementById('root');

if (!mount) {
  throw new Error('Claude Harness could not find the #root mount element. The frontend HTML is invalid or the bundle executed before the document was parsed.');
}

ReactDOM.createRoot(mount).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
