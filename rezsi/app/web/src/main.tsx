import { render } from 'preact';
import { App } from './app';
import { normalizeDeepLink } from './router';
import './styles.css';

normalizeDeepLink();
render(<App />, document.getElementById('app')!);
