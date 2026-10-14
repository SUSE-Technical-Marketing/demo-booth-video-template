import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

const app = createApp(App);
app.config.errorHandler = (error) => {
  console.error('Timing editor failed:', error);
  window.alert(`Timing editor failed: ${error.message}`);
};
app.mount('#app');
