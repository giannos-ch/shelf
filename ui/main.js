import '@xterm/xterm/css/xterm.css';
import './style.css';
import { mount } from 'svelte';
import App from './App.svelte';

if (window.shelf) document.documentElement.classList.add('desktop', 'platform-' + window.shelf.platform);
mount(App, { target: document.body });
