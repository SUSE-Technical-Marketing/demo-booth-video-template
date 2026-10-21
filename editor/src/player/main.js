import { createApp } from 'vue';
import Player from './Player.vue';
import { boothState } from './data.js';
import '../style.css';
import './player.css';

const { state, video, title } = boothState(document.getElementById('booth-data')?.textContent);
document.title = title;
createApp(Player, { state, video, title }).mount('#player');
